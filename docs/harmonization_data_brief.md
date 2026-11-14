# Harmonization data brief (Kubranauts, NASA Space Apps 2026)

This brief summarises everything we know so far about our fire data, written for the person building the MODIS–VIIRS harmonization engine and for an LLM helping them. It covers the challenge, the satellites, what data we hold and where, its schema, how to read it, what our exploration found, the pitfalls, the draft method, and what the engine must output.

## 1. The challenge

**"Harmonization of MODIS and VIIRS Hot Spots"**. Full official text in [challenge.md](challenge.md); the author's video intro is in [youtube_transcript.md](youtube_transcript.md).

In short: VIIRS (2012 onward) sees far more fires than MODIS (2000 onward), so any long-term chart that switches sensors shows jumps that never happened on the ground. The goal is **one consistent fire record from 2000 to today in which the sensor of origin no longer matters**.

What the app must offer, as we read the brief:
- Choose a region (draw an area or enter lat/lon) and a date range, from the early 2000s to the present.
- A harmonized series, with a calendar view and colour ramps.
- Anomalies against the average and against the median.
- Downloadable analytics, visuals and a CSV of hotspots.
- Fires detected and fires reported (reported events can come from NASA EONET).

Judging prioritises relevance to the brief, then scientific soundness, code, presentation and creativity. A clear, validated method with honest uncertainty is worth more than a complicated one.

## 2. Satellites and instruments

Two **instruments** (cameras) flown on five **satellites**. Harmonization is mainly an instrument problem (pixel size, detection algorithm), with smaller satellite effects (time of day, drift).

| Satellite | Instrument | Pixel at nadir | Fire data from | Overpass (local solar time) | Status |
|---|---|---|---|---|---|
| Terra | MODIS | 1 km | 1 Nov 2000 | ~10:30 and ~22:30 originally; drifting earlier since 2020 (heading to ~8:30 by late 2026) | Still collecting; NASA plans to end science around Feb 2027 |
| Aqua | MODIS | 1 km | Jul 2002 | ~13:30 and ~01:30 originally; drifting later since 2022 (~15:30 by mid-2026) | Still collecting; NASA plans to end science around Sep 2027 |
| Suomi NPP | VIIRS | 375 m | 20 Jan 2012 | ~13:30 and ~01:30 | New data stopped 2 Nov 2026 |
| NOAA-20 | VIIRS | 375 m | 1 Apr 2018 | ~13:30 and ~01:30 | Active |
| NOAA-21 | VIIRS | 375 m | 1 Mar 2023 (final data) | ~13:30 and ~01:30 | Active (not loaded yet) |

Suomi NPP, NOAA-20 and NOAA-21 fly in the same orbital plane, roughly 50 minutes apart. Each satellite passes over a given place about twice a day (one day pass, one night pass). **Never add satellites together**: two satellites mean twice the passes, so counts go up even if nothing changes on the ground.

## 3. What data we hold and where

Everything is Parquet in the Cloudflare R2 bucket `firms-data` (about 19 GB in total). The [README](../README.md) has the short path table; this section adds volumes and detail.

**Bronze (raw, as received, never modified):**

| Path | Contents | Volume |
|---|---|---|
| `raw/modis/{year}.parquet` | MODIS Terra + Aqua, 2000–2025, FIRMS yearly country files (science quality). Has `country` and `type`. | 111,424,417 rows (2000-11-01 to 2025-12-31), 1.47 GB |
| `raw/viirs_noaa20/{year}.parquet` | VIIRS NOAA-20, 2018–2025, same source. | 155,932,272 rows (2018-04-01 to 2025-12-31), 2.42 GB |
| `raw/viirs_snpp/{year}.parquet` | VIIRS Suomi NPP, 2012–2025, same source. | Similar volume to NOAA-20 per year (not yet counted), 4.37 GB |
| `raw_api/{sensor}/2026_{sp,nrt}.parquet` | 2026 to date from the FIRMS API, MODIS and NOAA-20 only. No `country`; NRT rows also have no `type`. | MODIS 0.05 GB, NOAA-20 0.28 GB |

**Science-quality (SP) vs near-real-time (NRT) cut-offs** (from the FIRMS availability check on 14 Nov 2026): MODIS SP runs to 2026-08-31, NRT from 2026-09-01. VIIRS SP (all three VIIRS satellites) runs to 2026-07-31, NRT from 2026-08-01. NRT is replaced by SP a few months after release.

