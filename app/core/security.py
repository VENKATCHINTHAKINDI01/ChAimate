"""PIN hashing, login tokens and brute-force protection for customers and staff."""
import hashlib
import hmac
import secrets
import time
from typing import Dict, List

from app.core import db

CUSTOMER_TOKEN_AGE = 60 * 60 * 24 * 90   # stay logged in on your phone for 90 days
STAFF_TOKEN_AGE = 60 * 60 * 14           # one shift

STAFF_ROLES = ("manager", "kitchen", "bar", "waiter")


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"pbkdf2${salt}${digest}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()
    return hmac.compare_digest(check, digest)


def new_token(kind: str, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.save_token(token, kind, user_id)
    return token


# ---- brute-force protection: 5 wrong PINs locks that account for 5 minutes ----
_failures: Dict[str, List[float]] = {}
MAX_FAILS, WINDOW = 5, 300


def locked(key: str) -> bool:
    now = time.time()
    _failures[key] = [t for t in _failures.get(key, []) if now - t < WINDOW]
    return len(_failures[key]) >= MAX_FAILS


def record_failure(key: str) -> None:
    _failures.setdefault(key, []).append(time.time())


def clear_failures(key: str) -> None:
    _failures.pop(key, None)
