# Gold tables: Argentina MVP (data schema for the app developer)

Built by [14_build_gold.py](../14_build_gold.py) (method M1, see [recommendation.md](../recommendation.md)). Published to
`publish/<table>.json` by [scripts/export_calendar.py](../../../scripts/export_calendar.py), which keeps only the columns listed at
the top of that script.

## The one thing to know

**Unit = VIIRS-equivalent fire detections**: the number of fire pixels one VIIRS satellite would have seen (fire filter
`is_vegetation_fire AND confidence_class <> 'low'`, day + night). For app compatibility, every column whose name ends in
`_cell_days` holds a **detection count** in this version. It is not a count of cell-days.

| Months | Value | `method` | `source` (app vocabulary) |
|---|---|---|---|
| 2003-01 → 2012-01 | MODIS Aqua × calendar-month factor (Jan 2012: Suomi NPP covers only 12 days) | `modelled_aqua` | `modis_calibrated` |
| 2012-02 → 2018-03 | Suomi NPP, measured | `observed_viirs` | `viirs_archive` |
| 2018-04 → 2026-07 | NOAA-20, measured (science quality) | `observed_viirs` | `viirs_archive` |
| 2026-08 → today | NOAA-20, near real time | `provisional_nrt` | `viirs_nrt` |
| modelled month, Aqua = 0 in the area | null, not zero | `insufficient_data` | `modis_calibrated` |

Months before 2003 are excluded on purpose (Terra only, plus the Aqua start-up). Gap days are missing data: each month is
scaled by days ÷ valid days (`coverage` = valid fraction). The current month is not scaled to a full month: it is
`is_complete = false` and has no anomaly.

## Regions (`region_id`)

| id | name | definition (0.1° cell lower-left corner) |
|---|---|---|
| `argentina` | Argentina | every detection FIRMS labels Argentina |
| `ar_ne` | North-east (Mesopotamia, eastern Chaco, Formosa) | lat > −35, lon > −60.5 |
| `ar_nw` | North-west and western Chaco | lat > −30, lon ≤ −60.5 |
| `ar_c` | Centre (Pampas, Córdoba, San Luis, La Pampa) | −39 < lat ≤ −30, not NE |
| `ar_s` | Patagonia | lat ≤ −39 |
| `ar_delta` | Paraná Delta (box) | lat −34.5…−32.1, lon −61.0…−58.4 (inside `ar_ne`) |

NE/NW/C/S partition the country and are the zones the method was validated on. They are rough boxes, not ecoregions.
`stratum_id` is always `argentina`.

## Tables

### `gold_cell_monthly` (map). 1° cell × month, 54,760 rows, JSON 15.1 MB (0.55 MB gzipped)
App columns: `cell_id` (int, from the 1° indices), `cell_x`/`cell_y` (1° floor indices of lon/lat), `lon_center`,
`lat_center`, `year`, `month`, `month_start`, `harmonized_cell_days` (harmonized count), `modis_cell_days` = `modis_hotspots`
(raw Aqua count), `viirs_cell_days` = `viirs_hotspots` (raw count of the VIIRS reference satellite; null before 2012),
`calibration_ratio` (factor, modelled months only), `source`, `is_provisional`, `stratum_id`.
Added: `method`, `coverage`, `raw_satellite`, `raw_count`, `is_complete`.
Only cells with at least one detection are present. A missing cell-month means zero detections were recorded.
0.5° would be 37 MB of JSON, and 0.25° or 0.1° would be larger still, so the browser table is 1°.

### `gold_cell_monthly_01deg` (not exported). 0.1° cell × month, 549,849 rows, 2.3 MB Parquet
Same values at full resolution (`lat10`, `lon10` = floor of lat×10, lon×10), for fast polygon sums on the server.
The cells sum exactly to the country month.