**Silver (cleaned, combined, one consistent schema):** `silver/detections/source={modis|viirs_snpp|viirs_noaa20}/year={yyyy}/{archive|sp|nrt}.parquet`, about 570 million rows (estimate), about 10.4 GB. Per-year volumes: MODIS about 4–5M rows, VIIRS about 18–22.5M rows (NOAA-20: 2021 20.1M, 2022 18.0M, 2023 21.3M, 2024 22.5M, 2025 18.4M; 2026 to mid-November 9.6M SP + 7.5M NRT).

**Silver lookups** (`silver/lookups/`): `country_01deg` (most common country per 0.1° cell), `country_1deg` (per 1° cell, fallback), `static_005deg` (0.05° cells with ≥10 past detections of which <50% were vegetation fires: volcanoes, gas flares, industry, offshore). They are used to give 2026 API rows a country and NRT rows a fire type.

Not loaded yet: NOAA-21 (available from Mar 2023), Suomi NPP 2026 (Jan to 2 Nov), FIRMS burned-area products.

## 4. Silver schema

One row = one detection: one satellite pixel, at one moment, flagged as containing a fire.

| Column | Meaning |
|---|---|
| `source`, `year` | From the folder names (hive partitions). `source` ∈ modis, viirs_snpp, viirs_noaa20. Filter on these for speed. |
| `satellite` | Terra, Aqua, Suomi NPP, NOAA-20 |
| `instrument` | MODIS or VIIRS |
| `quality` | SP (final science quality) or NRT (quick, 2026 only) |
| `acq_datetime_utc`, `acq_date_utc` | Overpass time and date in UTC |
| `local_date` | Local solar date (UTC + longitude/15 hours). Use for daily counts. |
| `latitude`, `longitude` | Pixel centre, decimal degrees |
| `lat10`, `lon10` | 0.1° grid cell (floor of lat×10, lon×10) |
| `country`, `country_source` | FIRMS country name (underscored, e.g. `South_Sudan`); source is `file`, `lookup_01deg`, `lookup_1deg` or blank (about 0.35% of 2026 API rows, mostly open ocean) |
| `daynight` | D or N |
| `frp` | Fire radiative power, MW |
| `confidence_class`, `confidence_raw` | low / nominal / high (MODIS: <30 low, 30–79 nominal, ≥80 high; VIIRS: l/n/h) and the original value |
| `bright_main`, `bright_aux` | Brightness temperatures, K (MODIS: brightness / bright_t31; VIIRS: bright_ti4 / bright_ti5) |
| `scan`, `track` | Pixel size on the ground, km; grows towards the swath edge |
| `type_reported`, `type_final`, `type_inferred` | FIRMS type (0 vegetation, 1 volcano, 2 other static land source, 3 offshore); `type_final` uses FIRMS's value or our static lookup for NRT rows; `type_inferred` marks the latter |
| `is_vegetation_fire` | `type_final = 0`. The main filter for fire counts. |
| `version` | FIRMS product version |

Standard filter for fire counts: `WHERE is_vegetation_fire AND confidence_class <> 'low'`.

## 5. Reading the data

Environment: GitHub Codespaces (2-core, 8 GB RAM), Python, DuckDB **2.0.0** (pinned), boto3. Credentials come from environment variables (`R2_KEY_ID`, `R2_SECRET`, `CF_ACCOUNT_ID`), never hard-coded; the repo is public.

```python
import duckdb, os
con = duckdb.connect()
con.sql("SET memory_limit = '3GB'")           # big queries spill to disk instead of crashing
con.sql("SET temp_directory = 'tmp_ml'")       # add tmp_ml/ to .gitignore
con.sql(f"""CREATE SECRET r2 (TYPE r2, KEY_ID '{os.environ["R2_KEY_ID"]}',
  SECRET '{os.environ["R2_SECRET"]}', ACCOUNT_ID '{os.environ["CF_ACCOUNT_ID"]}')""")
SILVER = "read_parquet('r2://firms-data/silver/detections/*/*/*.parquet', hive_partitioning = true)"

daily = con.sql(f"""
    SELECT country, local_date, satellite, daynight, count(*) AS n, sum(frp) AS frp_sum
    FROM {SILVER}
    WHERE is_vegetation_fire AND confidence_class <> 'low' AND year BETWEEN 2012 AND 2025
    GROUP BY country, local_date, satellite, daynight
""").df()
```

Practical notes:
- Aggregate in DuckDB first; never pull raw detections into pandas (one VIIRS year is about 20M rows).
- Filter on `source` and `year` so DuckDB reads only the needed folders.
- DuckDB 2.0 quirks we hit: relations no longer have `.fetchone()` (use `.fetchall()[0]`); `days` cannot be used as a column alias; `GROUP BY ALL` combined with a window function over an aggregate fails (use a subquery with an explicit `GROUP BY`).
- Random samples: use `ORDER BY random() LIMIT n`. `USING SAMPLE` returned rows from the start of each file only, and files are sorted by date.
- The column guide is the table in section 4. (A sample CSV and a separate column guide are not in the repo yet.)

## 6. What our exploration found

All figures are from bronze (science-quality data). Ratios use vegetation fires (`type = 0`) and non-low confidence unless stated.

**Volumes by satellite:** Terra about 1.5–1.8M detections per year, falling to 1.25M in 2022 and 1.07M in 2025 (consistent with its orbit drift). Aqua about 3M per year from Jul 2002. NOAA-20 about 20M per year. **2025 is complete and genuinely lower** than 2024; it is not missing data.

**Detection types:** MODIS 96.6% vegetation, 3.3% static land sources. VIIRS 93.1% vegetation, 6.4% static land sources, 0.36% offshore. VIIRS picks up more small static sources.

**Low-confidence share:** MODIS 4.7%, VIIRS 11.5%. The confidence filter removes more from VIIRS, so it affects the ratio.

**Day/night share (daytime):** Aqua 94%, Terra 74%, VIIRS 74%.

**VIIRS (NOAA-20) ÷ Aqua detection ratio, 2019–2025:**
- Global, by calendar month: 5.2 to 7.1.
- By country: Angola 4.21, DR Congo 4.68, Brazil 6.05, Australia 7.8, Russia 9.42, Canada 11.94.
- The ratio clearly depends on region (fire regime and fire size) and season, so a single global factor will not work.

**Argentina, VIIRS ÷ all MODIS (Terra + Aqua) by year:** 2018 2.35 (partial year), 2019 3.19, 2020 3.5, 2021 3.5, 2022 4.03, 2023 3.42, 2024 3.17, 2025 3.54. 2020 was a big fire year (124,094 MODIS vs 434,775 VIIRS detections). Argentina peaks in August–September. Known events to check the series against: Paraná Delta (April 2008), Paraná Delta and Córdoba (August–October 2020), Corrientes (January–February 2022). The arrival of Aqua in July 2002 shows as a visible jump in raw MODIS counts, a textbook example of an artificial step from a change in satellites.

**Fire radiative power per detection:** Aqua 46 MW, Terra 41.4 MW, VIIRS 10.2 MW. Total FRP (VIIRS ÷ MODIS) is therefore only about 1.4×, against about 5–7× for counts. **FRP is much more comparable across instruments than detection counts.**

**Missing days:** 2022 (Aqua 16 days, Terra 12 days), Terra 2016 (9 days), VIIRS 2023 (5 days). FIRMS has a `missing_data` API for the full list.

**Silver checks (MODIS 2026 NRT):** 98.4% of rows got a country from the 0.1° lookup, 1.3% from the 1° fallback, 0.35% none. 4.3% were inferred as non-vegetation, close to the historical static share.

## 7. What makes harmonization hard

1. **Resolution and fire size.** One large fire lights up many 375 m VIIRS pixels but few 1 km MODIS pixels; small fires are seen only by VIIRS. The count ratio therefore depends on the fire-size distribution, which varies by biome and season.
2. **Overpass time and the diurnal fire cycle.** Fires peak in the mid-afternoon. Terra (morning), Aqua and VIIRS (early afternoon) sample different points of the cycle.
3. **Orbit drift.** Terra has drifted earlier since 2020 and Aqua later since 2022, so ratios fitted on 2019–2025 mix in drift effects. Suomi NPP gives a 2012–2019 overlap with MODIS before the drift.
4. **View angle.** Pixels grow towards the swath edge (`scan`, `track`), lowering detection sensitivity. MODIS also has edge-of-swath overlap ("bow-tie") that can duplicate detections.
5. **Different confidence semantics.** VIIRS has far more low-confidence detections; the filter changes the effective ratio.
6. **Static sources.** VIIRS detects more gas flares and industrial heat. These must be removed (`is_vegetation_fire`) before fitting, and NRT rows rely on our inferred labels.
7. **Data gaps** (section 6). Counts on missing days are not zero; count per day of available data and flag the gaps.
8. **Clouds.** Both instruments miss fires under cloud, at different times of day.
9. **Regional heterogeneity.** Large countries (Brazil, Russia, Canada, the US, Australia) span several fire regimes; a country-level factor averages them.
10. **SP vs NRT.** The last few months of 2026 are near-real-time data, which is less refined.

## 8. Draft method and decisions so far (open to improvement)

