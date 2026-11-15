"""Local stand-in for `npx wrangler pages dev web` when Node is not installed.

Serves web/ and mimics functions/api/gold/[table].js: GET /api/gold/<table> returns
<publish dir>/<table>.json with source "r2" if that file exists, else web/sample/<table>.json with source "sample".
Reads no credentials and never touches R2.

Also mimics functions/api/chat.js: POST /api/chat calls Gemini. The key is read from the environment (GEMINI_API_KEY)
or from .env in the repo root (a line "GEMINI_API_KEY=..." or "API KEY = ..."); it is never sent to the browser.

    python scripts/dev_server.py [publish_dir] [port]
    default publish_dir = harmonization/argentina/gold/publish, port = 8788   ->  http://localhost:8788
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
PUBLISH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "harmonization" / "argentina" / "gold" / "publish"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8788
TABLES = {"gold_cell_monthly", "gold_region_monthly", "gold_region_annual", "gold_region_analogs",
          "gold_region_headline", "gold_calibration", "gold_reliability", "gold_accuracy"}

# Keep these in step with functions/api/chat.js.
DEFAULT_MODEL = "gemini-3.5-flash-lite"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
MAX_TURNS, MAX_CHARS, MAX_OUTPUT_TOKENS, TIMEOUT_S = 20, 1500, 700, 25


def gemini_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"\s*(GEMINI_API_KEY|API[ _]KEY)\s*=\s*(.+?)\s*$", line, re.I)
            if m:
                return m.group(2).strip().strip("\"'")
    return ""


def clean_messages(messages):
    if not isinstance(messages, list):
        return None
    out = []
    for m in messages[-MAX_TURNS:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "model") or not isinstance(m.get("text"), str):
            continue
        text = m["text"].strip()[:MAX_CHARS]
        if not text:
            continue
        if out and out[-1]["role"] == m["role"]:
            out[-1]["parts"][0]["text"] += "\n" + text
        else:
            out.append({"role": m["role"], "parts": [{"text": text}]})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if not out or out[-1]["role"] != "user":
        return None
    return out


def ask_gemini(messages):
    """Returns (status, payload) like functions/api/chat.js."""
    key = gemini_key()
    if not key:
        return 503, {"error": "The assistant is not set up on this site yet (no API key)."}
    contents = clean_messages(messages)
    if not contents:
        return 400, {"error": "Send at least one question."}
    system = (WEB / "chat_context.txt").read_text(encoding="utf-8")
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    req = urllib.request.Request(
        API_BASE + model + ":generateContent",
        data=json.dumps({
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": MAX_OUTPUT_TOKENS},
        }).encode("utf-8"),
        headers={"content-type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "ignore")[:400]
        print(f"gemini HTTP {err.code}: {detail}", flush=True)  # dev only; the browser gets a generic message
        if err.code == 429:
            return 429, {"error": "The assistant is busy. Please try again in a minute."}
        return 502, {"error": "The assistant had a problem. Please try again."}
    except Exception as err:  # timeout, DNS, TLS
        print(f"gemini error: {err!r}", flush=True)
        return 504, {"error": "Could not reach the assistant. Please try again."}
    cand = (data.get("candidates") or [{}])[0]
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought")).strip()
    if not text:
        return 502, {"error": "I could not answer that one. Try rephrasing the question."}
    if cand.get("finishReason") == "MAX_TOKENS":
        text += "\n\n(Answer cut short. Ask me to continue if you want more.)"
    return 200, {"reply": text}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        pass

    def log_error(self, fmt, *args):
        # Only errors are logged (404s especially), so a broken link shows up in the terminal.
        print(f"{self.command} {self.path} -> " + (fmt % args), flush=True)

    def send_json(self, data, status=200):
        body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/chat":
            return self.send_json({"error": "Not found."}, 404)
        try:
            length = int(self.headers.get("content-length") or 0)
            if length > 100_000:
                return self.send_json({"error": "Bad request."}, 400)
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self.send_json({"error": "Bad request."}, 400)
        status, payload = ask_gemini(body.get("messages") if isinstance(body, dict) else None)
        return self.send_json(payload, status)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/gold/"):
            table = path.rsplit("/", 1)[1]
            if table not in TABLES:
                return self.send_json({"error": "Unknown table."}, 404)
            for folder, source in ((PUBLISH, "r2"), (WEB / "sample", "sample")):
                f = folder / f"{table}.json"
                if f.exists():
                    data = json.loads(f.read_text(encoding="utf-8"))
                    data["source"] = source
                    return self.send_json(data)
            return self.send_json({"source": "sample", "note": f"No file for {table}.", "rows": []}, 500)
        # Cloudflare Pages serves /draw as draw.html; do the same here.
        if "." not in path.rsplit("/", 1)[-1] and path.strip("/") and (WEB / (path.strip("/") + ".html")).exists():
            query = self.path[len(path):]
            self.path = path.rstrip("/") + ".html" + query
        return super().do_GET()


if __name__ == "__main__":
    # On Windows, address reuse lets a second copy bind the same port, and requests then alternate between the two
    # (one may be an old copy). Fail loudly instead.
    ThreadingHTTPServer.allow_reuse_address = False
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"web/ at http://localhost:{PORT}  (publish dir: {PUBLISH})", flush=True)
    server.serve_forever()
