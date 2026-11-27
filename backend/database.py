import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, DeclarativeBase

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./attendance.db"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

url = make_url(DATABASE_URL)
is_sqlite = url.get_backend_name() == "sqlite"
if APP_ENV == "production" and url.get_backend_name() != "postgresql":
    raise RuntimeError("DATABASE_URL must point to PostgreSQL in production")

connect_args = {"check_same_thread": False} if is_sqlite else {"connect_timeout": 5}
engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
