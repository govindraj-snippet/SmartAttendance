import os
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db
from models import User

SECRET = os.getenv("SECRET_KEY", "dev-only-secret-change-me-dev-only-secret")
ALGO = "HS256"
bearer = HTTPBearer()


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    return bcrypt.checkpw(p.encode(), h.encode())


def _now():
    return datetime.now(timezone.utc)


def auth_token(user: User) -> str:
    return jwt.encode(
        {"sub": user.email, "role": user.role, "exp": _now() + timedelta(hours=24)},
        SECRET, algorithm=ALGO)


def qr_token(session_id: int) -> str:
    # Short-lived: a copied or shared QR becomes useless in 20 seconds
    return jwt.encode(
        {"sid": session_id, "type": "qr", "exp": _now() + timedelta(seconds=20)},
        SECRET, algorithm=ALGO)


def decode(token: str) -> dict:
    return jwt.decode(token, SECRET, algorithms=[ALGO])


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    try:
        data = decode(cred.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    if data.get("type"):  # QR tokens can't be used to log in
        raise HTTPException(401, "Invalid token")
    user = db.query(User).filter(User.email == data["sub"]).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require_role(role: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role != role:
            raise HTTPException(403, "Forbidden")
        return user
    return dep