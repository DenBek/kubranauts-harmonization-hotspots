# kubranauts-harmonization-hotspots

Harmonization of MODIS and VIIRS Hot Spots. Team Kubranauts, NASA Space Apps Challenge 2026.

## Where the data lives

All data is in the Cloudflare R2 bucket `firms-data`.

| Path | What it holds |
|---|---|
| `raw/modis/{year}.parquet` | MODIS (Terra and Aqua) detections, 2000 to 2025, from the FIRMS yearly country files. Includes a `country` column. |
| `raw/viirs_noaa20/{year}.parquet` | VIIRS NOAA-20 detections, 2018 to 2025, from the same files. |
| `raw_api/{sensor}/{year}_{sp,nrt}.parquet` | 2026 to date (and optionally NOAA-21 and Suomi NPP) from the FIRMS API. `sp` is science quality, `nrt` is near real time. No `country` column yet; NRT rows have no `type` column. |
| `analysis/agg_monthly.parquet` | Monthly counts and FRP by sensor, satellite, country, type, day/night and confidence. |
| `gold/gold_cell_monthly.parquet` | One row per grid cell per month. The map reads this. |
| `gold/gold_region_monthly.parquet` | One row per region per month, including anomaly class and rank. The calendar reads this. |
| `gold/gold_region_annual.parquet` | One row per region per year, including season start, midpoint, and end. |
| `gold/gold_region_analogs.parquet` | Closest earlier years for the current year. |
| `gold/gold_region_headline.parquet` | One summary sentence per region. |
| `gold/gold_calibration.parquet` | Monthly VIIRS-to-MODIS ratios and the fit evidence. |
| `publish/gold_*.json` | The JSON the website reads. Written by `scripts/export_calendar.py` from the matching gold Parquet file. Until that object exists, the site uses the sample in `web/sample/`. |

## Setup

1. Repository **Settings → Secrets and variables → Codespaces** needs four secrets:
   `R2_KEY_ID`, `R2_SECRET`, `CF_ACCOUNT_ID`, `FIRMS_MAP_KEY`.
2. **Code → Codespaces → Create codespace on main.** Python packages install automatically.

Never put keys in code or commit them. They only live in the Codespaces secrets.

## Scripts

Run from the Codespace terminal, e.g. `python -u scripts/pull_api.py test`.

| Script | What it does |
|---|---|
| `scripts/backfill_firms.py` | Downloads the FIRMS yearly country files (MODIS 2000 to 2025, NOAA-20 2018 to 2025) into `raw/`. `test` runs one year. Skips years already in R2. |
| `scripts/pull_api.py` | Pulls 2026 to date from the FIRMS API into `raw_api/`. `test` makes one request per source; `noaa21` and `snpp` add those satellites. Waits out the API rate limit and resumes where it stopped. |
| `scripts/check_raw.py` | Columns, totals per sensor, and Argentina MODIS vs VIIRS by year. |
| `scripts/r2_size.py` | Size of each folder in the bucket. |
| `scripts/explore.py` | Builds the monthly aggregate (local `analysis.duckdb` and `analysis/agg_monthly.parquet` in R2) and starts the exploratory analysis. |
| `scripts/explore_rest.py` | The rest of the exploratory analysis, read from `analysis.duckdb`. |
| `scripts/build_sample_gold.py` | Rewrites the illustrative JSON in `web/sample/`. Does not touch R2. |
| `scripts/export_calendar.py` | Uploads each gold Parquet file it finds to `publish/<table>.json`. Skips a table that is not in the bucket yet. |

## Website

The site lives in `web/` and `functions/`. The numbers on it are sample data until `scripts/export_calendar.py` has published a table. How to run it, deploy it, and plug in the gold tables is in [WEB_DEPLOYMENT.md](WEB_DEPLOYMENT.md).

## Acknowledgements

We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE).

Parts of the code in this repository were written with the help of AI tools, as disclosed in our project submission.
