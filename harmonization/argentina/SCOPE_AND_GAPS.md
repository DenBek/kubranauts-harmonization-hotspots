# Scope and gaps: Argentina harmonized fire calendar

Living document. Single source of truth for what we deliver, what we do not, and what is open. Last updated **2026-11-14**.
Method and story: [HARMONIZATION_APPROACH.md](HARMONIZATION_APPROACH.md). Run log and front-end change list: [MVP_LOG.md](MVP_LOG.md).
Data schema: [gold/README.md](gold/README.md). Investigation: [findings_log.md](findings_log.md), [recommendation.md](recommendation.md).

**Rules.** Add a change-log line and update the status table after every task. Record decisions, gaps and questions as soon as
they appear. Never delete one; mark it resolved or superseded with a date and a pointer. Every claim cites its source; if it
cannot, it is marked *unverified*. Keep to about 300 lines.

## 1. Status snapshot

Owner = not recorded in the repo; "unassigned" until the team fills it in.

| Deliverable | Status | Owner | Updated | Note |
|---|---|---|---|---|
| Investigation and method (M1) | done | unassigned | 2026-11-14 | `findings_log.md`, `recommendation.md` |
| Flare-cell and day-only checks | done | unassigned | 2026-11-14 | `data/13_mvp_checks.txt`; D-14, D-15 |
| Gold tables (Parquet, local) | done | unassigned | 2026-11-14 | `gold/*.parquet`; build log `data/14_build_gold.txt` |
| Reliability lookup and accuracy file | done | unassigned | 2026-11-14 | `gold_reliability`, `gold_accuracy` |
| Pitch figures (4) | done | unassigned | 2026-11-14 | `plots/pitch_1..4_*.png` |
| Method write-up | done, 2 sections pending | unassigned | 2026-11-14 | `HARMONIZATION_APPROACH.md` |
| Publish to R2 and live site | **blocked** | unassigned | 2026-11-14 | needs web changes first (G-11); not uploaded |
| Web app changes (regions, units, flags, accuracy panel) | not started | unassigned | 2026-11-14 | list in `MVP_LOG.md` |
| Build runs in a fresh Codespace | not started | unassigned | 2026-11-14 | depends on local DuckDB (G-12) |
| Terra bridge 2000-11 to 2002-06 | not started | unassigned | 2026-11-14 | out of MVP (D-2) |

## 2. MVP scope

- **Area:** Argentina whole, plus five boxes: north-east, north-west, centre, Patagonia, Paraná Delta (`gold/README.md`).
- **Period:** 2003-01 to the latest month (2026-11, incomplete), month by month (`data/14_build_gold.txt`: 287 months, 109 modelled, 174 observed, 4 provisional).
- **Quantity:** fire detections, day+night, fire filter (`is_vegetation_fire AND confidence_class <> 'low'`), in VIIRS-equivalent units.
- **Method:** measured VIIRS from 2012-02 (Suomi NPP to 2018-03, NOAA-20 after); Aqua × one factor per calendar month for 2003-01 to 2012-01; no MODIS conversion after 2022. See [HARMONIZATION_APPROACH.md](HARMONIZATION_APPROACH.md) §5.
- **Data products:** six app tables (no analogs), plus `gold_reliability`, `gold_accuracy` and the 0.1° cell table (`gold/README.md`).
- **Honesty built in:** per-month `method`, `coverage`, `likely range` (about 85% chance of containing the truth on held-out years), `reliability` flag, provisional marker, two anomaly baselines.
- **Accuracy on held-out years 2020–2022** (fit 2012–2019): median monthly error 9.5%, 90th percentile 19.0%, worst annual 8.9%, bias −7.2%, likely-range coverage 86%, five-class anomaly agreement 89% at country level (`data/14_build_gold.txt`, `data/13_mvp_checks.txt`).
- **In-sample only:** anomaly agreement 96% (country), 85% (zone), 71% (2° block) was measured on the fit years 2012–2019 (`findings_log.md` §3). Not held out; labelled as such in `gold_accuracy`.

## 3. Decisions log

