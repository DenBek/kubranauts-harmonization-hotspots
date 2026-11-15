"""Local RAG over harmonization/argentina/: chunk text files, embed, store in ChromaDB, query.

Embedding model: Gemini Embedding 2 (gemini-embedding-2) via the Google AI Studio REST API.
Needs GEMINI_API_KEY in the environment or .env (never commit it). HuggingFace is blocked on the team laptops.
Run from repo root:  python rag/argentina_rag.py build | query "your question"
"""
import re
import sys
from pathlib import Path

import os
import time

import chromadb
import requests
from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_FILE)


def api_key():
    """GEMINI_API_KEY, else the .env entry named `API KEY` / `API_KEY` (dotenv cannot parse a space in a name)."""
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    for line in ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        name, sep, val = line.partition("=")
        if sep and name.strip().upper().replace(" ", "_") in ("API_KEY", "GEMINI_API_KEY"):
            return val.strip().strip("\"'")
    return None

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "harmonization" / "argentina"
DB_DIR = ROOT / "rag" / "chroma_db"
COLLECTION = "argentina"
MODEL = os.environ.get("RAG_EMBED_MODEL", "gemini-embedding-2")
DIM = 768  # Matryoshka-truncated output size; smaller = lighter DB, small quality cost
API = "https://generativelanguage.googleapis.com/v1beta/models/{m}:batchEmbedContents"
MAX_CHARS, OVERLAP = 1200, 150
EXTS = {".md", ".txt", ".py", ".csv"}
MAX_FILE_BYTES = 200_000  # skip anything huge (data dumps)

def embed(texts, kind):
    """kind: RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY. Returns L2-normalised vectors."""
    key = api_key()
    if not key:
        raise SystemExit("No key: set GEMINI_API_KEY, or `API KEY=` in .env.")
    out = []
    B = 20  # small batches: free-tier quota is per-minute
    for s in range(0, len(texts), B):
        body = {"requests": [{"model": f"models/{MODEL}", "content": {"parts": [{"text": t}]},
                              "taskType": kind, "outputDimensionality": DIM}
                             for t in texts[s:s + B]]}
        for attempt in range(8):
            r = requests.post(API.format(m=MODEL), json=body, headers={"x-goog-api-key": key}, timeout=60)
            if r.status_code in (429, 503):
                time.sleep(min(10 * (attempt + 1), 60))  # wait out per-minute quota
                continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError(f"quota still exceeded: {r.text[:300]}")
        for e in r.json()["embeddings"]:
            v = e["values"]
            n = sum(x * x for x in v) ** 0.5
            out.append([x / n for x in v])
    return out


def files():
    for p in sorted(SRC.rglob("*")):
        if p.is_file() and p.suffix in EXTS and "__pycache__" not in p.parts \
                and p.stat().st_size <= MAX_FILE_BYTES:
            yield p


def chunk(text: str, md: bool):
    """Pack paragraphs into <=MAX_CHARS chunks; markdown chunks keep their heading as context."""
    heading, parts = "", []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if md:
            m = re.match(r"#{1,6} .+", para)
            if m:
                heading = m.group(0).splitlines()[0]
        parts.append((heading, para))
    out, buf, buf_h = [], "", ""
    for h, para in parts:
        # hard-split oversized paragraphs (long tables, code)
        pieces = [para[i:i + MAX_CHARS] for i in range(0, len(para), MAX_CHARS - OVERLAP)] \
            if len(para) > MAX_CHARS else [para]
        for piece in pieces:
            if buf and len(buf) + len(piece) + 2 > MAX_CHARS:
                out.append((buf_h, buf))
                buf, buf_h = "", h
            if not buf:
                buf_h = h
            buf = f"{buf}\n\n{piece}" if buf else piece
    if buf:
        out.append((buf_h, buf))
    return out


def build(reset=False):
    """Incremental: embeds only chunks whose text is new/changed, drops chunks that disappeared.
    Embeddings are added batch by batch, so a quota error keeps what was already stored; re-run to resume."""
    import hashlib
    client = chromadb.PersistentClient(path=str(DB_DIR))
    if reset:
        try:
            client.delete_collection(COLLECTION)
        except Exception:
            pass
    col = client.get_or_create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    want = {}
    for p in files():
        rel = p.relative_to(SRC).as_posix()
        text = p.read_text(encoding="utf-8", errors="ignore")
        for i, (h, c) in enumerate(chunk(text, p.suffix == ".md")):
            cid = f"{rel}::{i}::{hashlib.md5(c.encode()).hexdigest()[:10]}"  # hash in id = change detection
            want[cid] = (c, {"file": rel, "chunk": i, "heading": h})
    have = set(col.get(include=[])["ids"])
    stale = list(have - set(want))
    if stale:
        col.delete(ids=stale)
    todo = [i for i in want if i not in have]
    print(f"{len(want)} chunks: {len(have) - len(stale)} already stored, {len(todo)} to embed, {len(stale)} stale removed")
    for s in range(0, len(todo), 100):
        ids = todo[s:s + 100]
        col.add(ids=ids, documents=[want[i][0] for i in ids], metadatas=[want[i][1] for i in ids],
                embeddings=embed([want[i][0] for i in ids], "RETRIEVAL_DOCUMENT"))
    return col


def collection():
    return chromadb.PersistentClient(path=str(DB_DIR)).get_collection(COLLECTION)


def query(q: str, k: int = 5):
    qe = embed([q], "RETRIEVAL_QUERY")
    r = collection().query(query_embeddings=qe, n_results=k)
    return [{"score": 1 - d, "file": m["file"], "heading": m["heading"], "text": t}
            for t, m, d in zip(r["documents"][0], r["metadatas"][0], r["distances"][0])]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        c = build()
        print("chunks:", c.count())
    elif len(sys.argv) > 2 and sys.argv[1] == "query":
        for h in query(" ".join(sys.argv[2:])):
            print(f"\n[{h['score']:.3f}] {h['file']}  {h['heading']}\n{h['text'][:500]}")
    else:
        print(__doc__)
