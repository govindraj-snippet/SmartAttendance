import io
import math
import os
from datetime import timedelta
from typing import Literal

import jwt
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import Base, engine, get_db
from models import User, Course, Enrollment, AttendanceSession, Attendance
from security import (hash_password, verify_password, auth_token, qr_token,
                      decode, require_role, APP_ENV, valid_teacher_signup_code)

BRANCHES = ("IT", "CS", "ENTC", "PROD", "MECHANICAL", "TEXTILE", "ELECTRICAL", "INSTRU")

Base.metadata.create_all(bind=engine)


def auto_migrate():
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        if "users" in tables:
            columns = {column["name"] for column in inspector.get_columns("users")}
            if "academic_year" not in columns:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN academic_year INTEGER"
                )
            if "branch" not in columns:
                conn.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN branch VARCHAR(80)"
                )

        if "courses" in tables:
            columns = {column["name"] for column in inspector.get_columns("courses")}
            if "academic_year" not in columns:
                conn.exec_driver_sql(
                    "ALTER TABLE courses ADD COLUMN academic_year INTEGER"
                )
            if "branch" not in columns:
                conn.exec_driver_sql(
                    "ALTER TABLE courses ADD COLUMN branch VARCHAR(80) NOT NULL DEFAULT ''"
                )
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_courses_year_branch "
                "ON courses (academic_year, branch)"
            )

        if "sessions" in tables:
            columns = {column["name"] for column in inspector.get_columns("sessions")}
            session_columns = {
                "lat": "FLOAT DEFAULT 0.0",
                "lng": "FLOAT DEFAULT 0.0",
                "accuracy": "FLOAT DEFAULT 0.0",
                "radius": "INTEGER DEFAULT 100",
                "course_id": "INTEGER REFERENCES courses(id)",
            }
            for name, definition in session_columns.items():
                if name not in columns:
                    conn.exec_driver_sql(
                        f"ALTER TABLE sessions ADD COLUMN {name} {definition}"
                    )

        if "attendance" in tables:
            columns = {column["name"] for column in inspector.get_columns("attendance")}
            if "distance" not in columns:
                conn.exec_driver_sql("ALTER TABLE attendance ADD COLUMN distance FLOAT")

        if "sessions" in tables:
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_sessions_course_id ON sessions (course_id)"
            )


auto_migrate()

app = FastAPI(title="QR Attendance")

frontend_origins = os.getenv("FRONTEND_ORIGIN")
if APP_ENV == "production" and not frontend_origins:
    raise RuntimeError("FRONTEND_ORIGIN must be configured in production")
origins = [
    origin.strip().rstrip("/")
    for origin in (frontend_origins or "http://localhost:5173").split(",")
    if origin.strip()
]
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
    academic_year: int | None = Field(default=None, alias="year", ge=1, le=4)
    branch: str | None = Field(default=None, max_length=80)
    teacher_signup_code: str | None = Field(default=None, alias="teacherCode", max_length=128)


class StudentProfileReq(BaseModel):
    academic_year: int = Field(alias="year", ge=1, le=4)
    branch: str = Field(min_length=1, max_length=80)


class TeacherProfileReq(BaseModel):
    branch: str = Field(min_length=1, max_length=80)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class SessionReq(BaseModel):
    title: str
    course_id: int = Field(alias="courseId", gt=0)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy: float = 0.0
    radius: int = Field(default=200, ge=10, le=10000)


class UpdateSessionReq(BaseModel):
    radius: int = Field(ge=10, le=10000)


class CourseReq(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=120)
    academic_year: int = Field(alias="year", ge=1, le=4)
    section: str = Field(default="", max_length=80)
    term: str = Field(default="", max_length=80)


class EnrollmentReq(BaseModel):
    student_email: EmailStr = Field(alias="studentEmail")
    roll_number: str = Field(alias="rollNumber", min_length=1, max_length=80)


