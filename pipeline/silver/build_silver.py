"""Build the silver layer: one clean table of every fire detection, from every satellite.

Reads bronze (raw/ from the yearly files, raw_api/ from the API) and writes
  r2://firms-data/silver/detections/source=<source>/year=<year>/<kind>.parquet
where <source> is modis, viirs_snpp, viirs_noaa20 or viirs_noaa21, and <kind> is
archive (yearly files), sp (API, science quality) or nrt (API, near real time).
Read it all back with:
  read_parquet('r2://firms-data/silver/detections/*/*/*.parquet', hive_partitioning = true)

Every row gets the same columns, consistent satellite names and confidence classes, a UTC
timestamp, a local (solar) date, a country, and a fire type. Rows from the API have no country,
and NRT rows have no type, so both are filled from lookups built from 25 years of bronze data.

  python -u pipeline/silver/build_silver.py test   # lookups + two small pieces, then checks; writes real output
  python -u pipeline/silver/build_silver.py        # everything (skips pieces already built, so safe to re-run)
"""
import duckdb, os, shutil, sys, time

R2 = "r2://firms-data"
LOOKUPS = f"{R2}/silver/lookups"
ARCHIVE = f"['{R2}/raw/modis/*.parquet', '{R2}/raw/viirs_noaa20/*.parquet']"  # 25 years, with country and type
SPILL = "tmp_silver"

con = duckdb.connect()
con.sql("SET memory_limit = '3GB'")  # leave room for other jobs on the Codespace
con.sql(f"SET temp_directory = '{SPILL}'")  # big sorts spill to disk instead of running out of memory
con.sql(f"""CREATE SECRET r2 (TYPE r2,
  KEY_ID '{os.environ["R2_KEY_ID"]}', SECRET '{os.environ["R2_SECRET"]}',
  ACCOUNT_ID '{os.environ["CF_ACCOUNT_ID"]}')""")


def exists(path):
    try:
        con.sql(f"SELECT 1 FROM '{path}' LIMIT 1").fetchall()
        return True
    except Exception:
        return False


# 1. Lookups (built once, reused by every run and later by the daily feed)
#    country: most common country in each 0.1 degree cell (~11 km), with a 1 degree fallback
#    static:  0.05 degree cells (~5 km) where most detections are volcanoes, gas flares,
#             industry or offshore (type 1, 2, 3), used to label NRT rows, which have no type
t0 = time.time()
if not exists(f"{LOOKUPS}/country_01deg.parquet"):
    print("building country lookup from 25 years of bronze...", flush=True)
    con.sql(f"""CREATE TEMP TABLE cc AS
        SELECT floor(latitude * 10)::INT AS lat10, floor(longitude * 10)::INT AS lon10, country, count(*) AS n
        FROM read_parquet({ARCHIVE}, union_by_name = true)
        WHERE country IS NOT NULL
        GROUP BY 1, 2, 3""")
    con.sql(f"""COPY (SELECT lat10, lon10, arg_max(country, n) AS country FROM cc GROUP BY 1, 2)
                TO '{LOOKUPS}/country_01deg.parquet' (FORMAT parquet)""")
    con.sql(f"""COPY (SELECT lat1, lon1, arg_max(country, n) AS country
                      FROM (SELECT floor(lat10 / 10.0)::INT AS lat1, floor(lon10 / 10.0)::INT AS lon1, country, sum(n) AS n
                            FROM cc GROUP BY 1, 2, 3)
                      GROUP BY 1, 2)
                TO '{LOOKUPS}/country_1deg.parquet' (FORMAT parquet)""")
    con.sql("DROP TABLE cc")