### `gold_region_monthly` (calendar). Region × month, 2003-01 → current, 1,722 rows, 1.55 MB JSON
App columns as in the sample. `harmonized_cell_days` is the harmonized count. `modis_cell_days` is the raw Aqua count.
`viirs_cell_days` is the raw VIIRS reference count. `baseline_*` (median, mean, p25, p75, min, max) and `anomaly_*` use the
**default baseline** (`baseline_id = harmonized_2003_2022`: the same calendar month, complete months, 2003–2022).
`anomaly_class` uses the app's ratio-to-median thresholds (<0.5, <0.8, ≤1.2, ≤1.8, above). `rank_in_month`,
`percentile_rank` and `n_years_ranked` are computed over every complete year 2003–2026 with a value.
Added:
- `method`, `coverage`, `raw_satellite`, `raw_count`
- `reliability`: `reliable` | `good` | `caution` | `indicative_only`. Observed months are always `reliable`.
- `harmonized_low`, `harmonized_high`, `likely_low_pct`, `likely_high_pct`: the **likely range** (about 85% chance of
  containing the true value, tested on held-out years). It equals the value for observed months. For modelled months it is
  the country band for `argentina`, and comes from `gold_reliability` (by the area's Aqua count) for sub-regions.
- `anomaly_class_stable`: true if the low and high ends of the likely range give the same class.
- `baseline_viirs_median`, `baseline_viirs_mean`, `baseline_viirs_n_years`, `anomaly_ratio_viirs`, `anomaly_class_viirs`:
  the **alternative baseline** (observed VIIRS months only, 2012–2025).
- `baseline_n_years`, `aqua_equiv` (Aqua count scaled by coverage, which drives the reliability lookup). `aqua_equiv` is Parquet only.

### `gold_region_annual`. Region × year, 144 rows
App columns as in the sample. `anomaly_ratio` is relative to the 2003–2022 median of complete years. `rank` is null for the
incomplete current year. The season start, midpoint and end are the months where 10%, 50% and 90% of the year's total is reached.
Added: `method` (`modelled_aqua` | `observed_viirs` | `mixed` | `provisional_nrt`), `harmonized_low`/`high` (annual
likely range; modelled share only), `months_insufficient`.

### `gold_region_headline`. One row per region
As of the latest complete, **non-provisional** month (2026-07). `top_analog_year` is always null. Added: `method`, `region_name`, `latest_provisional_month`, `latest_provisional_value` (value only, never compared).

### `gold_calibration`. 12 rows (one stratum, `argentina`)
`ratio` = M1 factor (VIIRS ÷ Aqua). `modis_cell_days_fit` and `viirs_cell_days_fit` are the Aqua and Suomi NPP **counts**
summed over the fit years 2012–2019 on matched valid days. `n_months` = 8 (one month per fit year).
`holdout_mape` = mean absolute % error for that calendar month in 2020–2022 (3 months each, so noisy).
Added: `factor_rel_sd` (year-to-year sd of the log ratio), `holdout_years`, `modis_satellite`, `likely_low_pct`/`high_pct`.

### `gold_reliability` (new). 7 rows: likely range by the size of the area-month
For any user-drawn area in a **modelled** month: sum `modis_cell_days` of the selected cells, find the bin, then show the
flag and the suggestion. Observed months are always reliable.

| Aqua detections in area-month | likely range | 80% range | flag |
|---|---|---|---|
| < 5 | −85% / +626% | −71% / +225% | indicative_only |
| 5–19 | −83% / +169% | −65% / +71% | indicative_only |
| 20–49 | −82% / +82% | −49% / +35% | indicative_only |
| 50–199 | −48% / +62% | −35% / +30% | caution |
| 200–999 | −32% / +52% | −23% / +24% | caution |
| 1,000–4,999 | −23% / +38% | −15% / +17% | good |
| ≥ 5,000 | −12% / +25% | −10% / +17% | reliable |

Flag rule, on the half-width of the likely range: ≤ 30% reliable, ≤ 40% good, ≤ 65% caution, above that indicative_only.
The sum of a small area with Aqua = 0 is not zero fire: VIIRS saw fire in 96% of such block-months.

### `gold_accuracy` (new). 8 rows: the "accuracy" panel
`metric`, `value`, `unit`, `statement` (one plain-language sentence), `test_period`, `source`, `method_version`, `computed_at`.
Test: factors fitted on 2012–2019, scored on unseen 2020–2022. Median monthly error 9.5%, 90th percentile 19.0%, worst
annual 8.9%, bias −7.2%, likely-range coverage 86%, and 89% agreement with the app's five anomaly classes (whole country). All rows
are on held-out years and each row carries its `test_period`. Earlier agreement figures from the fit years (in sample) stay in
`findings_log.md` §3 and are not in this table.

### `gold_region_analogs`. Not produced
Analog years are not part of the validated method. The app keeps its sample file for this table, which matches no new
region id, so the analog panels show "–" or "No analog years".

## Rebuild and publish

```bash
cd harmonization/argentina
../../venv/Scripts/python.exe -u 14_build_gold.py            # writes gold/*.parquet
python ../../scripts/export_calendar.py --local gold         # optional: writes gold/publish/*.json to check sizes
../../venv/Scripts/python.exe -u 14_build_gold.py --upload   # copies gold/*.parquet to r2://firms-data/gold/
python scripts/export_calendar.py                            # (repo root, Codespace) publishes JSON to R2
```

`14_build_gold.py` reads the local `data/argentina.duckdb` (gitignored). In a fresh Codespace, rebuild it first with
`02_extract.py` (about 6 minutes against R2), `05_build_local.py` and `07_build_daily.py`.

## Rules added 2026-11-15 (authoritative)

- **Provisional rule.** Months with `method = provisional_nrt` (NRT, from 2026-08) and the month in progress carry the value, but
  `anomaly_ratio`, `anomaly_diff`, `anomaly_class`, `anomaly_*_viirs`, `anomaly_class_stable`, `percentile_rank` and `rank_in_month` are
  **null**. New column `anomaly_status` in `gold_region_monthly`: `ok` | `provisional` | `incomplete` | `insufficient_data`. Provisional
  months are also excluded from ranks (`n_years_ranked` counts complete, non-provisional months).
- **Partial years.** A year with any `insufficient_data` month is flagged `is_partial = true` and `is_complete = false` in
  `gold_region_annual`: its total sums only the months that have an estimate, and it gets no rank and no `anomaly_ratio`.
  The year in progress is partial too.
- `gold_region_monthly` also exports `raw_count` (unconverted count from the reference satellite) for the raw-against-harmonized view.
