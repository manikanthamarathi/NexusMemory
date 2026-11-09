"""External lookup for errors the company has never seen. Returns ONLY what the public source actually says,
or None. No invented authors, ratings or occurrence counts."""
import json
import re
import urllib.parse
import urllib.request


def search_global_web(query: str):
    cleaned = re.sub(r"[^a-zA-Z0-9\s\-_.:]", " ", query)
    keyword = " ".join([t for t in cleaned.split() if len(t) > 2][:8])
    if not keyword:
        return None
    try:
        url = f"https://api.duckduckgo.com/?q={urllib.parse.quote(keyword)}&format=json&no_html=1&skip_disambig=1"
        req = urllib.request.Request(url, headers={"User-Agent": "NexusMemory/2.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            p = json.loads(r.read().decode("utf-8"))
        if p.get("AbstractText") and p.get("AbstractURL"):
            host = urllib.parse.urlparse(p["AbstractURL"]).netloc
            return {"source": host, "title": p.get("Heading") or keyword, "author": p.get("AbstractSource") or host,
                    "author_contact": p["AbstractURL"], "summary": p["AbstractText"], "url": p["AbstractURL"],
                    "what_they_faced": None, "occurrences_worldwide": None, "user_rating": None, "confidence_score": 50.0}
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] web lookup failed: {type(e).__name__}")
    return None