if not exists(f"{LOOKUPS}/static_005deg.parquet"):
    print("building static-source lookup...", flush=True)
    con.sql(f"""COPY (
        SELECT lat20, lon20, count(*) AS n, avg((t = 0)::INT) AS vegetation_share,
               mode(t) FILTER (WHERE t <> 0) AS static_type
        FROM (SELECT floor(latitude * 20)::INT AS lat20, floor(longitude * 20)::INT AS lon20,
                     TRY_CAST(type AS INTEGER) AS t
              FROM read_parquet({ARCHIVE}, union_by_name = true))
        WHERE t IS NOT NULL
        GROUP BY 1, 2
        HAVING count(*) >= 10 AND avg((t = 0)::INT) < 0.5
    ) TO '{LOOKUPS}/static_005deg.parquet' (FORMAT parquet)""")
con.sql(f"CREATE TEMP TABLE country01 AS SELECT * FROM '{LOOKUPS}/country_01deg.parquet'")
con.sql(f"CREATE TEMP TABLE country1 AS SELECT * FROM '{LOOKUPS}/country_1deg.parquet'")
con.sql(f"CREATE TEMP TABLE static AS SELECT lat20, lon20, static_type FROM '{LOOKUPS}/static_005deg.parquet'")
print(f"lookups ready ({time.time() - t0:.0f}s)", flush=True)

# 2. Find every bronze file and work out where its silver piece goes
jobs = []
for (path,) in con.sql(f"""SELECT file FROM glob('{R2}/raw/*/*.parquet')
                           UNION ALL SELECT file FROM glob('{R2}/raw_api/*/*.parquet') ORDER BY 1""").fetchall():
    layer, source, name = path.split("/")[-3:]
    stem = name.removesuffix(".parquet")
    year, kind = stem.split("_") if layer == "raw_api" else (stem, "archive")
    jobs.append((source, int(year), kind, path))
if "test" in sys.argv:  # one small archive year and one API file, to check both paths
    archive = [j for j in jobs if j[2] == "archive"]
    api = [j for j in jobs if j[2] != "archive"]
    jobs = archive[:1] + api[:1]

SATELLITE = {
    "modis": "CASE WHEN satellite IN ('T', 'Terra') THEN 'Terra' WHEN satellite IN ('A', 'Aqua') THEN 'Aqua' ELSE satellite END",
    "viirs_snpp": "'Suomi NPP'", "viirs_noaa20": "'NOAA-20'", "viirs_noaa21": "'NOAA-21'",
}
MODIS_CONF = """CASE WHEN TRY_CAST(d.confidence AS INTEGER) < 30 THEN 'low'
                     WHEN TRY_CAST(d.confidence AS INTEGER) < 80 THEN 'nominal'
                     WHEN TRY_CAST(d.confidence AS INTEGER) IS NOT NULL THEN 'high' END"""
VIIRS_CONF = """CASE WHEN lower(CAST(d.confidence AS VARCHAR)) IN ('l', 'low') THEN 'low'
                     WHEN lower(CAST(d.confidence AS VARCHAR)) IN ('n', 'nominal') THEN 'nominal'
                     WHEN lower(CAST(d.confidence AS VARCHAR)) IN ('h', 'high') THEN 'high' END"""
HHMM = "lpad(CAST(acq_time AS VARCHAR), 4, '0')"