| ID | Date | Decision | Alternatives | Why | Evidence |
|---|---|---|---|---|---|
| D-1 | 2026-11-14 | Argentina only; code stays region-parameterised | Global; several countries | MVP size; method validated on one country | `docs/new_prompt.md`; `common.py` REGION |
| D-2 | 2026-11-14 | Calendar starts 2003-01; Terra-only months and Aqua start-up (2000-11 to 2002-06) excluded | Include Terra via direct factor | Keeps MVP simple; Terra band is wider (LOYO sd 0.186 vs 0.116) | `findings_log.md` §5; `docs/new_prompt.md` |
| D-3 | 2026-11 (investigation) | Harmonize detection counts | FRP; active cell-days | Lowest residual (0.095), slope 0.99, 96% agreement at country scale; FRP and cell-days worse | `findings_log.md` §3 |
| D-4 | 2026-11 | Unit = VIIRS-equivalent counts; `*_cell_days` column names kept but hold counts | Rename columns now | Avoid breaking the app mid-build; rename later | `gold/README.md`; MVP_LOG front-end item 1 |
| D-5 | 2026-11 | One factor per calendar month for the country | One global factor; zone × month; day/night factors | Halves global-factor error (9.5% vs 16.5%); zones and day/night add nothing | `findings_log.md` §5, §5 post-hoc |
| D-6 | 2026-11-14 | Day+night is default | Day only | Day-only median 8.7% vs 9.5%, but worse p90 (21.5% vs 19.0%) and annual (9.5% vs 8.9%) | `data/13_mvp_checks.txt` |
| D-7 | 2026-11 | Do not convert MODIS after 2022 | Convert while possible | Aqua/Terra drift gives errors from −25% to +35% on 2022–2025 | `findings_log.md` §5a, §5 |
| D-8 | 2026-11-14 | Fit factors on 2012–2019 | 2012–2022 (as `recommendation.md` proposed) | KPIs then describe the factors in use; 2020–2022 stay held out | `14_build_gold.py`; supersedes `recommendation.md` "final fit years" |
| D-9 | 2026-11-14 | Two anomaly baselines: harmonized 2003–2022 (default) and observed VIIRS 2012–2025 | One baseline | Open question in `recommendation.md`; both stored, app toggles | `gold/README.md` |
| D-10 | 2026-11-14 | Call the band a "likely range" (about 85%): the LOYO 95% band | Nominal 80% or 95% | 80% covered 67%/64%, 95% covered 86% on unseen years; not tuned further | `findings_log.md` §5; `data/14_build_gold.txt` |
| D-11 | 2026-11-14 | Reliability flags by Aqua count of the area-month: ≥5,000 reliable; 1,000–4,999 good; 50–999 caution; <50 indicative only (half-width ≤30/40/65%) | Other cut-offs | Match the LOYO range table; thresholds are our choice, not a standard | `14_build_gold.py` FLAGS; `gold/gold_reliability.parquet` |
| D-12 | 2026-11-14 | Observed VIIRS months always `reliable`; flags apply only to modelled months | Flag by area size always | The size problem is a MODIS-conversion problem | `docs/new_prompt.md` |
| D-13 | 2026-11-14 | Browser map cells are 1° (0.1° kept server-side) | 0.5°, 0.25°, 0.1° | 0.5° JSON is 37 MB; 1° is 15 MB (0.55 MB gzipped) | `gold/README.md`; MVP_LOG run 3 |
| D-14 | 2026-11-14 | No gas-flare mask | Vaca Muerta mask; persistent-cell mask | Vaca Muerta changes factors 1.7% (max 3.2%) and test error not at all; persistent mask drops 31% of VIIRS, mixed results | `data/13_mvp_checks.txt` |
| D-15 | 2026-11-14 | No `gold_region_analogs` table | Build analog years | Analogs are not part of the validated method; not invented | MVP_LOG Step 0 |
| D-16 | 2026-11-14 | Jan 2012 modelled from Aqua | Use Suomi NPP | Suomi covers 12 of 31 days; rule needs ≥50% valid days | `14_build_gold.py` MIN_VIIRS_COVERAGE |
| D-17 | 2026-11-14 | Insufficient-data months are blank, never zero | Report 0 | When Aqua = 0, VIIRS saw fire in 96% of block-months | `findings_log.md` §5; `data/14_build_gold.txt` |
| D-18 | 2026-11-14 | Gap days: scale by valid days, record `coverage`; current month not scaled to full | Treat as zero | Missing days are missing data | `findings_log.md` §4f |
| D-19 | 2026-11-14 | Anomaly classes use the app's ratio thresholds (0.5/0.8/1.2/1.8) | Percentile classes | Keeps the app's colour logic | `scripts/build_sample_gold.py` |
| D-20 | 2026-11-14 | Regions: reuse the four validated zones plus a Delta box | Provinces; ecoregions | No polygon data in repo; zones are the validated level | `07_build_daily.py`; `gold/README.md` |

## 4. Known gaps

Severity is our judgement. "Open" unless marked.

