from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    role = Column(String, nullable=False)  # TEACHER or STUDENT
    academic_year = Column(Integer, nullable=True)
    branch = Column(String, nullable=True)


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    academic_year = Column(Integer, nullable=True)
    branch = Column(String, nullable=False, default="")
    section = Column(String, nullable=False, default="")
    term = Column(String, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    teacher = relationship("User")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("course_id", "student_id"),
        UniqueConstraint("course_id", "roll_number"),
    )
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    roll_number = Column(String, nullable=False)
    enrolled_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    course = relationship("Course")
    student = relationship("User")


class AttendanceSession(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    teacher_id = Column(Integer, ForeignKey("users.id"))
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True, index=True)
    teacher = relationship("User")
    course = relationship("Course")
    title = Column(String, nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    active = Column(Boolean, default=True)
    lat = Column(Float, nullable=True, default=0.0)      # class location (teacher)
    lng = Column(Float, nullable=True, default=0.0)
    accuracy = Column(Float, nullable=True, default=0.0) # device accuracy in metres
    radius = Column(Integer, default=100)    # allowed distance in metres


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("session_id", "student_id"),)
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    student = relationship("User")
    marked_at = Column(DateTime, default=datetime.utcnow)
    distance = Column(Float)                 # student's distance from class in metres
