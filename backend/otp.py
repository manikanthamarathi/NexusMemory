"""Email one-time codes: random, hashed at rest, expiring, attempt-limited, rate-limited."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

import db
import mailer

TTL_MIN = int(os.getenv("OTP_TTL_MINUTES", "10"))
MAX_ATTEMPTS = 5
COOLDOWN_S = 45


def _secret() -> bytes:
    return (os.getenv("SECRET_KEY") or "dev-only-secret-change-me").encode()


def _hash(email: str, code: str) -> str:
    return hmac.new(_secret(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def init():
    conn = db.get_connection()
    for col, ddl in (("attempts", "INTEGER DEFAULT 0"), ("sent_at", "TEXT")):
        try:
            conn.execute(f"ALTER TABLE email_otps ADD COLUMN {col} {ddl}")
        except Exception:  # noqa: BLE001 - column already exists
            pass
    conn.commit(); conn.close()


def issue(email: str) -> dict:
    """Returns {sent, wait, dev_code}. dev_code is only set when SMTP is not configured AND DEV_SHOW_OTP=true."""
    conn = db.get_connection()
    row = conn.execute("SELECT sent_at FROM email_otps WHERE email = ?", (email,)).fetchone()
    if row and row["sent_at"]:
        elapsed = (datetime.utcnow() - datetime.fromisoformat(row["sent_at"])).total_seconds()
        if elapsed < COOLDOWN_S:
            conn.close()
            return {"sent": False, "wait": int(COOLDOWN_S - elapsed), "dev_code": None}
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.utcnow()
    conn.execute("INSERT OR REPLACE INTO email_otps (email, otp_code, expires_at, verified, attempts, sent_at) VALUES (?, ?, ?, 0, 0, ?)",
                 (email, _hash(email, code), (now + timedelta(minutes=TTL_MIN)).isoformat(), now.isoformat()))
    conn.commit(); conn.close()
    text, html = mailer.otp_email(code, TTL_MIN)
    sent = mailer.send_email(email, "Your NexusMemory verification code", text, html)
    dev = code if (not sent and not mailer.configured() and os.getenv("DEV_SHOW_OTP", "false").lower() == "true") else None
    if not sent and not dev:
        print(f"[OTP] could not send to {email} (SMTP configured={mailer.configured()})")
    return {"sent": sent, "wait": 0, "dev_code": dev}


def verify(email: str, code: str) -> tuple[bool, str]:
    conn = db.get_connection()
    row = conn.execute("SELECT * FROM email_otps WHERE email = ?", (email,)).fetchone()
    if not row or row["verified"]:
        conn.close(); return False, "No active code for this email. Request a new one."
    if datetime.utcnow() > datetime.fromisoformat(row["expires_at"]):
        conn.close(); return False, "This code has expired. Request a new one."
    if (row["attempts"] or 0) >= MAX_ATTEMPTS:
        conn.close(); return False, "Too many wrong attempts. Request a new code."
    if not hmac.compare_digest(row["otp_code"], _hash(email, code.strip())):
        conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?", (email,)); conn.commit(); conn.close()
        return False, "That code is not correct."
    conn.execute("UPDATE email_otps SET verified = 1 WHERE email = ?", (email,)); conn.commit(); conn.close()
    return True, "Email verified."


def consume_verified(email: str) -> bool:
    """Registration requires a code that was verified within its TTL; it can be used once."""
    conn = db.get_connection()
    row = conn.execute("SELECT * FROM email_otps WHERE email = ?", (email,)).fetchone()
    ok = bool(row and row["verified"] and datetime.utcnow() <= datetime.fromisoformat(row["expires_at"]))
    if ok:
        conn.execute("DELETE FROM email_otps WHERE email = ?", (email,)); conn.commit()
    conn.close()
    return ok
