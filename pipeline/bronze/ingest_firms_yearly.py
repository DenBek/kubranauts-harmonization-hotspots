"""Load the FIRMS yearly country files into R2 (raw/<sensor>/<year>.parquet).

  python -u pipeline/bronze/ingest_firms_yearly.py              # MODIS 2000-2025 and VIIRS NOAA-20 2018-2025
  python -u pipeline/bronze/ingest_firms_yearly.py snpp         # VIIRS Suomi NPP 2012-2025 instead
  python -u pipeline/bronze/ingest_firms_yearly.py snpp test    # just the first year, to check everything works

Skips years already in R2, so it is safe to re-run. Uses its own temp folder (tmp_backfill/)
and a capped amount of memory, so it can run at the same time as ingest_firms_api.py.
"""
import duckdb, os, subprocess, shutil, sys, time, pathlib

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country/zips"
JOBS = [("modis", f"modis_{y}_all_countries.zip", y) for y in range(2000, 2026)] + \
       [("viirs_noaa20", f"viirs-jpss1_{y}_all_countries.zip", y) for y in range(2018, 2026)]
if "snpp" in sys.argv:  # Suomi NPP: yearly files for 2012-2025 (2026 is only in the API)
    JOBS = [("viirs_snpp", f"viirs-snpp_{y}_all_countries.zip", y) for y in range(2012, 2026)]
if "test" in sys.argv:
    JOBS = JOBS[:1]  # just the first year, to check everything works

COUNTRY = r"_\d{4}_([^/]+)\.csv$"  # pulls the country name out of each CSV's filename
TMP = pathlib.Path("tmp_backfill")  # not tmp/: ingest_firms_api.py keeps its chunks there
FILES, SPILL = TMP / "files", TMP / "spill"

con = duckdb.connect()
con.sql("SET memory_limit = '3GB'")  # leave room for ingest_firms_api.py running alongside
con.sql(f"SET temp_directory = '{SPILL}'")  # big sorts spill to disk instead of running out of memory
con.sql(f"""CREATE SECRET r2 (TYPE r2,
  KEY_ID '{os.environ["R2_KEY_ID"]}', SECRET '{os.environ["R2_SECRET"]}',
  ACCOUNT_ID '{os.environ["CF_ACCOUNT_ID"]}')""")

failed = []
for sensor, zname, year in JOBS:
    out = f"r2://firms-data/raw/{sensor}/{year}.parquet"
    try:  # skip years that are already in R2, so the script can be safely re-run
        con.sql(f"SELECT 1 FROM '{out}' LIMIT 1").fetchall()
        print(f"skip {sensor} {year} (already in R2)", flush=True)
        continue
    except Exception:
        pass
    t0 = time.time()
    shutil.rmtree(FILES, ignore_errors=True)
    FILES.mkdir(parents=True)
    try:
        subprocess.run(["curl", "-fsSL", "-o", str(FILES / zname), f"{BASE}/{zname}"], check=True)
        subprocess.run(["unzip", "-q", "-o", str(FILES / zname), "-d", str(FILES)], check=True)
        con.sql(f"""COPY (SELECT regexp_extract(filename, '{COUNTRY}', 1) AS country, * EXCLUDE (filename)
                         FROM read_csv('{FILES}/**/*.csv', union_by_name=true, filename=true)
                         ORDER BY country)
                    TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
        print(f"done {sensor} {year} in {time.time() - t0:.0f}s", flush=True)
    except Exception as e:
        failed.append((sensor, year))
        print(f"FAILED {sensor} {year}: {e}", flush=True)
shutil.rmtree(TMP, ignore_errors=True)

if "test" in sys.argv and not failed:
    sensor, _, year = JOBS[0]
    con.sql(f"""SELECT country, count(*) AS detections FROM 'r2://firms-data/raw/{sensor}/{year}.parquet'
                GROUP BY 1 ORDER BY 2 DESC LIMIT 5""").show()
print("failed:", failed or "none")