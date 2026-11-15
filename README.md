# kubranauts-harmonization-hotspots

Harmonization of MODIS and VIIRS Hot Spots. Team Kubranauts, NASA Space Apps Challenge 2026.

## Where the data lives

All data is in the Cloudflare R2 bucket `firms-data`.

| Path | What it holds |
|---|---|
| `raw/modis/{year}.parquet` | MODIS (Terra and Aqua) detections, 2000 to 2025, from the FIRMS yearly country files. Includes a `country` column. |
| `raw/viirs_noaa20/{year}.parquet` | VIIRS NOAA-20 detections, 2018 to 2025, from the same files. |
| `raw/viirs_snpp/{year}.parquet` | VIIRS Suomi NPP detections, 2012 to 2025, from the same files. |
| `raw_api/{sensor}/{year}_{sp,nrt}.parquet` | 2026 to date (and optionally NOAA-21 and Suomi NPP) from the FIRMS API. `sp` is science quality, `nrt` is near real time. No `country` column yet; NRT rows have no `type` column. |
| `silver/detections/source={source}/year={year}/{archive,sp,nrt}.parquet` | **Silver:** one clean row per detection from every satellite, with the same columns everywhere: satellite, quality (SP/NRT), UTC time, local solar date, location, country, confidence class, FRP, fire type and `is_vegetation_fire`. Read with `read_parquet('r2://firms-data/silver/detections/*/*/*.parquet', hive_partitioning = true)`. |
| `silver/lookups/` | Country for each 0.1° and 1° cell, and 0.05° cells that are mostly static sources (volcanoes, gas flares, industry, offshore). Used to fill in country for API rows and fire type for NRT rows. |
| `analysis/agg_monthly.parquet` | Monthly counts and FRP by sensor, satellite, country, type, day/night and confidence. |
| `gold/gold_cell_monthly.parquet` | One row per grid cell per month. Draw an area reads this. |
| `gold/gold_region_monthly.parquet` | One row per region per month, including anomaly class and rank. The Fire calendar and The problem read this. |
| `gold/gold_region_annual.parquet` | One row per region per year, including season start, midpoint, and end. |
| `gold/gold_region_analogs.parquet` | Closest earlier years for the current year. |
| `gold/gold_region_headline.parquet` | One summary sentence per region. |
| `gold/gold_calibration.parquet` | Monthly VIIRS-to-MODIS ratios and the fit evidence. |
| `publish/gold_*.json` | The JSON the website reads. Written by `scripts/export_calendar.py` from the matching gold Parquet file. Until that object exists, the site uses the sample in `web/sample/`. |

## Where to start

- New to the project: [HANDOVER.md](HANDOVER.md) (one page), then the documentation index in [docs/README.md](docs/README.md).
- Argentina MVP (the demo app): [harmonization/argentina/](harmonization/argentina/); data schema in [gold/README.md](harmonization/argentina/gold/README.md).

## Repository layout

```
pipeline/
  bronze/        load raw FIRMS data into R2 (yearly files and the API)
  silver/        clean, combine and standardise every detection
  gold/          small summary tables the app reads (next)
tools/           quick checks on the data in R2
exploration/     exploratory analysis
app/             web app (added as we build)
worker/          Cloudflare Worker (added as we build)
docs/            challenge.md (official text), youtube_transcript.md (challenge video),
                 harmonization_data_brief.md (data, findings, method; start here)
```

## Setup

1. Repository **Settings → Secrets and variables → Codespaces** needs four secrets:
   `R2_KEY_ID`, `R2_SECRET`, `CF_ACCOUNT_ID`, `FIRMS_MAP_KEY`.
2. **Code → Codespaces → ⋯ → New with options**, branch `dev`. Python packages install automatically.

Work on your own branch (`name/what`), push it, and open a pull request into `dev`.

Never put keys in code or commit them. They only live in the Codespaces secrets.

## Scripts

Run from the top folder of the repo in the Codespace terminal, e.g. `python -u pipeline/bronze/ingest_firms_api.py test`.

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
| `pipeline/bronze/ingest_firms_yearly.py` | Downloads the FIRMS yearly country files (MODIS 2000 to 2025, NOAA-20 2018 to 2025; `snpp` for Suomi NPP 2012 to 2025) into `raw/`. `test` runs one year. Skips years already in R2. |
| `pipeline/bronze/ingest_firms_api.py` | Pulls 2026 to date from the FIRMS API into `raw_api/`. `test` makes one request per source; `noaa21` and `snpp` add those satellites. Waits out the API rate limit and resumes where it stopped. |
| `pipeline/silver/build_silver.py` | Builds the silver layer from `raw/` and `raw_api/`, and the lookups it needs. `test` builds the lookups and two small pieces, then prints checks. Skips pieces already built. |
| `tools/check_raw.py` | Columns, totals per sensor, and Argentina MODIS vs VIIRS by year. |
| `tools/r2_size.py` | Size of each folder in the bucket. |
| `exploration/explore.py` | Builds the monthly aggregate (local `analysis.duckdb` and `analysis/agg_monthly.parquet` in R2) and starts the exploratory analysis. |
| `exploration/explore_rest.py` | The rest of the exploratory analysis, read from `analysis.duckdb`. |

## Acknowledgements

We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE).