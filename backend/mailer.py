"""Real email delivery over SMTP (STARTTLS or SSL). Returns False, never fakes success, when SMTP is not configured."""
import os
import smtplib
import ssl
from email.message import EmailMessage


def configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    if not configured():
        return False
    host = os.getenv("SMTP_HOST").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USERNAME", "").strip()
    pwd = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM", user or "no-reply@localhost")
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    starttls = os.getenv("SMTP_STARTTLS", "true").lower() == "true"
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        ctx = ssl.create_default_context()
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as s:
                if user:
                    s.login(user, pwd)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as s:
                if starttls:
                    s.starttls(context=ctx)
                if user:
                    s.login(user, pwd)
                s.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] SMTP send failed: {type(e).__name__}: {e}")
        return False


def otp_email(code: str, minutes: int) -> tuple[str, str]:
    text = f"Your NexusMemory verification code is {code}.\nIt expires in {minutes} minutes. If you did not request it, ignore this email."
    html = (f"<div style='font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px'>"
            f"<h2 style='margin:0 0 8px'>NexusMemory</h2><p>Your verification code:</p>"
            f"<p style='font-size:34px;letter-spacing:8px;font-weight:700;margin:12px 0'>{code}</p>"
            f"<p style='color:#64748b;font-size:13px'>Expires in {minutes} minutes. If you did not request this, ignore this email.</p></div>")
    return text, html
