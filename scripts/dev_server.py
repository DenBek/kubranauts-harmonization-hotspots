"""Local stand-in for `npx wrangler pages dev web` when Node is not installed.

Serves web/ and mimics functions/api/gold/[table].js: GET /api/gold/<table> returns
<publish dir>/<table>.json with source "r2" if that file exists, else web/sample/<table>.json with source "sample".
Reads no credentials and never touches R2.

Also mimics functions/api/chat.js: POST /api/chat calls Gemini with three lookup tools reading <publish dir>/chat_lookup.json. The key is read from the environment (GEMINI_API_KEY)
or from .env in the repo root (a line "GEMINI_API_KEY=..." or "API KEY = ..."); it is never sent to the browser.

    python scripts/dev_server.py [publish_dir] [port]
    default publish_dir = harmonization/argentina/gold/publish, port = 8788   ->  http://localhost:8788
"""
import json
import os
import re
import sys
import time
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
MAX_TURNS, MAX_CHARS, MAX_OUTPUT_TOKENS, TIMEOUT_S = 20, 1500, 900, 25


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


# ---------- lookup tools (mirror of the tools in functions/api/chat.js; KEEP THE TWO IN STEP) ----------

MAX_TOOL_ROUNDS = 3
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
REGION_IDS = ["argentina", "ar_ne", "ar_nw", "ar_c", "ar_s", "ar_delta"]
CLASS_TEXT = {"much_below": "much below usual", "below": "below usual", "normal": "normal", "above": "above usual", "much_above": "much above usual"}
METHOD_TEXT = {
    "observed_viirs": "measured by VIIRS",
    "modelled_aqua": "converted from MODIS Aqua to the VIIRS scale",
    "provisional_nrt": "provisional (near-real-time VIIRS, can still change)",
    "insufficient_data": "no estimate (too few MODIS detections to convert)",
    "mixed": "built from more than one source (converted MODIS months, measured VIIRS months, or months with no estimate)",
}
TOOLS = [{"functionDeclarations": [
    {"name": "get_month",
     "description": "Look up one calendar month for one region: detections (VIIRS-equivalent), whether it was measured or converted, likely range and reliability flag for converted months, and the comparison with a usual month (only when it exists).",
     "parameters": {"type": "OBJECT", "properties": {
         "region": {"type": "STRING", "enum": REGION_IDS, "description": "argentina = whole country; ar_ne north-east; ar_nw north-west and western Chaco; ar_c centre; ar_s Patagonia; ar_delta Parana Delta box"},
         "year": {"type": "INTEGER", "description": "2003 or later"},
         "month": {"type": "INTEGER", "description": "1 to 12"}}, "required": ["region", "year", "month"]}},
    {"name": "get_year",
     "description": "Look up one calendar year for one region: total detections, how it was made, rank among years, peak month and season.",
     "parameters": {"type": "OBJECT", "properties": {"region": {"type": "STRING", "enum": REGION_IDS}, "year": {"type": "INTEGER"}},
                    "required": ["region", "year"]}},
    {"name": "top_months",
     "description": "The busiest months on record for one region (provisional months are left out).",
     "parameters": {"type": "OBJECT", "properties": {"region": {"type": "STRING", "enum": REGION_IDS}, "n": {"type": "INTEGER", "description": "1 to 5, default 5"}},
                    "required": ["region"]}},
]}]

_lookup = {"at": 0.0, "index": None}


def load_lookup():
    import time
    if _lookup["index"] and time.time() - _lookup["at"] < 600:
        return _lookup["index"]
    f = PUBLISH / "chat_lookup.json"
    if not f.exists():
        return None
    d = json.loads(f.read_text(encoding="utf-8"))
    months = [dict(zip(d["month_cols"], r)) for r in d["months"]]
    index = {"regions": d["regions"], "advice": d["advice"], "list": months, "last": 0,
             "months": {f"{r['region']}|{r['year']}|{r['month']}": r for r in months},
             "years": {f"{r['region']}|{r['year']}": r for r in (dict(zip(d["year_cols"], x)) for x in d["years"])}}
    index["last"] = max(r["year"] * 100 + r["month"] for r in months)
    _lookup.update(at=time.time(), index=index)
    return index


def ordinal(n):
    v = n % 100
    suffix = ["th", "st", "nd", "rd"]
    return f"{n}" + (suffix[(v - 20) % 10] if 0 <= (v - 20) % 10 < 4 and v >= 20 else (suffix[v] if v < 4 else "th"))


