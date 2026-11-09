"""Groq LLM layer. No canned answers: if the model is not configured or fails, the caller gets a clear error."""
import os
from typing import Optional

from fastapi import HTTPException

_groq_client = None

ANSWER_STYLE = (
    "Write for a tired on-call engineer. Use exactly these plain headings, each on its own line followed by short lines: "
    "DIAGNOSIS, DO THIS FIRST (numbered 1-3), DO NOT DO, ESCALATE IF. Short sentences, no emojis, no bold or markdown symbols, "
    "put commands on their own line starting with $. Keep it under 220 words."
)


def get_llm():
    global _groq_client
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    from openai import OpenAI
    if _groq_client is None:
        _groq_client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1", timeout=60.0, max_retries=1)
    return _groq_client


def complete(system_prompt: str, user_prompt: str, model: Optional[str] = None) -> str:
    client = get_llm()
    if client is None:
        raise HTTPException(503, "The AI model is not configured on this server (GROQ_API_KEY is missing).")
    try:
        response = client.chat.completions.create(
            model=model or os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.2, max_tokens=1200)
        content = (response.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Groq call failed: {type(e).__name__}: {e}")
        raise HTTPException(502, "The AI model could not complete the request. Please try again.")
    if not content:
        raise HTTPException(502, "The AI model returned an empty answer. Please try again.")
    return content
