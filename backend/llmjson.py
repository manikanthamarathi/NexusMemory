"""Groq chat completions (OpenAI-compatible) returning validated JSON. No canned answers: if the model is not
configured or fails, the caller gets a clear error."""
import base64
import json
import logging
import re

import os
from fastapi import HTTPException


def err(status, code, message):
    return HTTPException(status, {"code": code, "message": message})

log = logging.getLogger("nexus.llm")
_client = None


class LLMError(Exception):
    pass


def configured() -> bool:
    return bool(os.getenv("GROQ_API_KEY", "").strip())


def _client_get():
    global _client
    if _client is None:
        from openai import OpenAI
        _client = OpenAI(api_key=os.getenv("GROQ_API_KEY", "").strip(), base_url="https://api.groq.com/openai/v1", timeout=90.0,
                         max_retries=2)
    return _client


def reset_client() -> None:
    global _client
    _client = None


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def chat_json(system: str, user: str, *, images: list[tuple[bytes, str]] | None = None,
              max_tokens: int = 3500, temperature: float = 0.2) -> tuple[dict, str]:
    """Returns (parsed_json, model_used)."""
    if not configured():
        raise err(503, "ai_not_configured", "The AI model is not configured on this server (GROQ_API_KEY is missing).")
    model = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b") if images else os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    if images:
        content = [{"type": "text", "text": user}] + [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(b).decode()}"}}
            for b, mime in images[:3]]
    else:
        content = user
    messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]
    last: Exception | None = None
    for attempt in range(2):
        try:
            resp = _client_get().chat.completions.create(
                model=model, messages=messages, temperature=temperature, max_tokens=max_tokens,
                response_format={"type": "json_object"})
            raw = resp.choices[0].message.content or ""
            return _extract_json(raw), model
        except json.JSONDecodeError as e:
            last = e
            messages = messages + [{"role": "user", "content": "Your last reply was not valid JSON. Reply again with ONLY the JSON object."}]
        except Exception as e:  # noqa: BLE001
            last = e
            log.warning("Groq call failed (attempt %s): %s", attempt + 1, e)
            if "401" in str(e) or "invalid_api_key" in str(e).lower():
                break
    raise err(502, "ai_failed", f"The AI model could not complete the request ({type(last).__name__}). Please try again.")
