"""Step 1: write a local extract of every detection with country = REGION country OR inside the bbox.

One file per source/year/part under data/extract/. Resumable (skips existing files).
Rows stay in DuckDB -> parquet; nothing goes through pandas.
"""
import sys, time
from common import connect_r2, BUCKET, DATA, REGION, bbox_sql

con = connect_r2()
out = DATA / "extract"
out.mkdir(exist_ok=True)
files = [r[0] for r in con.sql(f"""SELECT DISTINCT file_name FROM
    parquet_metadata('{BUCKET}/silver/detections/*/*/*.parquet') ORDER BY 1""").fetchall()]
only = sys.argv[1] if len(sys.argv) > 1 else None
for f in files:
    if only and only not in f:
        continue
    src = f.split("source=")[1].split("/")[0]
    yr = f.split("year=")[1].split("/")[0]
    part = f.rsplit("/", 1)[1].replace(".parquet", "")
    dest = out / f"{src}_{yr}_{part}.parquet"
    if dest.exists():
        continue
    t = time.time()
    con.sql(f"""COPY (
        SELECT *, '{src}' AS source, {yr} AS year,
               (country = '{REGION['country']}') AS in_country, ({bbox_sql()}) AS in_bbox
        FROM read_parquet('{f}')
        WHERE country = '{REGION['country']}' OR ({bbox_sql()})
    ) TO '{dest.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    n = con.sql(f"SELECT count(*) FROM '{dest.as_posix()}'").fetchall()[0][0]
    print(f"{src} {yr} {part}: {n:,} rows, {time.time()-t:.0f}s", flush=True)
print("done")
