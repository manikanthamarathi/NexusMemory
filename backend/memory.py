"""
Thread-isolated Hindsight Memory Integration for NexusMemory.
Ensures zero event-loop conflicts with FastAPI/Uvicorn, stringifies all metadata keys/values,
and supports both Live Vectorize Cloud and intelligent fallback simulation.
"""
import os
import re
import concurrent.futures
from datetime import datetime
from typing import List, Dict, Any, Optional

_FALLBACK_BANKS: Dict[str, Dict[str, Any]] = {}
_FALLBACK_INCIDENTS: Dict[str, List[Dict[str, Any]]] = {}
_client = None
_live_mode = False

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

def client():
    global _client, _live_mode
    api_key = os.getenv("HINDSIGHT_API_KEY", "").strip()
    base_url = os.getenv("HINDSIGHT_BASE_URL", "https://api.hindsight.vectorize.io").strip()
    
    if api_key or "localhost" in base_url or "127.0.0.1" in base_url:
        try:
            from hindsight_client import Hindsight
            kwargs = {"base_url": base_url, "timeout": 30}
            if api_key:
                kwargs["api_key"] = api_key
            _client = Hindsight(**kwargs)
            _live_mode = True
            return _client
        except Exception as e:
            print(f"[WARN] Live Hindsight client unavailable: {e}. Using simulated fallback.")
            _live_mode = False
            return None
    _live_mode = False
    return None

def is_live_mode() -> bool:
    client()
    return _live_mode

def bank_for(team_id: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", team_id.lower())
    return f"nexus-{cleaned}"

def _sync_create_bank(c, b_id, name, mission):
    return c.create_bank(
        bank_id=b_id,
        name=name,
        mission=mission,
        disposition={"skepticism": 3, "literalism": 3, "empathy": 4},
    )

def ensure_bank(team_id: str, team_name: str) -> bool:
    c = client()
    b_id = bank_for(team_id)
    if c and _live_mode:
        try:
            mission = (
                "Maintain the institutional incident memory and bug resolution graph for "
                "200-300 enterprise engineers and individual developers. "
                "Track symptoms, metrics, root causes, failed interventions, resolution playbooks, "
                "and exact code diffs to accelerate future triage and prevent repeat mistakes."
            )
            _executor.submit(_sync_create_bank, c, b_id, f"NexusMemory: {team_name}", mission).result(timeout=15)
            return True
        except Exception:
            return True
    else:
        if b_id not in _FALLBACK_BANKS:
            _FALLBACK_BANKS[b_id] = {"name": team_name, "created_at": datetime.utcnow().isoformat()}
            _FALLBACK_INCIDENTS[b_id] = []
        return True

def _sync_retain(c, b_id, content, context, timestamp, meta):
    return c.retain(
        bank_id=b_id,
        content=content,
        context=context,
        timestamp=timestamp,
        metadata=meta,
    )

def retain(team_id: str, content: str, incident_id: str, metadata: Optional[Dict[str, Any]] = None, timestamp: Optional[datetime] = None) -> bool:
    c = client()
    b_id = bank_for(team_id)
    ensure_bank(team_id, team_id)
    
    meta = metadata or {}
    meta["incident_id"] = str(incident_id)
    meta["retained_at"] = (timestamp or datetime.utcnow()).isoformat()
    hindsight_meta = {str(k): str(v) for k, v in meta.items() if v is not None}

    if b_id not in _FALLBACK_INCIDENTS:
        _FALLBACK_INCIDENTS[b_id] = []
        
    existing_ids = [item.get("metadata", {}).get("incident_id") for item in _FALLBACK_INCIDENTS[b_id]]
    if str(incident_id) not in existing_ids:
        _FALLBACK_INCIDENTS[b_id].append({
            "content": content,
            "incident_id": str(incident_id),
            "metadata": meta,
            "timestamp": timestamp or datetime.utcnow(),
        })

    if c and _live_mode:
        try:
            _executor.submit(
                _sync_retain,
                c,
                b_id,
                content,
                f"Incident Record #{incident_id}",
                timestamp or datetime.utcnow(),
                hindsight_meta,
            ).result(timeout=20)
            return True
        except Exception as e:
            print(f"[WARN] Live retain error: {e}")
            return True
    return True

def _sync_recall(c, b_id, query, max_tokens):
    return c.recall(bank_id=b_id, query=query, budget="mid", max_tokens=max_tokens)

def recall(team_id: str, query: str, max_tokens: int = 3000) -> List[Dict[str, Any]]:
    c = client()
    b_id = bank_for(team_id)
    
    if c and _live_mode:
        try:
            resp = _executor.submit(_sync_recall, c, b_id, query, max_tokens).result(timeout=20)
            results = []
            for r in resp.results:
                results.append({
                    "text": r.text,
                    "type": getattr(r, "type", "episodic"),
                    "score": getattr(r, "score", 0.95),
                    "metadata": getattr(r, "metadata", {}) or {},
                })
            if results:
                return results
        except Exception as e:
            print(f"[WARN] Live recall error: {e}. Using fallback.")

    records = _FALLBACK_INCIDENTS.get(b_id, [])
    if not records:
        return []

    tokens = set(re.findall(r"\w+", query.lower()))
    scored_records = []
    
    for rec in records:
        text = rec["content"]
        rec_tokens = set(re.findall(r"\w+", text.lower()))
        common = tokens.intersection(rec_tokens)
        score = len(common) / max(len(tokens), 1)
        for special in ["hikari", "pool", "502", "504", "ssl", "cert", "redis", "keyerror", "sms", "kafka", "rebalance"]:
            if special in query.lower() and special in text.lower():
                score += 0.4
        if score > 0.15:
            scored_records.append((score, rec))
            
    scored_records.sort(key=lambda x: x[0], reverse=True)
    recalled = []
    for score, rec in scored_records[:3]:
        recalled.append({
            "text": rec["content"],
            "type": "episodic",
            "score": round(min(score, 0.98), 2),
            "metadata": rec.get("metadata", {}),
        })
    return recalled

def _sync_reflect(c, b_id, query):
    return c.reflect(bank_id=b_id, query=query, budget="low")

def reflect(team_id: str, prompt: str) -> str:
    c = client()
    b_id = bank_for(team_id)
    
    if c and _live_mode:
        try:
            resp = _executor.submit(_sync_reflect, c, b_id, prompt).result(timeout=30)
            if resp and getattr(resp, "text", None):
                return resp.text
        except Exception as e:
            print(f"[WARN] Live reflect error: {e}")

    # Fallback (Hindsight not live): synthesise over what this server holds in local memory, with the real LLM. Nothing is pre-written.
    import llm
    from fastapi import HTTPException
    records = _FALLBACK_INCIDENTS.get(b_id, [])
    if not records:
        raise HTTPException(409, "There is nothing in memory to analyse yet. Record some incidents first.")
    corpus = "\n\n".join(f"[{r.get('incident_id')}] {r['content'][:700]}" for r in records[:40])
    return llm.complete(
        "You analyse a team's incident history for recurring patterns. Use ONLY the records given; cite incident IDs from the brackets; never invent incidents. "
        "Plain text with these headings on their own lines: RECURRING CAUSES, WHAT FAILED BEFORE, WHAT TO DO ABOUT IT (3 prioritised actions). No markdown symbols, no emojis.",
        f"{prompt}\n\nINCIDENT RECORDS ({len(records)}):\n{corpus}")

def list_all_retained(team_id: str) -> List[Dict[str, Any]]:
    b_id = bank_for(team_id)
    return _FALLBACK_INCIDENTS.get(b_id, [])