| ID | What is missing | Why it matters | Sev. | What would resolve it |
|---|---|---|---|---|
| G-1 | No data 2000-11 to 2002-12 | The calendar loses 2.2 years | low | Build the Terra bridge, wider band (D-2) |
| G-2 | Small-area values before 2012 are unreliable | Under 50 Aqua detections the range is wider than a factor of 2 (`findings_log.md` §5) | high | Cannot be fixed by modelling; warn users, push to larger areas |
| G-3 | Slow, unexplained drift in the ratio (bias +10% in 2016 to −6% in 2022) | Pre-2012 values may carry a 5–10% level error not fully in the range | medium | Test whether bias tracks fire-season severity (`recommendation.md` next step 2) |
| G-4 | Likely range only 86% on unseen years | Users may read "likely" as more than it is | medium | More held-out years; keep the wording |
| G-5 | October 2026 is the lowest October in 24 years (0.19× median) | Looks real (Aqua, Terra, NOAA-20 agree) but data is NRT | medium | Wait for SP data; rerun. *Unverified in repo: cross-check was ad hoc* (MVP_LOG run 5) |
| G-6 | Insufficient-data months counted as 0 in annual totals (Patagonia, Delta) | Understates those years | low | Exclude them and flag the year; `months_insufficient` column exists |
| G-7 | Held-out error per calendar month rests on 3 months | `holdout_mape` is noisy | low | Use LOYO over 2012–2022 per month |
| G-8 | MODIS version change (6.2 → 6.03 → 61.03) not checked against FIRMS docs | Could be a real algorithm step | medium | Read FIRMS release notes (`findings_log.md` §4a) |
| G-9 | Possible unflagged gas flares (Vaca Muerta, 1,021 active days) | Slight VIIRS inflation in the west; effect under 3% | low | Extend the static-source mask |
| G-10 | Regions are rough boxes | Edges do not follow provinces or ecoregions | low | Province or ecoregion polygons |
| G-11 | Tables not published; the web app still lists the sample regions and says "cell-days" | Live pages would be empty with current `REGIONS` | **high** | Apply the front-end change list in `MVP_LOG.md`, then upload |
| G-12 | `14_build_gold.py` needs the local, gitignored `data/argentina.duckdb` | Not reproducible in a fresh Codespace without ~6 min of extraction | medium | Rerun 02 → 05 → 07 there, or publish the DuckDB or `cellday` to R2 |
| G-13 | `gold_accuracy` anomaly-agreement rows (96/85/71%) are in-sample | Flatters the method | medium | Recompute on held-out years at zone and block level; labelled meanwhile (resolved partly 2026-11-14: labels added) |
| G-14 | Map cells are 1° in the browser | Cannot draw fine polygons client-side | low | Server-side sum from the 0.1° table, or lazy-load tiles |
| G-15 | Suomi NPP data after 2025 is not loaded; NOAA-21 absent | No cross-check for NRT months | low | Load them (brief §3) |
| G-16 | Owners of deliverables are not recorded | Status table has "unassigned" | low | Team fills in |
| G-17 | Only Argentina is tested | The method may be Argentina-specific | medium | Rerun on a second region (`recommendation.md` next step 3) |

## 5. Open questions (need a human)

1. Which web-app changes go first, and who makes them (G-11)? Upload waits on this.
2. Is the 2003–2022 default anomaly baseline right, or should VIIRS-only (2012–2025) be the default? Both are stored (D-9).
3. Should the app show FRP as a secondary view? (`recommendation.md`)
4. Is the 2018 MODIS version label a real algorithm change? (G-8)
5. Should insufficient-data months be excluded from annual totals or flagged only (G-6)?
6. Rename `*_cell_days` columns to `*_count` now or after the first live release (D-4)?
7. Keep the "Partly sample" pill while analogs stay on sample data, or hide the analog panels?

## 6. Future scope

| Group | Item | Resolves |
|---|---|---|
| Accuracy | Test whether yearly bias tracks fire severity; two-term model only if it beats M1 on the same LOYO folds | G-3 |
| Accuracy | Extend the static-source mask for persistent non-agricultural cells | G-9 |
| Accuracy | Read FIRMS release notes on the MODIS versions | G-8 |
| Coverage | Terra bridge for 2000-11 to 2002-06 | G-1 |
| Coverage | Provinces or ecoregions for regions | G-10 |
| Coverage | NOAA-21 and Suomi NPP 2026 | G-15 |
| Coverage | Other countries | G-17 |
| Features | Server-side 0.1° polygon sums | G-14 |
| Features | FRP as secondary view; EONET reported events; hotspot CSV from silver | open question 3 |
| Validation | Held-out anomaly agreement at zone and block level | G-13 |
| Validation | Per-month LOYO error | G-7 |
| Validation | Replace NRT with SP months and recheck October 2026 | G-5 |
| Delivery | Web app changes, upload, Codespace-reproducible build | G-11, G-12 |

## 7. Change log (newest first)

- 2026-11-14: Rewrote this file as a living document (status, decisions, gaps, questions, future scope). Added `HARMONIZATION_APPROACH.md`.
- 2026-11-14: Found that the 96/85/71% anomaly-agreement figures are in-sample; `gold_accuracy` rows now carry their own `test_period` (G-13). Updated `gold/README.md`.
- 2026-11-14: Built gold tables, reliability and accuracy files, four figures (`14_build_gold.py`, `15_pitch_figures.py`); wrote `MVP_LOG.md` and `gold/README.md`.
- 2026-11-14: Ran flare-cell and day-only checks (`13_mvp_checks.py`): no mask; day+night stays.
- 2026-11-14: Extended `scripts/export_calendar.py` (new columns and tables, Argentina slice, `--local` mode).
- 2026-11 (earlier): Investigation completed and method chosen (`findings_log.md`, `recommendation.md`).