class SelfEnrollmentReq(BaseModel):
    roll_number: str = Field(alias="rollNumber", min_length=1, max_length=80)


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
    name = r.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    academic_year = None
    branch = None
    if r.role == "STUDENT":
        branch = (r.branch or "").strip().upper()
        if r.academic_year is None or not branch:
            raise HTTPException(400, "Students must provide their academic year and branch")
        academic_year = r.academic_year
    elif r.role == "TEACHER":
        if not valid_teacher_signup_code(r.teacher_signup_code):
            raise HTTPException(403, "A valid teacher registration code is required")
        branch = (r.branch or "").strip().upper()
        if not branch:
            raise HTTPException(400, "Teachers must provide their branch")
    if branch and branch not in BRANCHES:
        raise HTTPException(400, f"Branch must be one of: {', '.join(BRANCHES)}")
    db.add(User(name=r.name.strip(), email=email,
                password=hash_password(r.password), role=r.role))
    db.flush()
    user = db.query(User).filter(User.email == email).first()
    user.name = name
    user.academic_year = academic_year
    user.branch = branch
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


def owned_course(db: Session, course_id: int, teacher: User) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    if course.teacher_id != teacher.id:
        raise HTTPException(403, "Not your course")
    return course


def teacher_branch(teacher: User) -> str:
    branch = (teacher.branch or "").strip().upper()
    if branch not in BRANCHES:
        raise HTTPException(409, "Complete your teacher profile by selecting a valid branch first")
    return branch


@app.get("/api/teacher/profile")
def teacher_profile(teacher: User = Depends(require_role("TEACHER"))):
    branch = (teacher.branch or "").strip().upper()
    return {
        "branch": branch if branch in BRANCHES else "",
        "branches": BRANCHES,
        "profileComplete": branch in BRANCHES,
    }


@app.put("/api/teacher/profile")
def update_teacher_profile(r: TeacherProfileReq, db: Session = Depends(get_db),
                           teacher: User = Depends(require_role("TEACHER"))):
    branch = r.branch.strip().upper()
    if branch not in BRANCHES:
        raise HTTPException(400, f"Branch must be one of: {', '.join(BRANCHES)}")
    teacher.branch = branch
    db.query(Course).filter(
        Course.teacher_id == teacher.id,
    ).update({"branch": branch}, synchronize_session=False)
    db.commit()
    return {"branch": branch, "branches": BRANCHES, "profileComplete": True}


@app.get("/api/teacher/courses")
def my_courses(db: Session = Depends(get_db),
               teacher: User = Depends(require_role("TEACHER"))):
    courses = (db.query(Course)
               .filter(Course.teacher_id == teacher.id)
               .order_by(Course.id.desc()).all())
    counts = dict(
        db.query(Enrollment.course_id, func.count(Enrollment.id))
        .filter(Enrollment.course_id.in_([course.id for course in courses]))
        .group_by(Enrollment.course_id).all()
    ) if courses else {}
    return [{
        "id": course.id,
        "name": course.name,
        "subject": course.subject,
        "year": course.academic_year,
        "branch": course.branch,
        "section": course.section,
        "term": course.term,
        "enrollmentCount": counts.get(course.id, 0),
    } for course in courses]


