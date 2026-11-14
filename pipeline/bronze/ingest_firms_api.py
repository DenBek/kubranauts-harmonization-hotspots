"""Pull FIRMS fire detections from the API into R2.

Fills what the yearly country files don't have:
  - MODIS (Terra + Aqua) and NOAA-20 from 1 Jan 2026 to today
  - NOAA-21 from its first day (Mar 2023) to today, only if you add "noaa21" (several hours)
  - Suomi NPP 2012 to Nov 2026, only if you add "snpp" (big: about 4.5 GB, many hours)

FIRMS allows each MAP_KEY 5,000 "transactions" per 10 minutes, and a whole-world request uses a lot of them.
When FIRMS says the limit is reached, the script waits 10 minutes and carries on by itself.

Science-quality (SP) data is used wherever it exists, and near-real-time (NRT) only after that.
Writes one Parquet per sensor per year per kind, e.g. r2://firms-data/raw_api/viirs_noaa21/2024_sp.parquet

Run in the Codespace terminal:
  python -u pipeline/bronze/ingest_firms_api.py test    # one request per source, nothing written: check it works and time it
  python -u pipeline/bronze/ingest_firms_api.py         # the real pull (safe to re-run: skips finished files and windows)
  python -u pipeline/bronze/ingest_firms_api.py noaa21  # also NOAA-21
  python -u pipeline/bronze/ingest_firms_api.py snpp    # also Suomi NPP
"""
import csv, datetime as dt, io, os, pathlib, shutil, sys, time, urllib.error, urllib.request
import duckdb

KEY = os.environ["FIRMS_MAP_KEY"]
API = "https://firms.modaps.eosdis.nasa.gov/api"
OUT = "r2://firms-data/raw_api"
DAYS = 5    # days per request (FIRMS allows 1-10); smaller requests are lighter on the API
PAUSE = 2   # seconds to wait between requests
LIMIT_WAIT = 600  # seconds to wait when FIRMS says the 10-minute transaction limit is reached

# R2 folder -> (FIRMS source name, first date we want; None = from the start of the record)
WANT = {
    "modis":        ("MODIS",        dt.date(2026, 1, 1)),  # yearly files already cover 2000-2025
    "viirs_noaa20": ("VIIRS_NOAA20", dt.date(2026, 1, 1)),  # yearly files already cover 2018-2025
}
if "noaa21" in sys.argv:
    WANT["viirs_noaa21"] = ("VIIRS_NOAA21", None)
if "snpp" in sys.argv:
    WANT["viirs_snpp"] = ("VIIRS_SNPP", None)


def fetch(url, tries=4):
    """Download a FIRMS CSV. Waits out the 10-minute limit; retries other failures a few times."""
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                body = r.read().decode()
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")  # FIRMS explains the problem in the reply
        except Exception as e:
            body = f"network error: {e}"
        if body.startswith(("latitude", "data_id")):
            return body
        problem = body[:150].strip()
        if "transaction limit" in problem.lower():
            print(f"    {time.strftime('%H:%M')} reached FIRMS's 10-minute limit, waiting 10 min", flush=True)
            time.sleep(LIMIT_WAIT)
            continue
        attempt += 1
        if attempt >= tries:
            raise RuntimeError(f"gave up: {problem}")
        print(f"    attempt {attempt} failed: {problem} (waiting {30 * attempt}s)", flush=True)
        time.sleep(30 * attempt)


def area_url(source, start, n):
    return f"{API}/area/csv/{KEY}/{source}/world/{n}/{start}"


def covered(folder):
    """Days already downloaded into this temp folder. Files are named <first day>_<number of days>d."""
    days = set()
    for f in folder.glob("*_*d.*"):
        first, n = f.stem.split("_")
        days.update(dt.date.fromisoformat(first) + dt.timedelta(days=k) for k in range(int(n[:-1])))
    return days


