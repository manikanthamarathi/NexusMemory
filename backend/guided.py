"""Guided, step-by-step triage on top of NexusMemory's SQLite + Hindsight memory.

Real behaviour only: the plan comes from the LLM (no canned text), citations are checked against what memory
really returned, ticks and problem reports are stored, uploads are validated by content, and the chart is built
from sessions this team really completed."""
import base64
import hashlib
import hmac
import json
import os
import re
import statistics
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

import db
import fileutil
import llmjson
import memory
from guided_schema import ReportAnswer, TriageAnswer

router = APIRouter(prefix="/api/guided", tags=["guided"])
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024


def err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


# ----------------------------------------------------------------------------------------------- auth tokens
def _key() -> bytes:
    return (os.getenv("SECRET_KEY") or "dev-only-secret-change-me").encode()


def make_token(emp_id: str, ttl_hours: int = 24 * 7) -> str:
    body = base64.urlsafe_b64encode(f"{emp_id}|{int(time.time()) + ttl_hours * 3600}".encode()).decode().rstrip("=")
    sig = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise err(401, "unauthorized", "Please sign in again.")
    token = authorization[7:].strip()
    try:
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()):
            raise ValueError
        emp_id, exp = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode().split("|")
        if int(exp) < time.time():
            raise ValueError
    except Exception:  # noqa: BLE001
        raise err(401, "unauthorized", "Your session is invalid or expired. Please sign in again.")
    conn = db.get_connection()
    row = conn.execute("SELECT * FROM employees WHERE id = ?", (emp_id,)).fetchone()
    conn.close()
    if not row:
        raise err(401, "unauthorized", "Account not found.")
    return dict(row)


