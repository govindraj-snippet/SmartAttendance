import io
import math
import os
from datetime import timedelta
from typing import Literal

import jwt
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import Base, engine, get_db
from models import User, AttendanceSession, Attendance
from security import (hash_password, verify_password, auth_token, qr_token,
                      decode, require_role)

Base.metadata.create_all(bind=engine)


def auto_migrate():
    with engine.connect() as conn:
        try:
            cols_sess = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(sessions)").fetchall()]
            if cols_sess:
                if "lat" not in cols_sess:
                    conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN lat FLOAT DEFAULT 0.0")
                if "lng" not in cols_sess:
                    conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN lng FLOAT DEFAULT 0.0")
                if "accuracy" not in cols_sess:
                    conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN accuracy FLOAT DEFAULT 0.0")
                if "radius" not in cols_sess:
                    conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN radius INTEGER DEFAULT 100")

            cols_att = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(attendance)").fetchall()]
            if cols_att:
                if "distance" not in cols_att:
                    conn.exec_driver_sql("ALTER TABLE attendance ADD COLUMN distance FLOAT")
            conn.commit()
        except Exception:
            pass


auto_migrate()

app = FastAPI(title="QR Attendance")

origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


# ---------- Schemas ----------
class RegisterReq(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["TEACHER", "STUDENT"]


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class SessionReq(BaseModel):
    title: str
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy: float = 0.0
    radius: int = Field(default=200, ge=10, le=10000)


class UpdateSessionReq(BaseModel):
    radius: int = Field(ge=10, le=10000)


class MarkReq(BaseModel):
    qrToken: str
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy: float = 0  # GPS accuracy in metres, reported by the phone


def distance_m(lat1, lng1, lat2, lng2) -> float:
    """Haversine distance between two GPS points, in metres."""
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@app.get("/")
def health():
    return {"status": "ok"}


# ---------- Auth ----------
@app.post("/api/auth/register")
def register(r: RegisterReq, db: Session = Depends(get_db)):
    email = r.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Email already exists")
    db.add(User(name=r.name.strip(), email=email,
                password=hash_password(r.password), role=r.role))
    db.commit()
    return {"message": "Registered"}


@app.post("/api/auth/login")
def login(r: LoginReq, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == r.email.lower()).first()
    if not u or not verify_password(r.password, u.password):
        raise HTTPException(401, "Invalid credentials")
    return {"token": auth_token(u), "role": u.role, "name": u.name}


# ---------- Teacher ----------
def owned_session(db: Session, session_id: int, teacher: User) -> AttendanceSession:
    s = db.get(AttendanceSession, session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if s.teacher_id != teacher.id:
        raise HTTPException(403, "Not your session")
    return s


def session_rows(db: Session, session_id: int):
    return (db.query(Attendance)
            .filter(Attendance.session_id == session_id)
            .order_by(Attendance.marked_at).all())


@app.post("/api/teacher/sessions")
def start_session(r: SessionReq, db: Session = Depends(get_db),
                  teacher: User = Depends(require_role("TEACHER"))):
    if r.lat is None or r.lng is None:
        raise HTTPException(400, "Teacher location is required to set up geofenced attendance.")
    # only one live session per teacher
    db.query(AttendanceSession).filter_by(teacher_id=teacher.id, active=True).update({"active": False})
    s = AttendanceSession(teacher_id=teacher.id, title=r.title.strip(),
                          lat=r.lat, lng=r.lng, accuracy=r.accuracy, radius=r.radius)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"sessionId": s.id}


@app.patch("/api/teacher/sessions/{session_id}")
def update_session(session_id: int, r: UpdateSessionReq, db: Session = Depends(get_db),
                   teacher: User = Depends(require_role("TEACHER"))):
    s = owned_session(db, session_id, teacher)
    s.radius = r.radius
    db.commit()
    return {"message": "Range updated", "radius": s.radius}


@app.get("/api/teacher/sessions")
def my_sessions(db: Session = Depends(get_db),
                teacher: User = Depends(require_role("TEACHER"))):
    rows = (db.query(AttendanceSession)
            .filter(AttendanceSession.teacher_id == teacher.id)
            .order_by(AttendanceSession.id.desc()).limit(50).all())
    counts = dict(db.query(Attendance.session_id, func.count(Attendance.id))
                  .filter(Attendance.session_id.in_([s.id for s in rows]))
                  .group_by(Attendance.session_id).all())
    return [{"id": s.id, "title": s.title, "startedAt": s.started_at.isoformat(),
             "active": s.active, "radius": s.radius, "lat": s.lat, "lng": s.lng,
             "accuracy": s.accuracy,
             "count": counts.get(s.id, 0)} for s in rows]


@app.get("/api/teacher/sessions/{session_id}/qr")
def get_qr(session_id: int, db: Session = Depends(get_db),
           teacher: User = Depends(require_role("TEACHER"))):
    s = owned_session(db, session_id, teacher)
    if not s.active:
        raise HTTPException(410, "Session ended")
    return {"token": qr_token(session_id)}


@app.post("/api/teacher/sessions/{session_id}/end")
def end_session(session_id: int, db: Session = Depends(get_db),
                teacher: User = Depends(require_role("TEACHER"))):
    s = owned_session(db, session_id, teacher)
    s.active = False
    db.commit()
    return {"message": "Session ended"}


@app.get("/api/teacher/sessions/{session_id}/attendance")
def list_attendance(session_id: int, db: Session = Depends(get_db),
                    teacher: User = Depends(require_role("TEACHER"))):
    s = owned_session(db, session_id, teacher)
    return [{"name": a.student.name, "email": a.student.email,
             "time": a.marked_at.isoformat(),
             "distance": a.distance} for a in session_rows(db, s.id)]


@app.get("/api/teacher/sessions/{session_id}/export")
def export_excel(session_id: int, tz: int = 0, db: Session = Depends(get_db),
                 teacher: User = Depends(require_role("TEACHER"))):
    """tz = minutes east of UTC (sent by the browser) so times are in local time."""
    s = owned_session(db, session_id, teacher)
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance"
    ws.append(["No", "Name", "Email", "Date", "Time", "Distance (m)"])
    for i, a in enumerate(session_rows(db, s.id), 1):
        t = a.marked_at + timedelta(minutes=tz)
        ws.append([i, a.student.name, a.student.email,
                   t.strftime("%d-%m-%Y"), t.strftime("%H:%M:%S"),
                   round(a.distance) if a.distance is not None else ""])
    for col, w in zip("ABCDEF", (6, 28, 34, 14, 12, 14)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------- Student ----------
@app.post("/api/student/attendance")
def mark_attendance(r: MarkReq, db: Session = Depends(get_db),
                    student: User = Depends(require_role("STUDENT"))):
    try:
        claims = decode(r.qrToken)
    except jwt.PyJWTError:
        raise HTTPException(400, "QR expired or invalid. Scan again.")
    if claims.get("type") != "qr":
        raise HTTPException(400, "Invalid QR")

    s = db.get(AttendanceSession, claims["sid"])
    if not s or not s.active:
        raise HTTPException(400, "Session closed")
    if db.query(Attendance).filter_by(session_id=s.id, student_id=student.id).first():
        raise HTTPException(400, "Already marked")

    # Location check: student must be within the allowed radius of the teacher if location is configured
    dist = None
    if s.lat and s.lng and (s.lat != 0.0 or s.lng != 0.0):
        if r.lat is None or r.lng is None:
            raise HTTPException(400, "Location access is required to mark attendance. Please turn on GPS and allow location.")
        dist = distance_m(s.lat, s.lng, r.lat, r.lng)

        # Device accuracy allowance:
        # Laptops use Wi-Fi/IP location with large error bounds (typically 100-800m).
        # Mobile GPS has 10-50m error bounds.
        teacher_acc = max(float(s.accuracy or 0), 0.0)
        student_acc = max(float(r.accuracy or 0), 0.0)
        # Device tolerance: sum of accuracies, with minimum 200m buffer for indoor variance (up to 1200m)
        device_tolerance = max(min(teacher_acc + student_acc, 1200.0), 200.0)
        allowed = s.radius + device_tolerance

        print(f"[ATTENDANCE] Session #{s.id} ('{s.title}'): Teacher=({s.lat}, {s.lng}, acc={teacher_acc}m, radius={s.radius}m) | Student=({r.lat}, {r.lng}, acc={student_acc}m) | Distance={round(dist, 1)}m | Allowed={round(allowed, 1)}m")

        if dist > allowed:
            raise HTTPException(
                403,
                f"You are outside the classroom range (Measured distance: {round(dist)} m, allowed: {round(allowed)} m). Ask your teacher to expand the range if you are in class."
            )

    db.add(Attendance(session_id=s.id, student_id=student.id, distance=round(dist, 1) if dist is not None else None))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Already marked")
    return {
        "message": f"Attendance marked for {s.title}",
        "distance": round(dist, 1) if dist is not None else None
    }
