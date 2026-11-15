"""Shared setup for the Argentina harmonization investigation.

Run scripts from the repo root, e.g. `venv/Scripts/python -u harmonization/argentina/01_profile.py`.
Credentials come from environment variables / .env (never hard-coded).
"""
import os
from pathlib import Path

import duckdb
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PLOTS = HERE / "plots"
DATA.mkdir(exist_ok=True)
PLOTS.mkdir(exist_ok=True)
load_dotenv(ROOT / ".env")

# Region parameters. Change these to study another region.
REGION = {
    "name": "argentina",
    "country": "Argentina",
    # generous bounding box around mainland Argentina + Tierra del Fuego
    "lat_min": -56.0, "lat_max": -21.0,
    "lon_min": -74.5, "lon_max": -53.0,
}

BUCKET = "r2://firms-data"
SILVER = f"read_parquet('{BUCKET}/silver/detections/*/*/*.parquet', hive_partitioning = true)"
FIRE = "is_vegetation_fire AND confidence_class <> 'low'"
LOCAL_DB = DATA / f"{REGION['name']}.duckdb"


def connect_r2(db=None):
    con = duckdb.connect(str(db) if db else ":memory:")
    con.sql("SET memory_limit = '4GB'")
    con.sql("SET threads = 4")
    con.sql(f"SET temp_directory = '{(ROOT / 'tmp_ml').as_posix()}'")
    con.sql(f"""CREATE OR REPLACE SECRET r2 (TYPE r2, KEY_ID '{os.environ["R2_KEY_ID"]}',
        SECRET '{os.environ["R2_SECRET"]}', ACCOUNT_ID '{os.environ["CF_ACCOUNT_ID"]}')""")
    return con


def connect_local(read_only=True):
    return duckdb.connect(str(LOCAL_DB), read_only=read_only)


def bbox_sql(r=REGION):
    return (f"latitude BETWEEN {r['lat_min']} AND {r['lat_max']} "
            f"AND longitude BETWEEN {r['lon_min']} AND {r['lon_max']}")
