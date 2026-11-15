# MVP log: Argentina harmonized fire calendar data product

> **Historical build log (2026-11-14), status updated 2026-11-15.** The front-end items and blockers below have since been done; each now carries its status. Current state: [SCOPE_AND_GAPS.md](SCOPE_AND_GAPS.md). Authoritative schema: [gold/README.md](gold/README.md).

Task: [../docs/new_prompt.md](../docs/new_prompt.md). Method as settled in [recommendation.md](recommendation.md) (M1, counts,
D+N, calendar-month factor, fit 2012–2019). No new modelling. Schema for the app: [gold/README.md](gold/README.md).
Scope: [SCOPE_AND_GAPS.md](SCOPE_AND_GAPS.md).

## Step 0: app contract vs our deliverables

| App table | Our deliverable | Status |
|---|---|---|
| `gold_cell_monthly` | Cell-month table | Produced at 1° for the browser (0.1° kept as `gold_cell_monthly_01deg`, not exported) |
| `gold_region_monthly` | Country-month table (plus 5 sub-regions) | Produced, with honesty and baseline columns added |
| `gold_region_annual` | (derived) annual totals and season | Produced |
| `gold_region_headline` | (derived) one sentence per region | Produced; `top_analog_year` null |
| `gold_calibration` | M1 factors, per-month held-out error | Produced; one stratum `argentina` |
| `gold_region_analogs` | none | **Not produced** (not part of the validated method) |
| new `gold_reliability` | Reliability lookup | Added (needs API allowlist) |
| new `gold_accuracy` | Headline KPI file | Added (needs API allowlist) |

App columns with no equivalent in our method:
- `*_cell_days`: we do not harmonize cell-days, so these columns carry detection counts. `harmonized_cell_days` is the harmonized count.
- `stratum_id`: there are no strata; it is always `argentina`.
- The whole analogs table, and `top_analog_year`.
- `holdout_mape` exists but is thin (3 test months per calendar month).

Our fields with no app column, all added:
- `method`, `coverage`, `reliability`
- `harmonized_low`/`high`, `likely_low_pct`/`high_pct`, `anomaly_class_stable`
- `raw_satellite`, `raw_count`
- the VIIRS-only baseline (`baseline_viirs_*`, `anomaly_*_viirs`), `baseline_id`
- `factor_rel_sd`, `months_insufficient`
- the reliability and accuracy tables

## Run log

| # | Ran | Result | File |
|---|---|---|---|
| 1 | `13_mvp_checks.py` | Reproduces the 11_method_test E1 figures exactly (bias −7.23%, median error 9.45%) | `data/13_mvp_checks.txt`, `data/13_checks.csv` |
| 2 | `14_build_gold.py` | 287 months (2003-01 → 2026-11-14): 109 modelled, 174 observed, 4 NRT. Cells sum to the country total (max diff 0.05) | `gold/*.parquet`, `data/14_build_gold.txt` |
| 3 | `export_calendar.py --local gold` | JSON: cell 15.05 MB (0.55 MB gzip), region monthly 1.55 MB, other tables < 0.1 MB | `gold/publish/*.json` (gitignored) |
| 4 | `15_pitch_figures.py` | 4 figures | `plots/pitch_1..4_*.png` |
| 5 | Plausibility check | Oct 2026 is the lowest October (0.2× usual) in both Aqua and NOAA-20. Bbox totals ignoring the country label drop the same way, and global ingestion is complete, so it is real and not a lookup or API artefact | (ad hoc queries) |

## Check 1: flare-cell sensitivity (M1 fit 2012–19, test 2020–22, country)

| mask | VIIRS removed | factor change, mean / max | bias | median abs error | p90 error | worst annual |
|---|---|---|---|---|---|---|
| none (production) | 0% | – | −7.2% | 9.5% | 19.0% | 8.9% |
| Vaca Muerta box (lat −39.5…−36.5, lon −70.5…−67.5) | 1.5% | 1.7% / 3.2% | −6.9% | 9.4% | 18.5% | 9.4% |
| persistent ≥ 200 days + Vaca Muerta | 30.6% | 3.4% / 6.4% | −6.4% | 8.3% | 20.6% | 10.2% |

**Result:** the flare-targeted mask (Vaca Muerta) changes the factors by under 3% on average and leaves the test error
unchanged. **No mask for the MVP.** The broad persistent-cell mask removes 31% of VIIRS detections, most of them real
agricultural fire (for example, the Tucumán sugarcane belt). It gives mixed results: the median error improves, while the p90
and annual errors get worse. It is not recommended.

## Check 2: day-only vs day+night (test 2020–22, country)

| variant | bias | median abs error | p90 error | worst annual |
|---|---|---|---|---|
| day+night (default) | −7.2% | 9.5% | 19.0% | 8.9% |
| day only | −7.7% | 8.7% | 21.5% | 9.5% |

Aqua's day share 2003–2011 is 92.5% (sd 0.85, range 91.0–93.6), which is stable. Day-only is not clearly better: the median
error improves while the p90 and annual errors get worse. **The default stays day+night.**