def ratio_text(r):
    return "more than 10x" if r > 10 else f"{round(r * 100) / 100:g}x"


def month_label(y, m):
    return f"{MONTHS[m - 1]} {y}"


def last_label(L):
    return month_label(L["last"] // 100, L["last"] % 100)


def month_tool(L, a, lookups):
    region = a.get("region")
    try:
        year, month = int(a.get("year")), int(a.get("month"))
    except (TypeError, ValueError):
        return {"error": "no_data", "note": "Year and month must be numbers.", "data_through": last_label(L)}
    if region not in L["regions"]:
        return {"error": "unknown_region", "valid_regions": list(L["regions"])}
    r = L["months"].get(f"{region}|{year}|{month}")
    if not r:
        return {"error": "no_data", "note": f"No estimate on file for that month. The calendar covers January 2003 to {last_label(L)}.", "data_through": last_label(L)}
    lookups.append({"label": f"{L['regions'][region]}, {month_label(year, month)}", "href": f"regions.html?region={region}&year={year}&month={month}"})
    out = {
        "region": L["regions"][region], "month": month_label(year, month), "method": METHOD_TEXT.get(r["method"], r["method"]),
        "unit": "VIIRS-equivalent fire detections",
        "detections": None if r["value"] is None else round(r["value"]),
        "share_of_days_with_valid_satellite_data": None if r["coverage"] is None else f"{round(r['coverage'] * 100)}%",
    }
    if r["method"] == "modelled_aqua":
        out["likely_range"] = [round(r["low"]), round(r["high"])]
        out["likely_range_meaning"] = "about an 85% chance the true VIIRS-equivalent value lies in this range (tested on years the method had not seen)"
        out["reliability"] = r["flag"]
        out["reliability_advice"] = L["advice"].get(r["flag"], "")
    elif r["method"] == "observed_viirs":
        out["reliability"] = "reliable (measured directly, any area size)"
    if r["status"] == "ok" and r["ratio"] is not None and r["cls"]:
        c = {
            "compared_with_usual": ratio_text(r["ratio"]), "class": CLASS_TEXT.get(r["cls"], r["cls"]),
            "usual_detections_for_this_calendar_month": round(r["median"]),
            "usual_means": "median of the same calendar month, 2003 to 2022",
            "rank": f"{ordinal(r['rank'])} of {r['n_ranked']} {MONTHS[month - 1]}s (1st = busiest)",
            "percentile": round(r["percentile"]),
        }
        if r["ratio"] > 10 or r["median"] < 200:
            c["note"] = "The usual level is small here, so the ratio can look huge. Lead with the rank."
        out["comparison"] = c
    elif r["status"] == "provisional":
        out["comparison"] = {"status": "not_compared", "reason": "Provisional near-real-time data. It can still change, so it is not compared with earlier years."}
    elif r["status"] == "incomplete":
        out["comparison"] = {"status": "not_compared", "reason": "The month is still in progress, so it is not compared with earlier years."}
    else:
        out["comparison"] = {"status": "not_compared", "reason": "No estimate for this month in this region."}
    return out


def year_tool(L, a, lookups):
    region = a.get("region")
    try:
        year = int(a.get("year"))
    except (TypeError, ValueError):
        return {"error": "no_data", "note": "Year must be a number.", "data_through": last_label(L)}
    if region not in L["regions"]:
        return {"error": "unknown_region", "valid_regions": list(L["regions"])}
    r = L["years"].get(f"{region}|{year}")
    if not r:
        return {"error": "no_data", "note": f"No yearly figure on file. The calendar covers 2003 to {L['last'] // 100}.", "data_through": last_label(L)}
    lookups.append({"label": f"{L['regions'][region]}, {year}", "href": f"regions.html?region={region}"})
    out = {
        "region": L["regions"][region], "year": year, "unit": "VIIRS-equivalent fire detections",
        "total_detections": None if r["total"] is None else round(r["total"]), "method": METHOD_TEXT.get(r["method"], r["method"]),
        "peak_month": MONTHS[r["peak_month"] - 1] if r["peak_month"] else None,
        "season_from_10_to_90_percent_of_the_year": f"{MONTHS[r['season_start'] - 1]} to {MONTHS[r['season_end'] - 1]}" if r["season_start"] and r["season_end"] else None,
    }
    if r["method"] in ("modelled_aqua", "mixed"):
        out["likely_range"] = [round(r["low"]), round(r["high"])]
    if r["is_complete"] and r["rank"]:
        out["rank"] = f"{ordinal(r['rank'])} of {r['n_ranked']} complete years (1st = busiest)"
        if r["ratio"] is not None:
            out["compared_with_usual_year"] = ratio_text(r["ratio"])
    else:
        out["note"] = ("Partial year: some months are in progress, provisional, or have no estimate, so the total is incomplete and is not ranked."
                       if r["is_partial"] else "Year not complete, so it is not ranked.")
    return out


def top_tool(L, a, lookups):
    region = a.get("region")
    try:
        n = min(5, max(1, int(a.get("n") or 5)))
    except (TypeError, ValueError):
        n = 5
    if region not in L["regions"]:
        return {"error": "unknown_region", "valid_regions": list(L["regions"])}
    rows = sorted((r for r in L["list"] if r["region"] == region and r["status"] == "ok" and r["value"] is not None
                   and r["method"] in ("modelled_aqua", "observed_viirs")), key=lambda r: -r["value"])[:n]
    lookups.append({"label": f"{L['regions'][region]}, busiest months", "href": f"regions.html?region={region}"})
    return {"region": L["regions"][region], "unit": "VIIRS-equivalent fire detections", "note": "Provisional months are left out.",
            "busiest_months": [{"month": month_label(r["year"], r["month"]), "detections": round(r["value"]), "method": METHOD_TEXT[r["method"]]} for r in rows]}


def run_tool(name, args, lookups):
    L = load_lookup()
    if not L:
        return {"error": "lookup_unavailable", "note": "The data lookup is not available right now."}
    args = args if isinstance(args, dict) else {}
    fn = {"get_month": month_tool, "get_year": year_tool, "top_months": top_tool}.get(name)
    return fn(L, args, lookups) if fn else {"error": "unknown_tool"}


def unique_lookups(items):
    seen, out = set(), []
    for l in items:
        if l["href"] not in seen and len(out) < 3:
            seen.add(l["href"])
            out.append(l)
    return out


def ask_gemini(messages):
    """Returns (status, payload) like functions/api/chat.js, including the tool loop."""
    key = gemini_key()
    if not key:
        return 503, {"error": "The assistant is not set up on this site yet (no API key)."}
    contents = clean_messages(messages)
    if not contents:
        return 400, {"error": "Send at least one question."}
    system = (WEB / "chat_context.txt").read_text(encoding="utf-8")
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    lookups, cand = [], None
    for rnd in range(MAX_TOOL_ROUNDS + 1):
        payload = {
            "systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "tools": TOOLS,
            "toolConfig": {"functionCallingConfig": {"mode": "NONE" if rnd == MAX_TOOL_ROUNDS else "AUTO"}},
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": MAX_OUTPUT_TOKENS},
        }
        req = urllib.request.Request(API_BASE + model + ":generateContent", data=json.dumps(payload).encode("utf-8"),
                                     headers={"content-type": "application/json", "x-goog-api-key": key}, method="POST")
        try:
            for attempt in range(2):
                try:
                    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                    break
                except urllib.error.HTTPError as err:
                    if err.code in (429, 500, 503) and attempt == 0:  # busy or overloaded: try once more
                        time.sleep(1.5)
                        continue
                    raise
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
        calls = [p for p in parts if isinstance(p, dict) and p.get("functionCall")]
        if not calls:
            break
        contents.append(cand["content"])  # echo the model turn unchanged (keeps thought signatures)
        answers = []
        for c in calls:
            fc = c["functionCall"]
            print(f"tool {fc.get('name')} {fc.get('args')}", flush=True)
            answers.append({"functionResponse": {"name": fc.get("name"), "response": {"result": run_tool(fc.get("name"), fc.get("args"), lookups)}}})
        contents.append({"role": "user", "parts": answers})
    parts = (cand.get("content") or {}).get("parts") or [] if cand else []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought")).strip()
    if not text:
        return 502, {"error": "I could not answer that one. Try rephrasing the question."}
    if cand.get("finishReason") == "MAX_TOKENS":
        text += "\n\n(Answer cut short. Ask me to continue if you want more.)"
    return 200, {"reply": text, "lookups": unique_lookups(lookups)}


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