def build(source, year, kind, path, out):
    cols = {r[0] for r in con.sql(f"DESCRIBE SELECT * FROM '{path}'").fetchall()}
    modis = source == "modis"
    has_type, has_country = "type" in cols, "country" in cols
    t = "TRY_CAST(d.type AS INTEGER)" if has_type else "CAST(NULL AS INTEGER)"
    joins = ""
    if not has_type:
        joins += " LEFT JOIN static s ON s.lat20 = d.lat20 AND s.lon20 = d.lon20"
    if not has_country:
        joins += (" LEFT JOIN country01 c01 ON c01.lat10 = d.lat10 AND c01.lon10 = d.lon10"
                  " LEFT JOIN country1 c1 ON c1.lat1 = d.lat1 AND c1.lon1 = d.lon1")
    type_final = t if has_type else "coalesce(s.static_type, 0)"
    country = "d.country" if has_country else "coalesce(c01.country, c1.country)"
    country_source = ("'file'" if has_country else
                      "CASE WHEN c01.country IS NOT NULL THEN 'lookup_01deg' WHEN c1.country IS NOT NULL THEN 'lookup_1deg' END")
    b1, b2 = ("brightness", "bright_t31") if modis else ("bright_ti4", "bright_ti5")
    con.sql(f"""COPY (
        WITH d AS (
            SELECT *,
                   floor(latitude * 10)::INT AS lat10, floor(longitude * 10)::INT AS lon10,
                   floor(latitude)::INT AS lat1, floor(longitude)::INT AS lon1,
                   floor(latitude * 20)::INT AS lat20, floor(longitude * 20)::INT AS lon20,
                   acq_date + make_time(CAST(substr({HHMM}, 1, 2) AS INTEGER), CAST(substr({HHMM}, 3, 2) AS INTEGER), 0) AS ts
            FROM '{path}')
        SELECT {SATELLITE[source].replace('satellite', 'd.satellite')} AS satellite,
               '{"MODIS" if modis else "VIIRS"}' AS instrument,
               '{"NRT" if kind == "nrt" else "SP"}' AS quality,
               d.ts AS acq_datetime_utc,
               d.acq_date AS acq_date_utc,
               CAST(d.ts + to_seconds(CAST(round(d.longitude * 240) AS BIGINT)) AS DATE) AS local_date,
               d.latitude, d.longitude,
               d.lat10, d.lon10,
               {country} AS country,
               {country_source} AS country_source,
               d.daynight,
               {MODIS_CONF if modis else VIIRS_CONF} AS confidence_class,
               CAST(d.confidence AS VARCHAR) AS confidence_raw,
               d.frp,
               d.{b1} AS bright_main, d.{b2} AS bright_aux, d.scan, d.track,
               {t} AS type_reported,
               {type_final} AS type_final,
               {"false" if has_type else "true"} AS type_inferred,
               ({type_final}) = 0 AS is_vegetation_fire,
               CAST(d.version AS VARCHAR) AS version
        FROM d{joins}
        ORDER BY local_date, acq_datetime_utc
    ) TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")


# 3. Build each piece
failed = []
for source, year, kind, path in jobs:
    out = f"{R2}/silver/detections/source={source}/year={year}/{kind}.parquet"
    if exists(out):
        print(f"skip {source} {year} {kind} (already built)", flush=True)
        continue
    t0 = time.time()
    try:
        build(source, year, kind, path, out)
        rows = con.sql(f"SELECT count(*) FROM '{out}'").fetchall()[0][0]
        print(f"done {source} {year} {kind}: {rows:,} rows in {time.time() - t0:.0f}s", flush=True)
    except Exception as e:
        failed.append((source, year, kind))
        print(f"FAILED {source} {year} {kind}: {e}", flush=True)
shutil.rmtree(SPILL, ignore_errors=True)

# 4. Checks on what this run covered
if "test" in sys.argv and not failed:
    silver = f"read_parquet('{R2}/silver/detections/*/*/*.parquet', hive_partitioning = true)"
    print("\nRows by source, quality, country source and whether type was inferred:")
    con.sql(f"""SELECT source, year, quality, country_source, type_inferred, count(*) AS n,
                       count(*) FILTER (WHERE country IS NULL) AS no_country,
                       count(*) FILTER (WHERE NOT is_vegetation_fire) AS not_vegetation
                FROM {silver} GROUP BY ALL ORDER BY ALL""").show(max_width=250)
    print("Sample rows:")
    con.sql(f"""SELECT satellite, quality, acq_datetime_utc, local_date, latitude, longitude, country,
                       confidence_class, frp, type_final, is_vegetation_fire
                FROM {silver} USING SAMPLE 8 ROWS""").show(max_width=250)
print("failed:", failed or "none")