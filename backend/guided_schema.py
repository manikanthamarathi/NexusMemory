from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _strs(v, limit: int, maxlen: int = 400):
    if v is None:
        return []
    if isinstance(v, str):
        v = [v]
    return [str(x).strip()[:maxlen] for x in v if str(x).strip()][:limit]


class Cause(BaseModel):
    text: str = Field(min_length=3, max_length=600)
    grounding: Literal["memory", "general"] = "general"
    evidence: list[str] = []

    @field_validator("evidence", mode="before")
    @classmethod
    def _e(cls, v):
        return _strs(v, 6, 40)


class Step(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    why: str = Field(default="", max_length=500)
    how: str = Field(min_length=3, max_length=1500)
    command: str | None = Field(default=None, max_length=1200)
    expected: str = Field(default="", max_length=500)
    grounding: Literal["memory", "general"] = "general"
    evidence: list[str] = []
    risk: Literal["low", "medium", "high"] = "low"

    @field_validator("evidence", mode="before")
    @classmethod
    def _e(cls, v):
        return _strs(v, 6, 40)

    @field_validator("command", mode="before")
    @classmethod
    def _c(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return None


class Avoid(BaseModel):
    action: str = Field(min_length=3, max_length=300)
    reason: str = Field(default="", max_length=500)
    evidence: list[str] = []

    @field_validator("evidence", mode="before")
    @classmethod
    def _e(cls, v):
        return _strs(v, 6, 40)


class TriageAnswer(BaseModel):
    headline: str = Field(min_length=5, max_length=220)
    what_we_know: list[str] = []
    likely_cause: Cause
    steps: list[Step] = Field(min_length=2, max_length=8)
    avoid: list[Avoid] = []
    escalate_if: list[str] = []
    gaps: list[str] = []

    @field_validator("what_we_know", "escalate_if", "gaps", mode="before")
    @classmethod
    def _l(cls, v):
        return _strs(v, 5, 400)

    @field_validator("avoid", mode="before")
    @classmethod
    def _a(cls, v):
        return (v or [])[:5]


class Fix(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    how: str = Field(min_length=3, max_length=1500)
    command: str | None = Field(default=None, max_length=1200)
    expected: str = Field(default="", max_length=500)
    evidence: list[str] = []

    @field_validator("evidence", mode="before")
    @classmethod
    def _e(cls, v):
        return _strs(v, 6, 40)

    @field_validator("command", mode="before")
    @classmethod
    def _c(cls, v):
        return (v.strip() or None) if isinstance(v, str) else None


class ReportAnswer(BaseModel):
    understanding: str = Field(min_length=3, max_length=800)
    likely_reason: str = Field(default="", max_length=800)
    fixes: list[Fix] = Field(min_length=1, max_length=4)
    then: str = Field(default="", max_length=500)
    escalate: bool = False
    escalate_reason: str = Field(default="", max_length=400)
    missing_info: list[str] = []

    @field_validator("missing_info", mode="before")
    @classmethod
    def _m(cls, v):
        return _strs(v, 4, 300)
