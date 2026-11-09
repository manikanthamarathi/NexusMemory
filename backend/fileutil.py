"""Validate, store and read uploads; extract text from documents. Content is checked, never just the extension."""
import hashlib
import io
import os
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from fastapi import HTTPException


def err(status, code, message):
    return HTTPException(status, {"code": code, "message": message})


def _upload_root() -> str:
    return os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads"))

IMAGE_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}
TEXT_EXT = {".txt", ".log", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".sql", ".conf", ".ini", ".out", ".toml", ".tsv"}
MAX_TEXT_CHARS = 200_000


@dataclass
class Inspected:
    kind: str
    content_type: str
    width: int | None = None
    height: int | None = None
    text: str | None = None
    extraction: str = "none"


def safe_name(name: str) -> str:
    base = os.path.basename(name or "file").replace("\x00", "")
    base = re.sub(r"[^\w.\- ()\[\]]", "_", base).strip(" .") or "file"
    return base[:200]


def _extract_pdf(data: bytes) -> tuple[str, str]:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return "", "failed"
        parts = [(page.extract_text() or "") for page in reader.pages[:200]]
        text = "\n\n".join(p.strip() for p in parts if p.strip())
        return text[:MAX_TEXT_CHARS], ("ok" if text.strip() else "empty")
    except Exception:  # noqa: BLE001
        return "", "failed"


def _extract_docx(data: bytes) -> tuple[str, str]:
    import docx
    try:
        d = docx.Document(io.BytesIO(data))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for table in d.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    parts.append(" | ".join(cells))
        text = "\n".join(parts)
        return text[:MAX_TEXT_CHARS], ("ok" if text.strip() else "empty")
    except Exception:  # noqa: BLE001
        return "", "failed"


def inspect(filename: str, data: bytes) -> Inspected:
    ext = Path(filename).suffix.lower()
    if data[:5] == b"%PDF-":
        text, status = _extract_pdf(data)
        return Inspected("document", "application/pdf", text=text, extraction=status)
    if data[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "word/document.xml" in z.namelist():
                    text, status = _extract_docx(data)
                    return Inspected("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                     text=text, extraction=status)
        except zipfile.BadZipFile:
            pass
        raise err(415, "unsupported_file", "Only Word (.docx) archives are supported, not other zip files.")
    try:
        with Image.open(io.BytesIO(data)) as im:
            fmt = im.format
            if fmt in IMAGE_TYPES:
                im.verify()
                return Inspected("image", IMAGE_TYPES[fmt], width=im.width, height=im.height)
    except (UnidentifiedImageError, OSError, SyntaxError):
        pass
    if ext in TEXT_EXT and b"\x00" not in data[:4096]:
        text = data.decode("utf-8", errors="replace")[:MAX_TEXT_CHARS]
        return Inspected("document", "text/plain", text=text, extraction=("ok" if text.strip() else "empty"))
    raise err(415, "unsupported_file",
              "Unsupported file type. Use images (PNG, JPG, GIF, WebP), PDF, Word (.docx), or text files such as .txt, .log, .csv, .json, .yaml, .md.")


def storage_path(org_id: str, attachment_id: str) -> Path:
    root = Path(_upload_root()).resolve()
    path = (root / org_id / attachment_id).resolve()
    if root not in path.parents:  # defence in depth against traversal
        raise err(400, "bad_path", "Invalid storage path.")
    return path


def save(org_id: str, attachment_id: str, data: bytes) -> None:
    p = storage_path(org_id, attachment_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def read(org_id: str, attachment_id: str) -> bytes:
    p = storage_path(org_id, attachment_id)
    if not p.exists():
        raise err(404, "file_missing", "The stored file could not be found.")
    return p.read_bytes()


def remove(org_id: str, attachment_id: str) -> None:
    try:
        storage_path(org_id, attachment_id).unlink(missing_ok=True)
    except OSError:
        pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def image_for_vision(data: bytes, max_side: int = 1568) -> tuple[bytes, str]:
    """Downscale large screenshots so they fit the model's limits; returns (bytes, mime)."""
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        if max(im.size) > max_side:
            im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88)
        return buf.getvalue(), "image/jpeg"