@app.post("/api/teacher/courses")
def create_course(r: CourseReq, db: Session = Depends(get_db),
                  teacher: User = Depends(require_role("TEACHER"))):
    name, subject = r.name.strip(), r.subject.strip()
    branch = teacher_branch(teacher)
    section, term = r.section.strip(), r.term.strip()
    if not name or not subject:
        raise HTTPException(400, "Course name and subject are required")
    course = Course(
        teacher_id=teacher.id,
        name=name,
        subject=subject,
        academic_year=r.academic_year,
        branch=branch,
        section=section,
        term=term,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return {
        "id": course.id,
        "name": course.name,
        "subject": course.subject,
        "year": course.academic_year,
        "branch": course.branch,
        "section": course.section,
        "term": course.term,
        "enrollmentCount": 0,
    }


@app.patch("/api/teacher/courses/{course_id}")
def update_course(course_id: int, r: CourseReq, db: Session = Depends(get_db),
                  teacher: User = Depends(require_role("TEACHER"))):
    course = owned_course(db, course_id, teacher)
    name, subject = r.name.strip(), r.subject.strip()
    branch = teacher_branch(teacher)
    if not name or not subject:
        raise HTTPException(400, "Course name and subject are required")
    course.name = name
    course.subject = subject
    course.academic_year = r.academic_year
    course.branch = branch
    course.section = r.section.strip()
    course.term = r.term.strip()
    db.commit()
    db.refresh(course)
    return {
        "id": course.id,
        "name": course.name,
        "subject": course.subject,
        "year": course.academic_year,
        "branch": course.branch,
        "section": course.section,
        "term": course.term,
        "enrollmentCount": db.query(func.count(Enrollment.id))
        .filter(Enrollment.course_id == course.id).scalar(),
    }


@app.get("/api/teacher/courses/{course_id}")
def course_report(course_id: int, db: Session = Depends(get_db),
                  teacher: User = Depends(require_role("TEACHER"))):
    course = owned_course(db, course_id, teacher)
    enrollments = (db.query(Enrollment)
                   .filter(Enrollment.course_id == course.id)
                   .order_by(Enrollment.roll_number, Enrollment.id).all())
    course_sessions = (db.query(AttendanceSession)
                       .filter(AttendanceSession.course_id == course.id)
                       .order_by(AttendanceSession.started_at).all())
    attended = {}
    if course_sessions:
        rows = (db.query(Attendance.student_id, Attendance.session_id, Attendance.marked_at)
                .filter(Attendance.session_id.in_([s.id for s in course_sessions]))
                .all())
        for student_id, session_id, marked_at in rows:
            attended.setdefault(student_id, {})[session_id] = marked_at

    roster = []
    for enrollment in enrollments:
        eligible_sessions = [
            session for session in course_sessions
            if session.started_at >= enrollment.enrolled_at
        ]
        student_attendance = attended.get(enrollment.student_id, {})
        present_count = sum(
            1 for session in eligible_sessions if session.id in student_attendance
        )
        total_sessions = len(eligible_sessions)
        roster.append({
            "studentId": enrollment.student_id,
            "name": enrollment.student.name,
            "email": enrollment.student.email,
            "rollNumber": enrollment.roll_number,
            "enrolledAt": enrollment.enrolled_at.isoformat(),
            "sessions": total_sessions,
            "present": present_count,
            "absent": total_sessions - present_count,
            "percentage": round(present_count * 100 / total_sessions, 1)
            if total_sessions else 0,
            "records": [{
                "sessionId": session.id,
                "title": session.title,
                "startedAt": session.started_at.isoformat(),
                "present": session.id in student_attendance,
                "markedAt": student_attendance[session.id].isoformat()
                if session.id in student_attendance else None,
            } for session in eligible_sessions],
        })

    return {
        "id": course.id,
        "name": course.name,
        "subject": course.subject,
        "year": course.academic_year,
        "branch": course.branch,
        "section": course.section,
        "term": course.term,
        "sessionCount": len(course_sessions),
        "enrollments": roster,
    }


@app.get("/api/teacher/attendance-performance")
def attendance_performance(db: Session = Depends(get_db),
                           teacher: User = Depends(require_role("TEACHER"))):
    courses = (db.query(Course)
               .filter(Course.teacher_id == teacher.id)
               .order_by(Course.name, Course.subject, Course.id).all())
    if not courses:
        return []

    course_ids = [course.id for course in courses]
    sessions = (db.query(AttendanceSession)
                .filter(AttendanceSession.course_id.in_(course_ids),
                        AttendanceSession.active.is_(False))
                .order_by(AttendanceSession.started_at.desc()).all())
    session_ids = [session.id for session in sessions]
    sessions_by_course = {}
    for session in sessions:
        sessions_by_course.setdefault(session.course_id, []).append(session)

    attendance_by_student_session = {}
    if session_ids:
        attendance_rows = (db.query(
            Attendance.student_id, Attendance.session_id, Attendance.marked_at
        ).filter(Attendance.session_id.in_(session_ids)).all())
        attendance_by_student_session = {
            (student_id, session_id): marked_at
            for student_id, session_id, marked_at in attendance_rows
        }

    enrollments = (db.query(Enrollment, User)
                   .join(User, Enrollment.student_id == User.id)
                   .filter(Enrollment.course_id.in_(course_ids))
                   .order_by(Enrollment.course_id, Enrollment.roll_number, User.name).all())
    enrollments_by_course = {}
    for enrollment, student in enrollments:
        enrollments_by_course.setdefault(enrollment.course_id, []).append(
            (enrollment, student)
        )

    result = []
    for course in courses:
        course_sessions = sessions_by_course.get(course.id, [])
        students = []
        for enrollment, student in enrollments_by_course.get(course.id, []):
            eligible_sessions = [
                session for session in course_sessions
                if session.started_at >= enrollment.enrolled_at
            ]
            records = []
            present_count = 0
            for session in eligible_sessions:
                attendance_key = (student.id, session.id)
                present = attendance_key in attendance_by_student_session
                marked_at = attendance_by_student_session.get(attendance_key)
                present_count += int(present)
                records.append({
                    "sessionId": session.id,
                    "title": session.title,
                    "startedAt": session.started_at.isoformat(),
                    "present": present,
                    "markedAt": marked_at.isoformat() if marked_at else None,
                })

            total_sessions = len(eligible_sessions)
            students.append({
                "studentId": student.id,
                "name": student.name,
                "email": student.email,
                "rollNumber": enrollment.roll_number,
                "enrolledAt": enrollment.enrolled_at.isoformat(),
                "sessions": total_sessions,
                "present": present_count,
                "absent": total_sessions - present_count,
                "percentage": round(present_count * 100 / total_sessions, 1)
                if total_sessions else 0,
                "records": records,
            })

        result.append({
            "id": course.id,
            "name": course.name,
            "subject": course.subject,
            "year": course.academic_year,
            "branch": course.branch,
            "section": course.section,
            "term": course.term,
            "sessionsHeld": len(course_sessions),
            "students": students,
        })
    return result


@app.post("/api/teacher/courses/{course_id}/enrollments")
def enroll_student(course_id: int, r: EnrollmentReq,
                   db: Session = Depends(get_db),
                   teacher: User = Depends(require_role("TEACHER"))):
    course = owned_course(db, course_id, teacher)
    email = str(r.student_email).lower()
    student = db.query(User).filter(User.email == email).first()
    if not student or student.role != "STUDENT":
        raise HTTPException(
            404, "No student account found for that email. Ask the student to register first."
        )
    if student.academic_year is None or not student.branch:
        raise HTTPException(409, "Student must complete their year and branch profile first")
    if (
        student.academic_year != course.academic_year
        or student.branch.strip().upper() != course.branch.strip().upper()
    ):
        raise HTTPException(409, "Student year and branch do not match this course")

    roll_number = r.roll_number.strip().upper()
    if not roll_number:
        raise HTTPException(400, "Roll number is required")
    if (db.query(Enrollment)
            .filter(Enrollment.course_id == course.id)
            .filter(
                (Enrollment.student_id == student.id)
                | (Enrollment.roll_number == roll_number)
            ).first()):
        raise HTTPException(409, "Student or roll number is already enrolled in this course")

    enrollment = Enrollment(
        course_id=course.id,
        student_id=student.id,
        roll_number=roll_number,
    )
    db.add(enrollment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Student or roll number is already enrolled in this course")
    return {
        "studentId": student.id,
        "name": student.name,
        "email": student.email,
        "rollNumber": roll_number,
    }


@app.get("/api/student/courses/options")
def student_course_options(db: Session = Depends(get_db),
                           student: User = Depends(require_role("STUDENT"))):
    rows = (db.query(Course.academic_year, Course.branch)
            .filter(
                Course.academic_year.in_((1, 2, 3, 4)),
                func.upper(Course.branch).in_(BRANCHES),
            )
            .distinct()
            .order_by(Course.academic_year, Course.branch).all())
    branches_by_year = {}
    for year, branch in rows:
        branches_by_year.setdefault(year, []).append(branch.upper())
    return [{
        "year": year,
        "branches": branches,
    } for year, branches in branches_by_year.items()]


@app.get("/api/student/profile")
def student_profile(student: User = Depends(require_role("STUDENT"))):
    branch = (student.branch or "").strip().upper()
    profile_complete = (
        student.academic_year in (1, 2, 3, 4)
        and branch in BRANCHES
    )
    return {
        "name": student.name,
        "year": student.academic_year,
        "branch": branch,
        "profileComplete": profile_complete,
    }


@app.put("/api/student/profile")
def update_student_profile(r: StudentProfileReq,
                           db: Session = Depends(get_db),
                           student: User = Depends(require_role("STUDENT"))):
    branch = r.branch.strip().upper()
    if branch not in BRANCHES:
        raise HTTPException(400, f"Branch must be one of: {', '.join(BRANCHES)}")
    student.academic_year = r.academic_year
    student.branch = branch
    db.commit()
    return {
        "name": student.name,
        "year": student.academic_year,
        "branch": student.branch,
        "profileComplete": True,
    }


@app.get("/api/student/courses")
def student_courses(year: int | None = Query(default=None, ge=1, le=4),
                    branch: str | None = Query(default=None, min_length=1, max_length=80),
                    db: Session = Depends(get_db),
                    student: User = Depends(require_role("STUDENT"))):
    if student.academic_year not in (1, 2, 3, 4) or student.branch not in BRANCHES:
        raise HTTPException(409, "Complete your year and branch in your student profile first")
    if year is not None and year != student.academic_year:
        raise HTTPException(403, "You can only view courses for your registered academic year")
    branch_name = student.branch.strip().upper()
    if branch and branch.strip().upper() != branch_name:
        raise HTTPException(403, "You can only view courses for your registered branch")
    courses = (db.query(Course)
               .filter(
                   Course.academic_year == student.academic_year,
                   func.upper(Course.branch) == branch_name,
               )
               .order_by(Course.subject, Course.name, Course.id).all())
    if not courses:
        return []

    course_ids = [course.id for course in courses]
    counts = dict(
        db.query(Enrollment.course_id, func.count(Enrollment.id))
        .filter(Enrollment.course_id.in_(course_ids))
        .group_by(Enrollment.course_id).all()
    )
    my_enrollments = {
        enrollment.course_id: enrollment
        for enrollment in db.query(Enrollment)
        .filter(
            Enrollment.course_id.in_(course_ids),
            Enrollment.student_id == student.id,
        ).all()
    }

    return [{
        "id": course.id,
        "name": course.name,
        "subject": course.subject,
        "year": course.academic_year,
        "branch": course.branch,
        "section": course.section,
        "term": course.term,
        "teacherName": course.teacher.name,
        "enrollmentCount": counts.get(course.id, 0),
        "isEnrolled": course.id in my_enrollments,
        "rollNumber": my_enrollments[course.id].roll_number
        if course.id in my_enrollments else None,
    } for course in courses]


@app.post("/api/student/courses/{course_id}/enrollments")
def self_enroll_student(course_id: int, r: SelfEnrollmentReq,
                        db: Session = Depends(get_db),
                        student: User = Depends(require_role("STUDENT"))):
    course = db.get(Course, course_id)
    if not course or course.academic_year is None or not course.branch.strip():
        raise HTTPException(404, "Course not found")
    if student.academic_year not in (1, 2, 3, 4) or student.branch not in BRANCHES:
        raise HTTPException(409, "Complete your year and branch in your student profile first")
    if course.academic_year != student.academic_year or course.branch.strip().upper() != student.branch.strip().upper():
        raise HTTPException(403, "This course does not match your registered year and branch")

    roll_number = r.roll_number.strip().upper()
    if not roll_number:
        raise HTTPException(400, "Roll number is required")
    if db.query(Enrollment).filter(
        Enrollment.course_id == course.id,
        Enrollment.student_id == student.id,
    ).first():
        raise HTTPException(409, "You are already enrolled in this course")
    if db.query(Enrollment).filter(
        Enrollment.course_id == course.id,
        func.upper(Enrollment.roll_number) == roll_number,
    ).first():
        raise HTTPException(409, "That roll number is already used in this course")

    enrollment = Enrollment(
        course_id=course.id,
        student_id=student.id,
        roll_number=roll_number,
    )
    db.add(enrollment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "You or that roll number are already enrolled in this course")

    return {
        "courseId": course.id,
        "rollNumber": roll_number,
        "enrollmentCount": db.query(func.count(Enrollment.id))
        .filter(Enrollment.course_id == course.id).scalar(),
    }


@app.post("/api/teacher/sessions")
def start_session(r: SessionReq, db: Session = Depends(get_db),
                  teacher: User = Depends(require_role("TEACHER"))):
    if r.lat is None or r.lng is None:
        raise HTTPException(400, "Teacher location is required to set up geofenced attendance.")
    if not r.title.strip():
        raise HTTPException(400, "Session title is required")
    course = owned_course(db, r.course_id, teacher)
    # only one live session per teacher
    db.query(AttendanceSession).filter_by(teacher_id=teacher.id, active=True).update({"active": False})
    s = AttendanceSession(teacher_id=teacher.id, course_id=course.id, title=r.title.strip(),
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
             "accuracy": s.accuracy, "courseId": s.course_id,
             "courseName": s.course.name if s.course else None,
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
    return [{
        "name": a.student.name,
        "email": a.student.email,
        "time": a.marked_at.isoformat(),
        "distance": a.distance,
        "rollNumber": enrollment.roll_number if (enrollment := db.query(Enrollment)
            .filter_by(course_id=s.course_id, student_id=a.student_id).first()) else None,
    } for a in session_rows(db, s.id)]


@app.get("/api/teacher/sessions/{session_id}/export")
def export_excel(session_id: int, tz: int = 0, db: Session = Depends(get_db),
                 teacher: User = Depends(require_role("TEACHER"))):
    """tz = minutes east of UTC (sent by the browser) so times are in local time."""
    s = owned_session(db, session_id, teacher)
    wb = Workbook()
    ws = wb.active
    ws.title = "Attendance"
    attendance_by_student = {row.student_id: row for row in session_rows(db, s.id)}
    if s.course_id is not None:
        ws.append(["No", "Roll No", "Name", "Email", "Status", "Date", "Time", "Distance (m)"])
        roster = (db.query(Enrollment)
                  .filter(Enrollment.course_id == s.course_id,
                          Enrollment.enrolled_at <= s.started_at)
                  .order_by(Enrollment.roll_number, Enrollment.id).all())
        for i, enrollment in enumerate(roster, 1):
            attendance = attendance_by_student.get(enrollment.student_id)
            marked_at = attendance.marked_at + timedelta(minutes=tz) if attendance else None
            ws.append([
                i,
                enrollment.roll_number,
                enrollment.student.name,
                enrollment.student.email,
                "Present" if attendance else "Absent",
                marked_at.strftime("%d-%m-%Y") if marked_at else "",
                marked_at.strftime("%H:%M:%S") if marked_at else "",
                round(attendance.distance) if attendance and attendance.distance is not None else "",
            ])
        widths = (6, 14, 28, 34, 12, 14, 12, 14)
    else:
        ws.append(["No", "Name", "Email", "Date", "Time", "Distance (m)"])
        for i, a in enumerate(attendance_by_student.values(), 1):
            t = a.marked_at + timedelta(minutes=tz)
            ws.append([i, a.student.name, a.student.email,
                       t.strftime("%d-%m-%Y"), t.strftime("%H:%M:%S"),
                       round(a.distance) if a.distance is not None else ""])
        widths = (6, 28, 34, 14, 12, 14)
    for col, w in zip("ABCDEFGH", widths):
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
    if s.course_id is not None:
        course = db.get(Course, s.course_id)
        if not course:
            raise HTTPException(400, "Session course not found")
        if (
            student.academic_year != course.academic_year
            or not student.branch
            or student.branch.strip().upper() != course.branch.strip().upper()
        ):
            raise HTTPException(403, "This course does not match your registered year and branch")
        if not db.query(Enrollment).filter_by(
            course_id=s.course_id, student_id=student.id
        ).first():
            raise HTTPException(403, "You are not enrolled in this course")
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
