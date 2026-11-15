"""Publish gold-table JSON for the website.

Run in a Codespace after the gold Parquet files exist. Reload the site
afterward. A redeploy is not required. This script does not deploy the site.

Secrets come from the environment. In a Codespace, GitHub injects them
from Settings → Secrets and variables → Codespaces:

    R2_KEY_ID
    R2_SECRET
    CF_ACCOUNT_ID

The script never prints those values. Do not paste them into this file.

Each existing file is uploaded to publish/<table>.json. A missing file is
skipped, and the website keeps serving the sample for that table.

gold_cell_monthly is limited to DEMO_STRATA so the map does not download a
global grid. Clear that tuple only if the resulting JSON is still small
enough for a browser.

Argentina MVP (harmonization/argentina/14_build_gold.py): columns named
*_cell_days hold VIIRS-equivalent detection COUNTS in this version.

Local mode (no R2, no secrets): read <dir>/<table>.parquet and write
<dir>/publish/<table>.json, to check the output and its size:

    python scripts/export_calendar.py --local harmonization/argentina/gold

If boto3 fails with CERTIFICATE_VERIFY_FAILED (a network that re-signs HTTPS), add --via-duckdb:
reads and writes then go through DuckDB and boto3 is not used.
"""

import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import duckdb

BUCKET = "firms-data"

# Cell map slice. "argentina" is the stratum of the Argentina MVP cells.
DEMO_STRATA = ("argentina",)

TABLES = {
    "gold_cell_monthly": [
        # Trimmed for size: cell_x, cell_y, month_start and the *_hotspots duplicates stay in the Parquet only.
        "cell_id", "lon_center", "lat_center", "year", "month",
        "modis_cell_days", "viirs_cell_days", "stratum_id", "calibration_ratio",
        "harmonized_cell_days", "source", "is_provisional", "method",
    ],
    "gold_region_monthly": [
        "region_id", "year", "month", "month_start", "harmonized_cell_days",
        "modis_cell_days", "viirs_cell_days", "source", "is_complete", "is_provisional",
        "baseline_median", "baseline_mean", "baseline_p25", "baseline_p75",
        "baseline_min", "baseline_max", "anomaly_ratio", "anomaly_diff", "anomaly_class",
        "percentile_rank", "rank_in_month", "n_years_ranked",
        "method", "coverage", "reliability", "harmonized_low", "harmonized_high",
        "likely_low_pct", "likely_high_pct", "anomaly_class_stable", "raw_satellite",
        "baseline_id", "baseline_n_years", "baseline_viirs_median", "baseline_viirs_mean",
        "baseline_viirs_n_years", "anomaly_ratio_viirs", "anomaly_class_viirs", "anomaly_status", "raw_count",
    ],
    "gold_region_annual": [
        "region_id", "year", "harmonized_cell_days", "rank", "n_years_ranked",
        "anomaly_ratio", "peak_month", "peak_month_cell_days", "season_start_month",
        "season_midpoint_month", "season_end_month", "season_length_months",
        "months_available", "is_complete",
        "method", "harmonized_low", "harmonized_high", "months_insufficient", "is_partial",
    ],
    "gold_region_analogs": [
        "region_id", "target_year", "through_month", "analog_year", "rank", "distance",
        "similarity_pct", "analog_rest_of_year_cell_days", "analog_rest_vs_median",
        "computed_at",
    ],
    "gold_region_headline": [
        "region_id", "as_of_month", "headline", "alt_text", "month_anomaly_ratio",
        "month_rank_in_month", "ytd_cell_days", "ytd_vs_median", "top_analog_year",
        "method", "region_name", "latest_provisional_month", "latest_provisional_value",
    ],
    "gold_calibration": [
        "stratum_id", "month", "ratio", "modis_cell_days_fit", "viirs_cell_days_fit",
        "n_months", "fit_start", "fit_end", "holdout_mape", "viirs_sensor", "method_version",
        "factor_rel_sd", "holdout_years", "modis_satellite", "likely_low_pct", "likely_high_pct",
    ],
    # New in the Argentina MVP. The API allowlist in functions/api/gold/[table].js must add these two.
    "gold_reliability": [
        "size_bin", "aqua_min", "aqua_max_excl", "n_area_months", "likely_low_pct", "likely_high_pct",
        "range80_low_pct", "range80_high_pct", "reliability", "suggestion", "applies_to",
    ],
    "gold_accuracy": [
        "metric", "value", "unit", "statement", "test_period", "source", "method_version", "computed_at",
    ],
}