# ----------------------------------------------------------------------------------------------- storage
def init():
    conn = db.get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS guided_files (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL, kind TEXT NOT NULL,
        size INTEGER NOT NULL, extracted_text TEXT, extraction TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS guided_sessions (
        id TEXT PRIMARY KEY, seq INTEGER NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, service TEXT,
        alert_text TEXT NOT NULL, attachment_ids TEXT NOT NULL, answer TEXT NOT NULL, memory TEXT NOT NULL, model TEXT,
        done TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS guided_reports (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, step_id TEXT NOT NULL, user_id TEXT NOT NULL, message TEXT NOT NULL,
        attachment_ids TEXT NOT NULL, response TEXT, error TEXT, model TEXT, created_at TEXT NOT NULL);
    """)
    conn.commit(); conn.close()


def now() -> str:
    return datetime.utcnow().isoformat()


def file_view(r) -> dict:
    return {"id": r["id"], "filename": r["filename"], "kind": r["kind"], "size": r["size"], "content_type": r["content_type"],
            "extraction": r["extraction"]}


def load_files(conn, ids: list[str], user: dict) -> list:
    rows = []
    for fid in ids:
        r = conn.execute("SELECT * FROM guided_files WHERE id = ?", (fid,)).fetchone()
        if r is None or r["owner_id"] != user["id"]:
            raise err(404, "not_found", "One of the attached files was not found.")
        rows.append(r)
    return rows


@router.post("/files", status_code=201)
async def upload_file(file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise err(413, "too_large", f"Files can be at most {MAX_UPLOAD // 1024 // 1024} MB.")
    if not data:
        raise err(422, "empty_file", "That file is empty.")
    name = fileutil.safe_name(file.filename or "file")
    info = fileutil.inspect(name, data)
    fid = uuid.uuid4().hex
    fileutil.save(user["id"], fid, data)
    conn = db.get_connection()
    conn.execute("INSERT INTO guided_files VALUES (?,?,?,?,?,?,?,?,?)",
                 (fid, user["id"], name, info.content_type, info.kind, len(data), info.text, info.extraction, now()))
    conn.commit()
    r = conn.execute("SELECT * FROM guided_files WHERE id = ?", (fid,)).fetchone()
    conn.close()
    return file_view(r)


def _can_read(conn, fid: str, user: dict):
    r = conn.execute("SELECT * FROM guided_files WHERE id = ?", (fid,)).fetchone()
    if r is None:
        return None
    if r["owner_id"] == user["id"]:
        return r
    like = f'%"{fid}"%'
    hit = conn.execute("SELECT 1 FROM guided_sessions WHERE project_id = ? AND attachment_ids LIKE ? LIMIT 1", (user["current_project_id"], like)).fetchone()
    if not hit:
        hit = conn.execute("""SELECT 1 FROM guided_reports r JOIN guided_sessions s ON s.id = r.session_id
                              WHERE s.project_id = ? AND r.attachment_ids LIKE ? LIMIT 1""", (user["current_project_id"], like)).fetchone()
    return r if hit else None


@router.get("/files/{fid}")
def download_file(fid: str, token: Optional[str] = None, authorization: Optional[str] = Header(default=None)):
    user = current_user(authorization or (f"Bearer {token}" if token else None))
    conn = db.get_connection()
    r = _can_read(conn, fid, user)
    conn.close()
    if r is None:
        raise err(404, "not_found", "File not found.")
    data = fileutil.read(r["owner_id"], fid)
    return Response(data, media_type=r["content_type"], headers={
        "Content-Disposition": f'inline; filename="{r["filename"]}"', "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"})


@router.delete("/files/{fid}", status_code=204)
def delete_file(fid: str, user: dict = Depends(current_user)):
    conn = db.get_connection()
    r = conn.execute("SELECT * FROM guided_files WHERE id = ? AND owner_id = ?", (fid, user["id"])).fetchone()
    if r is None:
        conn.close(); raise err(404, "not_found", "File not found.")
    used = conn.execute("SELECT 1 FROM guided_sessions WHERE attachment_ids LIKE ? UNION SELECT 1 FROM guided_reports WHERE attachment_ids LIKE ?",
                        (f'%"{fid}"%', f'%"{fid}"%')).fetchone()
    if used:
        conn.close(); raise err(409, "in_use", "This file is attached to a triage and cannot be deleted.")
    conn.execute("DELETE FROM guided_files WHERE id = ?", (fid,)); conn.commit(); conn.close()
    fileutil.remove(user["id"], fid)


# ----------------------------------------------------------------------------------------------- prompts
STYLE = """WRITING STYLE (this matters as much as correctness):
- Write for an on-call engineer who is tired and in a hurry. Plain, calm, direct.
- Short sentences, ideally under 20 words. Active voice. Steps start with a verb (Check, Run, Compare, Roll back).
- No filler, no apologies, no marketing words, no emojis, no markdown formatting inside strings.
- Say what to look for ("expected") so the engineer knows whether the step confirmed or ruled out the cause.
- Order steps from the fastest, safest, read-only check to the most invasive change. Mark real risk honestly.
- Commands must be copy-paste ready or use clear <PLACEHOLDERS>. Never include a destructive command without risk "high" and a warning in "how"."""

GROUNDING = """GROUNDING RULES:
- PAST MEMORY below is the only source of facts about THIS team's history. Cite it with the exact label in square brackets, for example INC-101.
- Never invent a label, incident, person, number, duration or date. If memory does not clearly apply, use grounding "general" and evidence [].
- grounding "memory" is only allowed when at least one valid label supports it.
- Past FAILED attempts in memory must appear under "avoid" so the engineer does not repeat them.
- Be honest about uncertainty. Put what you could not determine in "gaps"."""

TRIAGE_SCHEMA = """Return ONE JSON object with exactly these keys:
{
 "headline": "one plain sentence (max 25 words) saying what is probably happening",
 "what_we_know": ["2-4 short facts taken from the alert/logs/files, no guesses"],
 "likely_cause": {"text": "the most probable cause in 1-2 sentences", "grounding": "memory|general", "evidence": ["INC-101"]},
 "steps": [ {"title": "imperative, max 70 chars", "why": "one sentence", "how": "2-4 short lines of instructions",
             "command": "optional single command or null", "expected": "what you should see if this is the cause",
             "grounding": "memory|general", "evidence": ["INC-101"], "risk": "low|medium|high"} ],   // 3 to 7 steps, ordered
 "avoid": [ {"action": "what NOT to do", "reason": "why", "evidence": ["INC-101"]} ],   // 0-4
 "escalate_if": ["clear condition to page someone else"],   // 1-3
 "gaps": ["information that would sharpen this answer"]   // 0-3
}"""

REPORT_SCHEMA = """Return ONE JSON object with exactly these keys:
{
 "understanding": "1-2 plain sentences restating what went wrong at this step, using the user's words and any attached evidence",
 "likely_reason": "the most probable reason this step failed or looked different than expected",
 "fixes": [ {"title": "imperative, max 70 chars", "how": "2-4 short lines", "command": "optional single command or null",
             "expected": "what you should see afterwards", "evidence": ["INC-101"]} ],   // 1 to 3
 "then": "what to do right after the fixes work (one sentence)",
 "escalate": false,
 "escalate_reason": "only if escalate is true",
 "missing_info": ["what extra output/screenshot would help, 0-3 items"]
}"""

LABEL = re.compile(r"\bINC-\d+\b")


# ----------------------------------------------------------------------------------------------- memory
class Recalled:
    def __init__(self):
        self.state, self.note = "empty", ""
        self.blocks: list[str] = []
        self.sources: list[dict] = []
        self.labels: set[str] = set()


def gather_memory(query: str) -> Recalled:
    out = Recalled()
    live = memory.is_live_mode()
    try:
        results = memory.recall("nexus-core", query)
    except Exception as e:  # noqa: BLE001
        out.state, out.note = "unavailable", f"Memory could not be reached ({str(e)[:80]}). This answer is general guidance only."
        return out
    if not results:
        out.note = "No related past incidents were found in memory, so this plan is general guidance."
        return out
    conn = db.get_connection()
    known = {r["incident_id"]: dict(r) for r in conn.execute(
        "SELECT s.*, e.name AS resolver_name FROM incident_solutions s LEFT JOIN employees e ON e.id = s.resolved_by_id")}
    conn.close()
    for r in results:
        meta = r.get("metadata") or {}
        label = str(meta.get("incident_id") or "")
        if label not in known:
            m = LABEL.search(r["text"])
            label = m.group(0) if m and m.group(0) in known else ""
        text = r["text"][:900]
        out.blocks.append(f"[{label}] {text}" if label else f"[context] {text}")
        if label:
            out.labels.add(label)
            if not any(s["label"] == label for s in out.sources):
                k = known[label]
                out.sources.append({"label": label, "title": f"{k['service']}: {k['symptoms'][:90]}", "service": k["service"],
                                    "resolved_by": k.get("resolver_name")})
    out.state = "used"
    out.note = ("Based on your team's recorded incidents." if live else
                "Memory is running in local fallback (the Hindsight key is missing or unreachable). It only knows incidents recorded since this server started.")
    return out


def clean_evidence(items: list[str], allowed: set[str]) -> list[str]:
    out = []
    for e in items:
        m = LABEL.search(str(e).upper())
        if m and m.group(0) in allowed and m.group(0) not in out:
            out.append(m.group(0))
    return out


def sanitize(a: TriageAnswer, allowed: set[str]) -> TriageAnswer:
    a.likely_cause.evidence = clean_evidence(a.likely_cause.evidence, allowed)
    if a.likely_cause.grounding == "memory" and not a.likely_cause.evidence:
        a.likely_cause.grounding = "general"
    for s in a.steps:
        s.evidence = clean_evidence(s.evidence, allowed)
        if s.grounding == "memory" and not s.evidence:
            s.grounding = "general"
    for v in a.avoid:
        v.evidence = clean_evidence(v.evidence, allowed)
    return a


def validate(cls, raw: dict):
    try:
        return cls.model_validate(raw)
    except ValidationError as e:
        raise err(502, "ai_bad_format", "The AI returned an answer in an unexpected format. Please try again.") from e


def attachment_context(rows) -> tuple[str, list[tuple[bytes, str]]]:
    text_parts, images, budget = [], [], 12000
    for r in rows:
        if r["kind"] == "image":
            if len(images) < 3:
                images.append(fileutil.image_for_vision(fileutil.read(r["owner_id"], r["id"])))
        elif r["extracted_text"] and budget > 0:
            chunk = r["extracted_text"][: min(6000, budget)]
            budget -= len(chunk)
            text_parts.append(f"--- FILE: {r['filename']} ---\n{chunk}")
    return "\n\n".join(text_parts), images


# ----------------------------------------------------------------------------------------------- sessions
class SessionIn(BaseModel):
    alert_text: str = Field(min_length=10, max_length=12000)
    service: Optional[str] = Field(default=None, max_length=100)
    attachment_ids: list[str] = Field(default=[], max_length=6)


class TickIn(BaseModel):
    done: bool


class ReportIn(BaseModel):
    message: str = Field(min_length=3, max_length=6000)
    attachment_ids: list[str] = Field(default=[], max_length=6)


def chart_for(conn, project_id: str, exclude: str) -> Optional[dict]:
    rows = conn.execute("SELECT * FROM guided_sessions WHERE project_id = ? AND status = 'resolved' AND completed_at IS NOT NULL AND id != ? ORDER BY completed_at DESC LIMIT 8",
                        (project_id, exclude)).fetchall()
    bars = []
    for r in rows:
        mins = round((datetime.fromisoformat(r["completed_at"]) - datetime.fromisoformat(r["created_at"])).total_seconds() / 60)
        bars.append({"label": f"TRI-{r['seq']:04d}", "title": json.loads(r["answer"])["headline"], "minutes": max(mins, 0), "service": r["service"] or ""})
    if not bars:
        return None
    return {"bars": bars, "median": statistics.median(b["minutes"] for b in bars)}


def view(conn, s) -> dict:
    ans = json.loads(s["answer"])
    done = json.loads(s["done"])
    steps = [{**st, "done": st["id"] in done, "done_at": done.get(st["id"])} for st in ans["steps"]]
    reports = []
    for r in conn.execute("SELECT r.*, e.name AS user_name FROM guided_reports r LEFT JOIN employees e ON e.id = r.user_id WHERE session_id = ? ORDER BY created_at", (s["id"],)):
        ids = json.loads(r["attachment_ids"])
        files = [file_view(f) for f in (conn.execute("SELECT * FROM guided_files WHERE id = ?", (i,)).fetchone() for i in ids) if f]
        reports.append({"id": r["id"], "step_id": r["step_id"], "message": r["message"], "attachments": files,
                        "response": json.loads(r["response"]) if r["response"] else None, "error": r["error"],
                        "user_name": r["user_name"], "created_at": r["created_at"]})
    att = [file_view(f) for f in (conn.execute("SELECT * FROM guided_files WHERE id = ?", (i,)).fetchone() for i in json.loads(s["attachment_ids"])) if f]
    creator = conn.execute("SELECT name FROM employees WHERE id = ?", (s["user_id"],)).fetchone()
    return {"id": s["id"], "reference": f"TRI-{s['seq']:04d}", "status": s["status"], "service": s["service"], "alert_text": s["alert_text"],
            "attachments": att, "headline": ans["headline"], "what_we_know": ans["what_we_know"], "likely_cause": ans["likely_cause"],
            "steps": steps, "avoid": ans["avoid"], "escalate_if": ans["escalate_if"], "gaps": ans["gaps"], "reports": reports,
            "progress": {"done": len(done), "total": len(steps)}, "memory": {**json.loads(s["memory"]), "model": s["model"]},
            "chart": chart_for(conn, s["project_id"], s["id"]), "created_by_name": creator["name"] if creator else "",
            "created_at": s["created_at"], "completed_at": s["completed_at"]}


def get_session(conn, sid: str, user: dict):
    s = conn.execute("SELECT * FROM guided_sessions WHERE id = ? AND project_id = ?", (sid, user["current_project_id"])).fetchone()
    if s is None:
        conn.close(); raise err(404, "not_found", "Triage session not found.")
    return s


@router.get("/status")
def status(user: dict = Depends(current_user)):
    import mailer
    return {"ai_configured": llmjson.configured(), "memory_live": memory.is_live_mode(), "email_configured": mailer.configured(),
            "max_upload_mb": MAX_UPLOAD // 1024 // 1024}


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, user: dict = Depends(current_user)):
    conn = db.get_connection()
    rows = load_files(conn, body.attachment_ids, user)
    att_text, images = attachment_context(rows)
    mem = gather_memory(f"{(body.service + ': ') if body.service else ''}{body.alert_text}\n{att_text[:1500]}")
    system = (f"You are NexusMemory, an incident-response copilot.\n\n{STYLE}\n\n{GROUNDING}\n\n{TRIAGE_SCHEMA}\nReply with the JSON object only.")
    user_msg = (f"ALERT / PROBLEM FROM THE ENGINEER:\n{body.alert_text}\n\n" + (f"SERVICE: {body.service}\n\n" if body.service else "")
                + (f"ATTACHED FILES:\n{att_text}\n\n" if att_text else "") + (f"({len(images)} screenshot(s) attached; read them carefully.)\n\n" if images else "")
                + f"PAST MEMORY (labels in brackets are the only valid citations):\n{chr(10).join(mem.blocks) if mem.blocks else '(none)'}")
    try:
        raw, model = llmjson.chat_json(system, user_msg, images=images or None)
    except Exception:
        conn.close(); raise
    ans = sanitize(validate(TriageAnswer, raw), mem.labels)
    if mem.state != "used":
        for s in ans.steps:
            s.grounding = "general"
        ans.likely_cause.grounding = "general"
    data = ans.model_dump()
    for i, st in enumerate(data["steps"], 1):
        st["id"], st["number"] = f"s{i}", i
    seq = (conn.execute("SELECT COALESCE(MAX(seq), 0) FROM guided_sessions").fetchone()[0]) + 1
    sid = uuid.uuid4().hex
    conn.execute("INSERT INTO guided_sessions (id, seq, project_id, user_id, service, alert_text, attachment_ids, answer, memory, model, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                 (sid, seq, user["current_project_id"], user["id"], body.service, body.alert_text, json.dumps(body.attachment_ids), json.dumps(data),
                  json.dumps({"state": mem.state, "note": mem.note, "sources": mem.sources}), model, now()))
    conn.commit()
    out = view(conn, get_session(conn, sid, user))
    conn.close()
    return out


@router.get("/sessions")
def list_sessions(user: dict = Depends(current_user)):
    conn = db.get_connection()
    rows = conn.execute("SELECT * FROM guided_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 50", (user["current_project_id"],)).fetchall()
    items = []
    for s in rows:
        ans = json.loads(s["answer"])
        u = conn.execute("SELECT name FROM employees WHERE id = ?", (s["user_id"],)).fetchone()
        items.append({"id": s["id"], "reference": f"TRI-{s['seq']:04d}", "headline": ans["headline"], "status": s["status"], "service": s["service"],
                      "progress": {"done": len(json.loads(s["done"])), "total": len(ans["steps"])}, "created_by_name": u["name"] if u else "", "created_at": s["created_at"]})
    conn.close()
    return {"items": items}


@router.get("/sessions/{sid}")
def one_session(sid: str, user: dict = Depends(current_user)):
    conn = db.get_connection()
    out = view(conn, get_session(conn, sid, user))
    conn.close()
    return out


@router.put("/sessions/{sid}/steps/{step_id}")
def tick(sid: str, step_id: str, body: TickIn, user: dict = Depends(current_user)):
    conn = db.get_connection()
    s = get_session(conn, sid, user)
    if s["status"] != "active":
        conn.close(); raise err(409, "closed", "This session is closed. Reopen it to change steps.")
    if step_id not in {st["id"] for st in json.loads(s["answer"])["steps"]}:
        conn.close(); raise err(404, "not_found", "Step not found.")
    done = json.loads(s["done"])
    if body.done:
        done[step_id] = now()
    else:
        done.pop(step_id, None)
    conn.execute("UPDATE guided_sessions SET done = ? WHERE id = ?", (json.dumps(done), sid)); conn.commit()
    out = view(conn, get_session(conn, sid, user)); conn.close()
    return out


@router.post("/sessions/{sid}/steps/{step_id}/reports", status_code=201)
def report_problem(sid: str, step_id: str, body: ReportIn, user: dict = Depends(current_user)):
    conn = db.get_connection()
    s = get_session(conn, sid, user)
    ans = json.loads(s["answer"])
    step = next((st for st in ans["steps"] if st["id"] == step_id), None)
    if step is None:
        conn.close(); raise err(404, "not_found", "Step not found.")
    rows = load_files(conn, body.attachment_ids, user)
    att_text, images = attachment_context(rows)
    done_titles = [st["title"] for st in ans["steps"] if st["id"] in json.loads(s["done"])]
    mem = gather_memory(f"{s['alert_text'][:800]}\nProblem at step '{step['title']}': {body.message}\n{att_text[:1200]}")
    system = (f"You are NexusMemory, an incident-response copilot helping an engineer who hit a problem on one step.\n\n{STYLE}\n\n{GROUNDING}\n\n{REPORT_SCHEMA}\nReply with the JSON object only.")
    user_msg = (f"ORIGINAL ALERT:\n{s['alert_text'][:3000]}\n\nTHE STEP THEY ARE ON:\nTitle: {step['title']}\nInstructions: {step['how']}\n"
                + (f"Command: {step['command']}\n" if step.get("command") else "") + f"Expected: {step.get('expected', '')}\n\n"
                + (f"STEPS ALREADY COMPLETED: {', '.join(done_titles)}\n\n" if done_titles else "")
                + f"WHAT WENT WRONG (in the engineer's words):\n{body.message}\n\n" + (f"ATTACHED FILES:\n{att_text}\n\n" if att_text else "")
                + (f"({len(images)} screenshot(s) attached; read them carefully.)\n\n" if images else "")
                + f"PAST MEMORY:\n{chr(10).join(mem.blocks) if mem.blocks else '(none)'}")
    response, error, model = None, None, None
    try:
        raw, model = llmjson.chat_json(system, user_msg, images=images or None, max_tokens=2200)
        r = validate(ReportAnswer, raw)
        for f in r.fixes:
            f.evidence = clean_evidence(f.evidence, mem.labels)
        response = json.dumps(r.model_dump())
    except HTTPException as e:  # the engineer's report is kept even if the AI fails
        error = e.detail["message"] if isinstance(e.detail, dict) else str(e.detail)
    conn.execute("INSERT INTO guided_reports VALUES (?,?,?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, sid, step_id, user["id"], body.message.strip(),
                 json.dumps(body.attachment_ids), response, error, model, now()))
    conn.commit()
    out = view(conn, get_session(conn, sid, user)); conn.close()
    return out


def _learn(conn, s, user: dict) -> bool:
    """When a session is closed, remember what the engineers actually did and hit. Only their own facts, never AI guesses."""
    ans = json.loads(s["answer"])
    done = json.loads(s["done"])
    lines = [f"Triage TRI-{s['seq']:04d} ({s['service'] or 'service unspecified'}) closed by {user['name']}.",
             f"Alert: {s['alert_text'][:600]}", "Steps completed: " + ("; ".join(st["title"] for st in ans["steps"] if st["id"] in done) or "none")]
    for r in conn.execute("SELECT * FROM guided_reports WHERE session_id = ? ORDER BY created_at", (s["id"],)):
        st = next((x for x in ans["steps"] if x["id"] == r["step_id"]), None)
        lines.append(f"Problem at step '{st['title'] if st else r['step_id']}': {r['message'][:500]}")
    return bool(memory.retain(team_id="nexus-core", content="\n".join(lines), incident_id=f"TRI-{s['seq']:04d}",
                              metadata={"service": s["service"] or "", "source": "guided_triage"}))


@router.post("/sessions/{sid}/complete")
def complete(sid: str, user: dict = Depends(current_user)):
    conn = db.get_connection()
    s = get_session(conn, sid, user)
    saved = _learn(conn, s, user)
    conn.execute("UPDATE guided_sessions SET status = 'resolved', completed_at = ? WHERE id = ?", (now(), sid)); conn.commit()
    out = view(conn, get_session(conn, sid, user)); conn.close()
    out["memory_saved"] = saved and memory.is_live_mode()
    return out


@router.post("/sessions/{sid}/reopen")
def reopen(sid: str, user: dict = Depends(current_user)):
    conn = db.get_connection()
    get_session(conn, sid, user)
    conn.execute("UPDATE guided_sessions SET status = 'active', completed_at = NULL WHERE id = ?", (sid,)); conn.commit()
    out = view(conn, get_session(conn, sid, user)); conn.close()
    return out
