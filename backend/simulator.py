"""What-If impact analysis. The model reasons about the proposed action against the incident context; nothing is pre-written."""
import llmjson

SYSTEM = """You assess the risk of an engineer's proposed action during an incident. Be concrete and honest; if you cannot tell, say so.
Plain sentences, no markdown, no emojis. Return ONE JSON object with exactly these keys:
{"risk_rating": "LOW RISK | MODERATE RISK | HIGH RISK | CRITICAL RISK",
 "confidence_score": number 0-100 (how likely the action helps, not how sure you are),
 "predicted_outcome": "what will most likely happen, 1-3 short sentences",
 "what_happens_if_changed": "what changes in the system if the action is taken",
 "recommended_fix": "the safer or better action, or 'Proceed as planned' if it is fine",
 "target_file": "a file path ONLY if the context names one, otherwise 'Not specified'",
 "target_line": 0,
 "code_impact_diff": "a short diff or command only if it is clear from the context, otherwise an empty string"}"""


def simulate_what_if(user_action: str, incident_context: str) -> dict:
    raw, model = llmjson.chat_json(SYSTEM, f"INCIDENT CONTEXT:\n{incident_context[:4000]}\n\nPROPOSED ACTION:\n{user_action[:1500]}", max_tokens=900)
    try:
        score = max(0.0, min(100.0, float(raw.get("confidence_score", 0))))
    except (TypeError, ValueError):
        score = 0.0
    g = lambda k, d="": str(raw.get(k) or d)
    return {"action": user_action, "confidence_score": round(score, 1), "risk_rating": g("risk_rating", "UNKNOWN RISK").upper(),
            "predicted_outcome": g("predicted_outcome"), "what_happens_if_changed": g("what_happens_if_changed"),
            "recommended_fix": g("recommended_fix"), "target_file": g("target_file", "Not specified"),
            "target_line": raw.get("target_line") if isinstance(raw.get("target_line"), int) and raw.get("target_line") else "-",
            "code_impact_diff": g("code_impact_diff"), "model": model}