def require_env():
    missing = [key for key in ("R2_KEY_ID", "R2_SECRET", "CF_ACCOUNT_ID") if not os.environ.get(key)]
    if missing:
        raise SystemExit(
            "Missing environment variables: " + ", ".join(missing) + ". "
            "In a Codespace they come from repository Settings → Secrets and variables → Codespaces. "
            "Do not paste them into this file."
        )


def client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['CF_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET"],
        region_name="auto",
    )


def exists(s3, key, con=None):
    if s3 is None:  # --via-duckdb: list the object with DuckDB instead of boto3
        return bool(con.sql(f"SELECT * FROM glob('r2://{BUCKET}/{key}')").fetchall())
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except s3.exceptions.ClientError:
        return False


def put_text(con, key, text):
    """Write one text object with DuckDB (raw single line, no CSV quoting). Used when boto3 cannot verify TLS
    (some networks re-sign HTTPS); DuckDB uses its own certificate handling and nothing is switched off."""
    con.execute(
        f"COPY (SELECT ?::VARCHAR AS j) TO 'r2://{BUCKET}/{key}' "
        "(FORMAT csv, HEADER false, QUOTE '', ESCAPE '', DELIMITER '\x01')", [text])


def connect():
    con = duckdb.connect()
    con.sql(
        "CREATE OR REPLACE SECRET r2 (TYPE r2, "
        f"KEY_ID '{os.environ['R2_KEY_ID']}', "
        f"SECRET '{os.environ['R2_SECRET']}', "
        f"ACCOUNT_ID '{os.environ['CF_ACCOUNT_ID']}')"
    )
    return con


def encode(value):
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, 4)
    return value


def publish_one(con, s3, table, columns, local_dir=None):
    key = f"gold/{table}.parquet"
    if local_dir is not None:
        path = Path(local_dir) / f"{table}.parquet"
        if not path.exists():
            print(f"Skip {table}: {path} does not exist.")
            return
        location = path.as_posix()
    else:
        if not exists(s3, key, con):
            print(f"Skip {table}: {key} is not in the bucket. The site keeps the sample.")
            return
        location = f"r2://{BUCKET}/{key}"
    selected = ", ".join(columns)
    where = ""
    if table == "gold_cell_monthly" and DEMO_STRATA:
        listed = ", ".join("'" + name.replace("'", "") + "'" for name in DEMO_STRATA)
        where = f" WHERE stratum_id IN ({listed})"
    sql = f"SELECT {selected} FROM read_parquet('{location}'){where}"
    try:
        cursor = con.sql(sql)
        names = [item[0] for item in cursor.description]
        fetched = cursor.fetchall()
    except duckdb.Error as err:
        print(f"Skip {table}: could not read the expected columns. {err}")
        return
    rows = [{names[i]: encode(value) for i, value in enumerate(row)} for row in fetched]
    if not rows:
        print(f"Skip {table}: the query returned no rows. The site keeps the sample.")
        return
    payload = {
        "source": "r2",
        "dataset": table,
        "note": f"Published from {key}.",
        "rows": rows,
    }
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if local_dir is not None:
        out = Path(local_dir) / "publish" / f"{table}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(body)
        print(f"Wrote {len(rows)} rows to {out} ({len(body) / 1e6:.2f} MB)")
        return
    if s3 is None:
        put_text(con, f"publish/{table}.json", body.decode("utf-8"))
    else:
        s3.put_object(
            Bucket=BUCKET,
            Key=f"publish/{table}.json",
            Body=body,
            ContentType="application/json",
        )
    print(f"Wrote {len(rows)} rows to r2://{BUCKET}/publish/{table}.json")


# ---------- chat lookup (publish/chat_lookup.json) ----------
# A small file the chat assistant's tools read (functions/api/chat.js and scripts/dev_server.py). It is built from the
# same gold Parquet files, so the chat can only say what the calendar says. Provisional months carry no anomaly
# because gold_region_monthly already has none for them.

