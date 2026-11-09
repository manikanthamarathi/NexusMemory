"""
NexusMemory Universal Enterprise Backend with Real SQLite Database,
Email OTP Verification, Physical GPS Geofencing, and Hindsight Memory.
"""
import time
import os
import random
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

import db
import memory
import llm
import web_intelligence
import simulator
import otp
import mailer
import guided

AUTO_HEAL_THRESHOLD = float(os.getenv("AUTO_HEAL_THRESHOLD", "90.0"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_database()
    otp.init()
    guided.init()
    memory.ensure_bank("nexus-core", "Nexus Enterprise Core")
    
    # Sync SQLite solutions into Hindsight memory
    conn = db.get_connection()
    solutions = conn.execute("SELECT * FROM incident_solutions").fetchall()
    for sol in solutions:
        content = (
            f"{sol['incident_id']} - {sol['symptoms']} "
            f"Root cause: {sol['root_cause']} "
            f"Failed attempts: {sol['failed_attempts']} "
            f"Proven Resolution: {sol['exact_fix']} "
            f"Target: {sol['file_path']}:{sol['exact_line']}"
        )
        memory.retain(
            team_id="nexus-core",
            content=content,
            incident_id=sol["incident_id"],
            metadata={
                "incident_id": str(sol["incident_id"]),
                "service": str(sol["service"]),
                "confidence": str(sol["confidence_score"])
            }
        )
    conn.close()
    yield

app = FastAPI(
    title="NexusMemory Real Enterprise Core",
    description="Real SQLite Multi-Tenant Incident Intelligence with GPS Geofencing & Email OTPs",
    version="5.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(guided.router)


class SendOtpRequest(BaseModel):
    email: str

class VerifyOtpRequest(BaseModel):
    email: str
    otp_code: str

class RealRegisterRequest(BaseModel):
    employee_id: str
    name: str
    email: str
    role: str
    department: str
    otp_code: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    target_campus_id: str = "HYD-CAMPUS-01"
    corporate_wifi: str = "Enterprise-Corp-5GHz"

class RealLoginRequest(BaseModel):
    employee_id: str
    password: Optional[str] = None

class TriageRequest(BaseModel):
    user_id: str = "EMP-1042"
    project_id: str = "PRJ-PAYCORE"
    alert_text: str
    proposed_step: Optional[str] = None
    use_memory: bool = True

class WhatIfRequest(BaseModel):
    user_action: str
    incident_context: str

@app.get("/api/health")
def get_health():
    conn = db.get_connection()
    emp_count = conn.execute("SELECT count(*) FROM employees").fetchone()[0]
    prj_count = conn.execute("SELECT count(*) FROM projects").fetchone()[0]
    conn.close()
    return {
        "status": "online",
        "service": "NexusMemory Real SQLite Engine",
        "hindsight_live": memory.is_live_mode(),
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "database_type": "Persistent SQLite (nexus_enterprise.db)",
        "employees_registered": emp_count,
        "active_projects": prj_count,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/auth/send-otp")
def send_email_otp(req: SendOtpRequest):
    email = req.email.strip().lower()
    if "@" not in email or len(email) > 254:
        raise HTTPException(422, "Enter a valid email address.")
    res = otp.issue(email)
    if res["wait"]:
        raise HTTPException(429, f"Please wait {res['wait']} seconds before requesting another code.")
    if not res["sent"] and not res["dev_code"]:
        raise HTTPException(503, "The verification email could not be sent. The server's email (SMTP) settings are missing or wrong.")
    out = {"success": True, "email": email, "message": f"A 6-digit code was sent to {email}. It expires in {otp.TTL_MIN} minutes."}
    if res["dev_code"]:  # only when SMTP is not configured AND DEV_SHOW_OTP=true (local development)
        out["otp_preview"] = res["dev_code"]
        out["message"] = "Development mode: email is not configured, so the code is shown here."
    return out

@app.post("/api/auth/verify-otp")
def verify_email_otp(req: VerifyOtpRequest):
    ok, msg = otp.verify(req.email.strip().lower(), req.otp_code)
    if not ok:
        raise HTTPException(400, msg)
    return {"success": True, "message": msg}

@app.post("/api/auth/register-real")
def register_real_employee(req: RealRegisterRequest):
    email = req.email.strip().lower()
    
    # 1. Verify OTP was confirmed
    if not otp.consume_verified(email):
        raise HTTPException(400, "Email verification required. Verify the 6-digit code first (codes expire after 10 minutes).")
    conn = db.get_connection()
    clash = conn.execute("SELECT id, email FROM employees WHERE id = ? OR email = ?", (req.employee_id.upper(), email)).fetchone()
    if clash:
        conn.close()
        raise HTTPException(409, "That employee ID or email is already registered. Sign in instead.")

    # 2. Real GPS Office Geofencing calculation
    target_campus = next((c for c in db.CAMPUSES if c["id"] == req.target_campus_id), db.CAMPUSES[0])
    distance_km = 0.4 # Default within campus
    is_in_office = True
    
    if req.latitude is not None and req.longitude is not None:
        distance_km = db.calculate_haversine_distance(req.latitude, req.longitude, target_campus["lat"], target_campus["lon"])
        is_in_office = distance_km <= target_campus["max_radius_km"]

    # 3. Check corporate Wi-Fi
    wifi_ok = any(w in req.corporate_wifi.lower() for w in ["office", "corp", "internal", "secure", "paynest", "enterprise", "campus", "5ghz"])
    verified_office = 1 if (is_in_office or wifi_ok) else 0

    # 4. Insert into real SQLite database
    avatar = f"https://api.dicebear.com/7.x/bottts/svg?seed={req.name.split()[0]}"
    try:
        conn.execute("""
        INSERT OR REPLACE INTO employees 
        (id, name, email, role, department, avatar, office_verified, verified_campus, verified_distance_km, network_zone, current_project_id, solved_count, reputation_score, registered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRJ-PAYCORE', 0, 5.0, datetime('now'))
        """, (
            req.employee_id.upper(),
            req.name,
            email,
            req.role,
            req.department,
            avatar,
            verified_office,
            target_campus["name"] if verified_office else "Remote / Off-Campus",
            distance_km,
            "CORP_VLAN_10G_SECURE" if verified_office else "REMOTE_VPN_mTLS"
        ))
        
        # Log into real audit table
        conn.execute("""
        INSERT INTO audit_logs (id, timestamp, type, severity, title, actor, details)
        VALUES (?, datetime('now'), 'BADGE_REGISTRATION', 'INFO', ?, ?, ?)
        """, (
            f"AUDIT-{int(time.time())}",
            f"New Employee Badge: {req.employee_id}",
            req.name,
            f"Office Verified: {bool(verified_office)} | Distance to Campus: {distance_km} km"
        ))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(500, f"Database write error: {e}")

    row = conn.execute("SELECT * FROM employees WHERE id = ?", (req.employee_id.upper(),)).fetchone()
    emp_data = dict(row)
    conn.close()

    return {
        "success": True,
        "token": guided.make_token(emp_data["id"]),
        "employee": emp_data,
        "office_verified": bool(verified_office),
        "distance_km": distance_km,
        "campus": target_campus["name"],
        "message": f"Employee {req.name} verified and inserted into persistent corporate database."
    }

@app.post("/api/auth/login-real")
def login_real_employee(req: RealLoginRequest):
    conn = db.get_connection()
    emp_id = req.employee_id.strip().upper()
    row = conn.execute("SELECT * FROM employees WHERE id = ?", (emp_id,)).fetchone()
    if not row:
        # Check if email passed
        row = conn.execute("SELECT * FROM employees WHERE email = ?", (req.employee_id.strip().lower(),)).fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(404, "No account found for that employee ID or email. Register first.")

    emp_dict = dict(row)
    conn.close()
    return {
        "success": True,
        "token": guided.make_token(emp_dict["id"]),
        "employee": emp_dict,
        "message": f"Successfully authenticated as {emp_dict['name']}."
    }

@app.get("/api/employees")
def list_real_employees():
    conn = db.get_connection()
    rows = conn.execute("SELECT * FROM employees ORDER BY solved_count DESC").fetchall()
    data = [dict(r) for r in rows]
    conn.close()
    return data

@app.get("/api/projects")
def list_real_projects():
    conn = db.get_connection()
    rows = conn.execute("SELECT * FROM projects").fetchall()
    data = []
    for r in rows:
        d = dict(r)
        d["active_services"] = [s.strip() for s in d.get("active_services", "").split(",")]
        data.append(d)
    conn.close()
    return data

@app.get("/api/solutions")
def list_real_solutions():
    conn = db.get_connection()
    rows = conn.execute("""
    SELECT s.*, e.name as resolver_name, e.role as resolver_role, e.email as resolver_email, e.avatar as resolver_avatar
    FROM incident_solutions s
    JOIN employees e ON s.resolved_by_id = e.id
    ORDER BY s.confidence_score DESC
    """).fetchall()
    data = [dict(r) for r in rows]
    conn.close()
    return data

@app.get("/api/campuses")
def list_campuses():
    return db.CAMPUSES

@app.post("/api/triage")
def triage_issue(req: TriageRequest):
    t0 = time.time()
    recalled_items = []
    internal_match = None
    external_solution = None
    q_low = req.alert_text.lower()
    
    # 1. STATELESS BASELINE MODE: the same model, but told nothing about this company's history (a real "amnesia" comparison)
    if not req.use_memory:
        ai_answer = llm.complete(
            "You are a generic incident-response assistant with NO access to this company's history, past incidents or runbooks. "
            "Answer only from the alert text and general engineering knowledge. " + llm.ANSWER_STYLE,
            f"INCOMING ERROR TELEMETRY:\n{req.alert_text}")
        return {
            "answer": ai_answer, "internal_match": None, "external_solution": None, "recalled_memories": [], "impact_analysis": None,
            "self_healing": {"attempted": False, "auto_healed": False, "confidence": 0.0,
                             "action_taken": "Stateless mode: no memory, no automatic recommendation.", "message": "Zero institutional memory active."},
            "elapsed_ms": round((time.time() - t0) * 1000, 2), "mode": "Stateless Baseline"
        }

    # 2. NEXUSMEMORY ENTERPRISE BRAIN MODE (Powered by Hindsight Persistent Memory)
    try:
        recalled_items = memory.recall("nexus-core", req.alert_text)
    except Exception as e:
        print(f"[WARN] Recall error: {e}")
        recalled_items = []

    # Accurate Keyword Match in SQLite Knowledge Vault
    conn = db.get_connection()
    rows = conn.execute("""
    SELECT s.*, e.name as resolver_name, e.role as resolver_role, e.email as resolver_email, e.avatar as resolver_avatar
    FROM incident_solutions s
    JOIN employees e ON s.resolved_by_id = e.id
    """).fetchall()
    
    # Match specific outage types in prioritized order
    target_inc = None
    if any(k in q_low for k in ["hikari", "connection is not available", "timed out after 30000ms", "maxlifetime"]):
        target_inc = "INC-101"
    elif any(k in q_low for k in ["ssl", "certificate", "cert", "expired", "razorpay"]):
        target_inc = "INC-107"
    elif any(k in q_low for k in ["redis", "eviction", "keys/sec", "ttl bloat", "flushall"]):
        target_inc = "INC-112"

    for r in rows:
        sol = dict(r)
        if target_inc and sol["incident_id"] == target_inc:
            internal_match = sol
            break
        elif not target_inc and sol["service"].lower() in q_low:
            internal_match = sol
            break
    conn.close()

    if not internal_match:
        external_solution = web_intelligence.search_global_web(req.alert_text)

    context = ""
    if internal_match:
        context = (
            f"INTERNAL SOLVER: {internal_match['resolver_name']} ({internal_match['resolver_role']})\n"
            f"Contact: {internal_match['resolver_email']}\n"
            f"Root cause: {internal_match['root_cause']}\n"
            f"FAILED ATTEMPTS (DO NOT REPEAT): {internal_match['failed_attempts']}\n"
            f"EXACT FIX: {internal_match['exact_fix']} in {internal_match['file_path']} line {internal_match['exact_line']}\n"
            f"DIFF:\n{internal_match['code_diff']}"
        )
    elif recalled_items:
        context = "\n".join([f"- {m['text']}" for m in recalled_items])
    prompt = (f"INCIDENT MEMORY:\n{context}\n\n" if context else "INCIDENT MEMORY: (none)\n\n") + f"INCOMING ERROR TELEMETRY:\n{req.alert_text}"
    system_prompt = (
        "You are the NexusMemory SRE copilot. You DO have this company's incident memory (below). Use it: name the past incident ID and the engineer "
        "who solved it, repeat what failed before as things NOT to do, and give the proven fix. If memory does not apply, say so plainly and do not invent history. "
        + llm.ANSWER_STYLE
    )
    
    ai_answer = llm.complete(system_prompt, prompt)
    
    impact_result = None
    if req.proposed_step:
        impact_result = simulator.simulate_what_if(req.proposed_step, req.alert_text)

    confidence = internal_match["confidence_score"] if internal_match else (external_solution.get("confidence_score", 65.0) if external_solution else 50.0)
    
    self_healing = {
        "attempted": True,
        "auto_healed": False,
        "confidence": confidence,
        "action_taken": f"Recommended patch from {internal_match['resolver_name']}: {internal_match['file_path']}:{internal_match['exact_line']}. Nothing is changed automatically; an engineer must review and apply it." if (confidence >= AUTO_HEAL_THRESHOLD and internal_match) else "Confidence is below the safety threshold: follow the guided steps and involve a human lead.",
        "message": "High-confidence match with a recorded past fix. Review it, then work through the guided steps below." if (confidence >= AUTO_HEAL_THRESHOLD and internal_match) else "No high-confidence match. Treat the answer as guidance and escalate if it does not resolve the issue."
    }

    elapsed_ms = round((time.time() - t0) * 1000, 2)
    
    return {
        "answer": ai_answer,
        "internal_match": internal_match,
        "external_solution": external_solution,
        "impact_result": impact_result,
        "self_healing": self_healing,
        "memories_used": recalled_items,
        "execution_time_ms": elapsed_ms,
        "mode": "live" if memory.is_live_mode() else "simulated_fallback"
    }

@app.post("/api/simulate-what-if")
def simulate_action(req: WhatIfRequest):
    return simulator.simulate_what_if(req.user_action, req.incident_context)

@app.post("/api/patterns")
def analyze_patterns():
    report_text = memory.reflect(
        "nexus-core",
        "Synthesize recurring patterns across all outages and bug resolutions. Identify repeat anti-patterns and recommend 3 prioritized preventative actions."
    )
    return {
        "report": report_text,
        "mode": "live" if memory.is_live_mode() else "simulated_fallback"
    }

@app.post("/api/upload-multimodal")
async def upload_multimodal(file: UploadFile = File(...), notes: Optional[str] = Form(None)):
    import fileutil
    content = await file.read(11 * 1024 * 1024)
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Files must be between 1 byte and 10 MB.")
    try:
        info = fileutil.inspect(fileutil.safe_name(file.filename or "file"), content)
    except HTTPException as e:
        raise HTTPException(e.status_code, e.detail["message"] if isinstance(e.detail, dict) else e.detail)
    doc_id = f"DOC-{int(time.time())}"
    if info.kind == "image":
        raise HTTPException(422, "Screenshots cannot be stored as knowledge (no readable text). Attach them to a guided triage step instead.")
    if not (info.text or "").strip():
        raise HTTPException(422, "No readable text was found in this file (is it a scanned PDF?).")
    memory.retain(team_id="nexus-core", content=f"Document: {file.filename}. Notes: {notes or '-'}\n{info.text[:6000]}", incident_id=doc_id,
                  metadata={"filename": str(file.filename), "type": "document"})
    return {"success": True, "asset_id": doc_id, "filename": file.filename, "size_bytes": len(content), "characters_read": len(info.text),
            "status": "RETAINED_INTO_HINDSIGHT" if memory.is_live_mode() else "RETAINED_LOCALLY_ONLY",
            "message": f"Read {len(info.text):,} characters from {file.filename}. " + ("Saved to Hindsight memory." if memory.is_live_mode() else "Saved to local memory only: Hindsight is not connected.")}
