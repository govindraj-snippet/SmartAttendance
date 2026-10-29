import io
import os
from datetime import timedelta
from typing import Literal

import jwt
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import Base, engine, get_db
from models import User, AttendanceSession, Attendance
from security import (hash_password, verify_password, auth_token, qr_token,
                      decode, require_role)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="QR Attendance")

frontend_env = os.getenv("FRONTEND_ORIGIN")
origins = [o.strip() for o in frontend_env.split(",")] if frontend_env else ["*"]
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


class MarkReq(BaseModel):
    qrToken: str


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
    # only one live session per teacher
    db.query(AttendanceSession).filter_by(teacher_id=teacher.id, active=True).update({"active": False})
    s = AttendanceSession(teacher_id=teacher.id, title=r.title.strip())
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"sessionId": s.id}


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
             "active": s.active, "count": counts.get(s.id, 0)} for s in rows]


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
             "time": a.marked_at.isoformat()} for a in session_rows(db, s.id)]


@app.get("/api/teacher/sessions/{session_id}/export")
def export_excel(session_id: int, tz: int = 0, db: Session = Depends(get_db),
                 teacher: User = Depends(require_role("TEACHER"))):
    """tz = minutes east of UTC (sent by the browser) so times are in local time."""
    s = owned_session(db, session_id, teacher)
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance"
    ws.append(["No", "Name", "Email", "Date", "Time"])
    for i, a in enumerate(session_rows(db, s.id), 1):
        t = a.marked_at + timedelta(minutes=tz)
        ws.append([i, a.student.name, a.student.email,
                   t.strftime("%d-%m-%Y"), t.strftime("%H:%M:%S")])
    for col, w in zip("ABCDE", (6, 28, 34, 14, 12)):
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

    db.add(Attendance(session_id=s.id, student_id=student.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Already marked")
    return {"message": f"Attendance marked for {s.title}"}