CHAT_REGION_NAMES = {
    "argentina": "Argentina (whole country)",
    "ar_ne": "North-east (Corrientes, Misiones, Entre Ríos)",
    "ar_nw": "North-west and western Chaco (Salta, Tucumán, Santiago del Estero)",
    "ar_c": "Centre (Córdoba, Pampas, La Pampa)",
    "ar_s": "Patagonia (south of 39°S)",
    "ar_delta": "Paraná Delta (box)",
}
CHAT_MONTH_COLS = ["region", "year", "month", "value", "low", "high", "method", "flag", "coverage", "status",
                   "ratio", "cls", "median", "rank", "n_ranked", "percentile"]
CHAT_YEAR_COLS = ["region", "year", "total", "method", "is_partial", "is_complete", "rank", "n_ranked", "ratio",
                  "peak_month", "season_start", "season_end", "low", "high"]


def _location(s3, con, table, local_dir):
    key = f"gold/{table}.parquet"
    if local_dir is not None:
        path = Path(local_dir) / f"{table}.parquet"
        return path.as_posix() if path.exists() else None
    return f"r2://{BUCKET}/{key}" if exists(s3, key, con) else None


def publish_chat_lookup(con, s3, local_dir=None):
    monthly = _location(s3, con, "gold_region_monthly", local_dir)
    annual = _location(s3, con, "gold_region_annual", local_dir)
    reliability = _location(s3, con, "gold_reliability", local_dir)
    if not (monthly and annual and reliability):
        print("Skip chat_lookup: gold_region_monthly, gold_region_annual and gold_reliability must all exist.")
        return
    months = con.sql(f"""SELECT region_id, year, month, harmonized_cell_days, harmonized_low, harmonized_high, method,
        reliability, coverage, anomaly_status, anomaly_ratio, anomaly_class, baseline_median, rank_in_month,
        n_years_ranked, percentile_rank FROM read_parquet('{monthly}') ORDER BY region_id, year, month""").fetchall()
    years = con.sql(f"""SELECT region_id, year, harmonized_cell_days, method, is_partial, is_complete, rank, n_years_ranked,
        anomaly_ratio, peak_month, season_start_month, season_end_month, harmonized_low, harmonized_high
        FROM read_parquet('{annual}') ORDER BY region_id, year""").fetchall()
    advice = {}
    for flag, text in con.sql(f"SELECT reliability, suggestion FROM read_parquet('{reliability}')").fetchall():
        advice.setdefault(flag, text)
    payload = {
        "source": "r2", "dataset": "chat_lookup", "note": "Built from gold_region_monthly, gold_region_annual and gold_reliability.",
        "regions": CHAT_REGION_NAMES,
        "month_cols": CHAT_MONTH_COLS, "months": [[encode(v) for v in row] for row in months],
        "year_cols": CHAT_YEAR_COLS, "years": [[encode(v) for v in row] for row in years],
        "advice": advice,
    }
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if local_dir is not None:
        out = Path(local_dir) / "publish" / "chat_lookup.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(body)
        print(f"Wrote chat_lookup ({len(months)} months, {len(years)} years) to {out} ({len(body) / 1e3:.0f} KB)")
        return
    if s3 is None:
        put_text(con, "publish/chat_lookup.json", body.decode("utf-8"))
    else:
        s3.put_object(Bucket=BUCKET, Key="publish/chat_lookup.json", Body=body, ContentType="application/json")
    print(f"Wrote chat_lookup ({len(body) / 1e3:.0f} KB) to r2://{BUCKET}/publish/chat_lookup.json")


def main():
    if "--local" in sys.argv:
        local_dir = sys.argv[sys.argv.index("--local") + 1]
        con = duckdb.connect()
        for table, columns in TABLES.items():
            publish_one(con, None, table, columns, local_dir=local_dir)
        publish_chat_lookup(con, None, local_dir=local_dir)
        return
    require_env()
    s3 = None if "--via-duckdb" in sys.argv else client()
    con = connect()
    for table, columns in TABLES.items():
        publish_one(con, s3, table, columns)
    publish_chat_lookup(con, s3)
    print("Reload the website. A redeploy is not required.")


if __name__ == "__main__":
    main()