**Decided:**
- **Units are VIIRS-equivalent**: "what one VIIRS satellite would have counted". VIIRS is the future (MODIS ends in 2027, and the live daily feed is VIIRS).
- **Single-satellite reference, never summed.** VIIRS reference = Suomi NPP for 2012-01-20 to 2018-03-31, NOAA-20 from 2018-04-01. Check that Suomi NPP ≈ NOAA-20 over the 2018–2025 overlap (expected near 1:1; not yet measured).
- **MODIS reference = Aqua.** Terra-only years (Nov 2000 to Jul 2002) are first converted to Aqua-equivalent using the Terra–Aqua overlap, then to VIIRS.

**Draft baseline (ratio method):**
1. Daily counts per country × local_date × satellite × day/night (vegetation, non-low confidence).
2. Factor = VIIRS reference ÷ Aqua, by country × calendar month × day/night, fitted mainly on 2012–2019 (pre-drift). Shrink towards the country-level factor, then the global factor, where counts are small.
3. Harmonized series: from 2012 use measured VIIRS counts (`method = measured`); before 2012, MODIS × factor (`method = modelled`), with an uncertainty range from the year-to-year spread of the factor.
4. Validation: leave-one-year-out over 2012–2025 (predict VIIRS from MODIS for the held-out year), reported by country. Also compare a 2012–2019 fit against 2020–2025 to measure the drift effect.
5. Anomalies: harmonized count vs the mean and the median of the same month across a baseline period (period to be decided), as % difference and percentile.

**Where ML can add value:**
- A model predicting the VIIRS-reference count (per country × month × day/night, or per grid cell × month) from Aqua and Terra counts plus features: total FRP and FRP distribution, mean `scan`/`track` (view angle), month, latitude, day/night, region or biome. Train on the overlap, validate leave-one-year-out and against the drift years, and compare against the ratio baseline.
- Prediction intervals (quantile regression or conformal prediction) for the uncertainty band.
- Alternative harmonized quantities that may be more stable than raw counts: **total FRP** (ratio ~1.4× vs ~5–7×) and **fire-active cell-days** (number of 0.1° cells with at least one detection per day). Coarser units should reduce the resolution effect. This is worth testing.

## 9. What the engine must output (draft gold contract)

Gold tables are Parquet in R2 under `gold/`, small enough for the app to load into memory. Column names are proposals to agree with the team (Sonia defines the final data products, Akbar connects them to the front end, Ben hosts the app on Cloudflare).

| Table | One row per | Main columns |
|---|---|---|
| `gold/daily_counts` | country × local_date × satellite × day/night | raw `n`, `frp_sum` (the raw input, also used for the app's raw-vs-harmonized toggle) |
| `gold/daily_country` | country × local_date | raw counts per satellite, `harmonized`, `harmonized_low`, `harmonized_high`, `method` (measured/modelled), gap flags |
| `gold/monthly_country` | country × month | `harmonized`, `baseline_mean`, `baseline_median`, `anomaly_pct_vs_median`, `percentile` |
| `gold/map_monthly` | map cell × month | `harmonized` (H3 hexes or a lat/lon grid) |
| `gold/calibration_factors` | country × month × day/night | `factor`, `n_years`, `spread`, `fallback_level`, `fitted_years` |
| `gold/validation` | country × year | `actual`, `predicted`, `error` |

Hotspot CSV downloads are served from silver directly (filtered to the user's area and dates), not from gold. The pipeline code lives in `pipeline/gold/build_gold.py` (to be written) in the repo, alongside `pipeline/bronze/` and `pipeline/silver/`.

## 10. Open questions

1. Which harmonized quantity is primary in the app: detection counts, FRP, or active cell-days? Possibly offer more than one.
2. Calibration regions: country (simplest), or biome / large grid cells for big, mixed countries?
3. Anomaly baseline period (for example 2003–2022, or 2012–2025 for VIIRS-era only).
4. How to treat the NRT months of 2026 (flag them, or wait for SP).
5. Whether to add NOAA-21 (and Suomi NPP 2026) for the recent period.
6. Whether to fit day and night separately everywhere, or pool where night counts are small.
7. How gaps are shown and whether they are infilled.

## Sources

- FIRMS archive download (temporal coverage per sensor): https://firms.modaps.eosdis.nasa.gov/download/
- FIRMS API (area endpoint, data availability): https://firms.modaps.eosdis.nasa.gov/api/area/csv
- Suomi NPP data transition (end of new data, 2 Nov 2026; NOAA-20 and NOAA-21 orbits): https://www.earthdata.nasa.gov/news/blog/transitioning-from-suomi-npp-noaa-20-noaa-21-what-lance-users-need-know
- MODIS to VIIRS transition (Terra and Aqua end dates): https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition/
- Terra orbit drift: https://ntrs.nasa.gov/citations/20250000522
- Aqua status (crossing-time drift): https://aqua.gsfc.nasa.gov/sites/default/files/AquaStatus_May2025.pdf
