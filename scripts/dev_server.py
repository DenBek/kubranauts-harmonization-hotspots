"""Local stand-in for `npx wrangler pages dev web` when Node is not installed.

Serves web/ and mimics functions/api/gold/[table].js: GET /api/gold/<table> returns
<publish dir>/<table>.json with source "r2" if that file exists, else web/sample/<table>.json with source "sample".
Reads no credentials and never touches R2.

    python scripts/dev_server.py [publish_dir] [port]
    default publish_dir = harmonization/argentina/gold/publish, port = 8788   ->  http://localhost:8788
"""
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
PUBLISH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "harmonization" / "argentina" / "gold" / "publish"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8788
TABLES = {"gold_cell_monthly", "gold_region_monthly", "gold_region_annual", "gold_region_analogs",
          "gold_region_headline", "gold_calibration", "gold_reliability", "gold_accuracy"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        return super().do_GET()


if __name__ == "__main__":
    print(f"web/ at http://localhost:{PORT}  (publish dir: {PUBLISH})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
