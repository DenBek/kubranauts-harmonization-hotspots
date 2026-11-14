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
"""

import json
import os
from datetime import date, datetime

import boto3
import duckdb

BUCKET = "firms-data"

# Cell map slice. These stratum ids match the sample regions.
DEMO_STRATA = ("chaco", "cerrado")

TABLES = {
    "gold_cell_monthly": [
        "cell_id", "cell_x", "cell_y", "lon_center", "lat_center", "year", "month",
        "month_start", "modis_hotspots", "modis_cell_days", "viirs_hotspots",
        "viirs_cell_days", "stratum_id", "calibration_ratio", "harmonized_cell_days",
        "source", "is_provisional",
    ],
    "gold_region_monthly": [
        "region_id", "year", "month", "month_start", "harmonized_cell_days",
        "modis_cell_days", "viirs_cell_days", "source", "is_complete", "is_provisional",
        "baseline_median", "baseline_mean", "baseline_p25", "baseline_p75",
        "baseline_min", "baseline_max", "anomaly_ratio", "anomaly_diff", "anomaly_class",
        "percentile_rank", "rank_in_month", "n_years_ranked",
    ],
    "gold_region_annual": [
        "region_id", "year", "harmonized_cell_days", "rank", "n_years_ranked",
        "anomaly_ratio", "peak_month", "peak_month_cell_days", "season_start_month",
        "season_midpoint_month", "season_end_month", "season_length_months",
        "months_available", "is_complete",
    ],
    "gold_region_analogs": [
        "region_id", "target_year", "through_month", "analog_year", "rank", "distance",
        "similarity_pct", "analog_rest_of_year_cell_days", "analog_rest_vs_median",
        "computed_at",
    ],
    "gold_region_headline": [
        "region_id", "as_of_month", "headline", "alt_text", "month_anomaly_ratio",
        "month_rank_in_month", "ytd_cell_days", "ytd_vs_median", "top_analog_year",
    ],
    "gold_calibration": [
        "stratum_id", "month", "ratio", "modis_cell_days_fit", "viirs_cell_days_fit",
        "n_months", "fit_start", "fit_end", "holdout_mape", "viirs_sensor", "method_version",
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
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['CF_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET"],
        region_name="auto",
    )


def exists(s3, key):
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except s3.exceptions.ClientError:
        return False


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
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float):
        return round(value, 4)
    return value


def publish_one(con, s3, table, columns):
    key = f"gold/{table}.parquet"
    if not exists(s3, key):
        print(f"Skip {table}: {key} is not in the bucket. The site keeps the sample.")
        return
    selected = ", ".join(columns)
    where = ""
    if table == "gold_cell_monthly" and DEMO_STRATA:
        listed = ", ".join("'" + name.replace("'", "") + "'" for name in DEMO_STRATA)
        where = f" WHERE stratum_id IN ({listed})"
    sql = f"SELECT {selected} FROM read_parquet('r2://{BUCKET}/{key}'){where}"
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
    body = json.dumps(payload).encode("utf-8")
    s3.put_object(
        Bucket=BUCKET,
        Key=f"publish/{table}.json",
        Body=body,
        ContentType="application/json",
    )
    print(f"Wrote {len(rows)} rows to r2://{BUCKET}/publish/{table}.json")


def main():
    require_env()
    s3 = client()
    con = connect()
    for table, columns in TABLES.items():
        publish_one(con, s3, table, columns)
    print("Reload the website. A redeploy is not required.")


if __name__ == "__main__":
    main()