def pull_window(source, start, n, folder):
    """Save one request's CSV into the temp folder, skipping days an earlier run already got."""
    todo = [start + dt.timedelta(days=k) for k in range(n)]
    todo = [d for d in todo if d not in covered(folder)]
    if not todo:
        return
    if len(todo) < n:  # partly downloaded before: get the missing days one at a time
        for d in todo:
            pull_window(source, d, 1, folder)
        return
    try:
        body = fetch(area_url(source, start, n))
    except RuntimeError:
        if n == 1:
            raise
        print("    falling back to 1-day requests", flush=True)
        for k in range(n):
            pull_window(source, start + dt.timedelta(days=k), 1, folder)
        return
    rows = body.count("\n") - 1
    if rows > 0:
        (folder / f"{start}_{n}d.csv").write_text(body)
    else:
        (folder / f"{start}_{n}d.empty").touch()  # no fires in these days: remember we checked
    print(f"    {start} +{n}d: {rows:,} rows", flush=True)


# 1. Ask FIRMS which dates exist for each source, then plan SP and NRT ranges
avail = {r["data_id"]: r for r in csv.DictReader(io.StringIO(fetch(f"{API}/data_availability/csv/{KEY}/all")))}
day = dt.date.fromisoformat
jobs = []  # (R2 folder, FIRMS source, "sp"/"nrt", first date, last date)
for folder, (prefix, want_from) in WANT.items():
    sp, nrt = avail[f"{prefix}_SP"], avail[f"{prefix}_NRT"]
    sp_start = max(day(sp["min_date"]), want_from or day(sp["min_date"]))
    sp_end = day(sp["max_date"])
    jobs.append((folder, f"{prefix}_SP", "sp", sp_start, sp_end))
    jobs.append((folder, f"{prefix}_NRT", "nrt", sp_end + dt.timedelta(days=1), day(nrt["max_date"])))

print("Plan:")
for folder, source, kind, a, b in jobs:
    print(f"  {source:<18} {a} to {b}  ({(b - a).days + 1} days, ~{-(-((b - a).days + 1) // DAYS)} requests)")

# 2. Test mode: one request per source, print rows, time taken and columns, write nothing
if "test" in sys.argv:
    for folder, source, kind, a, b in jobs:
        t0 = time.time()
        body = fetch(area_url(source, a, DAYS))
        print(f"\n{source} {a} +{DAYS}d: {body.count(chr(10)) - 1:,} rows in {time.time() - t0:.0f}s")
        print(f"  columns: {body.splitlines()[0]}")
        time.sleep(PAUSE)
    sys.exit()

# 3. The real pull: one Parquet per folder / year / kind
con = duckdb.connect()
con.sql("SET memory_limit = '3GB'")
con.sql("SET temp_directory = 'tmp/spill'")
con.sql(f"""CREATE SECRET r2 (TYPE r2,
  KEY_ID '{os.environ["R2_KEY_ID"]}', SECRET '{os.environ["R2_SECRET"]}',
  ACCOUNT_ID '{os.environ["CF_ACCOUNT_ID"]}')""")

failed = []
for folder, source, kind, start, end in jobs:
    for year in range(start.year, end.year + 1):
        a, b = max(start, dt.date(year, 1, 1)), min(end, dt.date(year, 12, 31))
        if a > b:
            continue
        out = f"{OUT}/{folder}/{year}_{kind}.parquet"
        try:
            con.sql(f"SELECT 1 FROM '{out}' LIMIT 1").fetchall()
            print(f"skip {source} {year} (already in R2)", flush=True)
            continue
        except Exception:
            pass
        print(f"{source} {year}: {a} to {b}", flush=True)
        tmp = pathlib.Path("tmp") / folder / f"{year}_{kind}"
        tmp.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        try:
            d = a
            while d <= b:
                n = min(DAYS, (b - d).days + 1)
                pull_window(source, d, n, tmp)
                d += dt.timedelta(days=n)
                time.sleep(PAUSE)
            con.sql(f"""COPY (SELECT '{source}' AS data_id, *
                              FROM read_csv('{tmp}/*_*d.csv', union_by_name=true,
                                            types={{'acq_time': 'VARCHAR', 'version': 'VARCHAR'}})
                              ORDER BY acq_date, acq_time)
                        TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
            rows = con.sql(f"SELECT count(*) FROM '{out}'").fetchall()[0][0]
            print(f"done {source} {year}: {rows:,} rows in {(time.time() - t0) / 60:.1f} min", flush=True)
            shutil.rmtree(tmp)
        except Exception as e:
            failed.append((source, year))
            print(f"FAILED {source} {year}: {e} (re-run to resume from where it stopped)", flush=True)

if not failed:
    shutil.rmtree("tmp", ignore_errors=True)
print("failed:", failed or "none")