## Decisions made in the build (stated, not tuned)
- **Factors:** fit 2012–2019 (as tested), not 2012–2022, so the KPIs describe the factors actually used.
- **Jan 2012:** modelled from Aqua. Suomi NPP covers only 12 of 31 days, and the rule is that a VIIRS month needs ≥ 50% valid days.
- **Country likely range:** the LOYO 95% band, −20.9% / +23.2% (it covered 86% of unseen months).
- **Sub-region and user-area likely range:** from the size bins, recomputed as LOYO 95% bands by Aqua count. The findings
  log had 80% bands only; the 80% bands are kept alongside.
- **Annual likely range:** country LOYO annual band −8.2% / +8.1%. For sub-regions, the wider of that band and the
  size-bin band at the annual count.
- **Baselines:** default = harmonized 2003–2022 (complete months); alternative = observed VIIRS 2012–2025.
- **Cell resolution:** 1° for the browser.

## Front-end changes needed (status as of 2026-11-15)

Status by item: 1 done on visible pages (hidden pages may still say cell-days; unverified); 2 done; 3 done; 4 done (`web/mvp.js`); 5 done (Fire calendar toggle); 6 done (`web/accuracy.html`); 7 done (`web/draw.html`); 8 done (`anomaly_status`); 9 not done, Map page hidden (G-19); 10 done by hiding the pages that show analogs; 11 not done, Year page hidden (G-27).

1. **Units:** replace "cell-days" with "fire detections (VIIRS-equivalent)" everywhere. It appears in `map.js`,
   `calendar.js`, `overview.js`/`.html`, `year.js`/`.html`, `glossary.html` (the `harmonized-cell-days` entry and the unit
   text) and `briefing.js` text. Later, rename the columns to `*_count` in the build, the export list and the JS together.
2. **Regions:** replace `REGIONS` in `web/gold.js` with the 6 ids in [gold/README.md](gold/README.md), all with
   `stratum: "argentina"`. **Without this, live tables show nothing**, because no row matches `argentina_chaco` or
   `brazil_cerrado`.
3. **API allowlist:** add `gold_reliability` and `gold_accuracy` in `functions/api/gold/[table].js`.
4. **Modelled months:** draw them hatched or outlined (calendar cells, bars, map). Show "likely range
   `harmonized_low`–`harmonized_high`" in tooltips. Grey out `indicative_only` months and show the `suggestion`. Mark
   `anomaly_class_stable = false` (for example, "class uncertain").
5. **Baseline toggle:** default `baseline_*`/`anomaly_*`; alternative `baseline_viirs_*`/`anomaly_*_viirs`. Label the active
   baseline. The VIIRS baseline has no p25/p75, so the normal-range band follows the default.
6. **Accuracy panel:** read `gold_accuracy.statement`.
7. **User-drawn areas:** in modelled months, sum `modis_cell_days` over the selected cells and look the result up in
   `gold_reliability`. Polygons are limited to 1° cells in the browser.
8. **Incomplete month (Nov 2026):** anomaly fields are null. Show "month in progress" instead of "Unknown usual".
9. **Map tooltip:** `modis_hotspots`/`viirs_hotspots` are trimmed from the JSON (they duplicate `*_cell_days`), so drop
   the "· N hotspots" text.
10. **Analogs:** hide the panels, or leave them. They render "–" or "No analog years", but the source pill will read
    "Partly sample" because analogs still fall back to the sample.
11. **Text:** `year.js` calibration text ("stratum", "cell-days", "MAPE") needs rewording.
    `gold_region_annual.rank` is null for 2026.

## Blockers for the app (status 2026-11-15: blocker 1 resolved, blocker 2 still open as G-12)

**Blocker 1 resolved 2026-11-15:** the Parquet files and JSON are published to R2 (via DuckDB, D-25), with `REGIONS` and the allowlist changed first. Blocker 2 is still true.
1. **Not published.** The Parquet files are only on this machine. A `.env` with R2 credentials exists, but I did not
   upload, because publishing switches the live site off the sample, and with the current `REGIONS` the live pages would
   go empty (change 2). Order: change `REGIONS` (and the allowlist), then run `14_build_gold.py --upload`, then
   `scripts/export_calendar.py`.
2. `14_build_gold.py` depends on the gitignored `data/argentina.duckdb`. A Codespace must first rerun 02 → 05 → 07, or
   someone uploads from this machine.

## Small issues (do not change the picture)
- Annual totals count `insufficient_data` months as 0 (Patagonia and Delta only). **Resolved 2026-11-15 (D-22):** such years are partial, with no rank or anomaly.
- The 1° cell sums differ from the region totals by ≤ 2 detections (rounding).
- `holdout_mape` rests on 3 months per calendar month.
- `14_build_gold_stdout.txt` in `data/` duplicates `14_build_gold.txt` and can be deleted.
- The MODIS version-label question (2018) is still open.
- The region boxes are rough.
