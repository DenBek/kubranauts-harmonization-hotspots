# Scope and gaps: Argentina harmonized fire calendar

Living document. Single source of truth for what we deliver, what we do not, and what is open. Last updated **2026-11-15**.

**Order of authority when numbers disagree:** the gold tables and [gold/README.md](gold/README.md), then [HARMONIZATION_APPROACH.md](HARMONIZATION_APPROACH.md), then this file, then older logs (`findings_log.md`, `recommendation.md`, `MVP_LOG.md`).
Method and story: [HARMONIZATION_APPROACH.md](HARMONIZATION_APPROACH.md). Run log and front-end change list: [MVP_LOG.md](MVP_LOG.md).
Data schema: [gold/README.md](gold/README.md). Investigation: [findings_log.md](findings_log.md), [recommendation.md](recommendation.md).

**Rules.** Add a change-log line and update the status table after every task. Record decisions, gaps and questions as soon as
they appear. Never delete one; mark it resolved or superseded with a date and a pointer. Every claim cites its source; if it
cannot, it is marked *unverified*. Keep to about 300 lines.

## 1. Status snapshot

Owner = not recorded in the repo; "unassigned" until the team fills it in.

| Deliverable | Status | Owner | Updated | Note |
|---|---|---|---|---|
| Investigation and method (M1) | done | unassigned | 2026-11-14 | `findings_log.md`; superseded by `HARMONIZATION_APPROACH.md` |
| Flare-cell and day-only checks | done | unassigned | 2026-11-14 | `data/13_mvp_checks.txt`; D-6, D-14 |
| October 2026 check | done | unassigned | 2026-11-15 | `data/16_october_check.txt`: real low on provisional data (G-5) |
| Gold tables (Parquet) | done | unassigned | 2026-11-15 | `gold/*.parquet`; provisional and partial-year rules built in (D-21, D-22) |
| Reliability lookup and accuracy file | done | unassigned | 2026-11-15 | `gold_reliability`, `gold_accuracy` (held-out figures only) |
| Published to R2 (`gold/`, `publish/`) | done | unassigned | 2026-11-15 | via DuckDB (boto3 fails TLS here, G-18); analogs not published |
| Web: regions, API allowlist, nav, unit labels | done | unassigned | 2026-11-15 | `web/gold.js`, `functions/api/gold/[table].js`, `web/nav.js` |
| Web: The Problem, Regions, Draw an Area, How Accurate Is This? | done, checked locally | unassigned | 2026-11-15 | new pages; not yet deployed (G-11) |
| Pitch figures (4) | done | unassigned | 2026-11-14 | `plots/pitch_1..4_*.png` |
| Method write-up | done | unassigned | 2026-11-15 | `HARMONIZATION_APPROACH.md` |
| Deploy to Cloudflare Pages | preview only | unassigned | 2026-11-15 | `dev` preview live with R2 data; production still serves `main` (G-24) |
| Data verification script | done | unassigned | 2026-11-15 | `scripts/verify_app_data.py`: 47 PASS on local JSON and on the dev preview |
| Reading guide and pitch cheat sheet | done | unassigned | 2026-11-15 | `APP_READING_GUIDE.md`, `EXPLAIN_IT.md` |
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
- **Provisional rule:** provisional (NRT) months and the month in progress show the value, never an anomaly colour, ratio, rank or percentile (D-21).
- **App pages:** The Problem, Regions, Draw an Area, How Accurate Is This? (new), plus Map and Calendar (existing). Overview, Year and Briefing are hidden from the nav because they need the analogs table or SMS copy (D-23).

## 3. Decisions log

| ID | Date | Decision | Alternatives | Why | Evidence |
|---|---|---|---|---|---|
| D-1 | 2026-11-14 | Argentina only; code stays region-parameterised | Global; several countries | MVP size; method validated on one country | `docs/new_prompt.md`; `common.py` REGION |
| D-2 | 2026-11-14 | Calendar starts 2003-01; Terra-only months and Aqua start-up (2000-11 to 2002-06) excluded | Include Terra via direct factor | Keeps MVP simple; Terra band is wider (LOYO sd 0.186 vs 0.116) | `findings_log.md` §5; `docs/new_prompt.md` |
| D-3 | 2026-11 (investigation) | Harmonize detection counts | FRP; active cell-days | Lowest residual (0.095) and slope 0.99 at country scale; FRP and cell-days worse (agreement figures: findings log §3) | `findings_log.md` §3 |
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
| D-21 | 2026-11-15 | Provisional (NRT) and in-progress months: value only; anomaly, ratio, rank and percentile are null; `anomaly_status` column; front end draws a dashed "P" cell | Show anomaly with a warning | NRT data can be revised; holds whatever the October check says | `14_build_gold.py`; `gold/README.md`; `web/mvp.js` |
| D-22 | 2026-11-15 | Years with an insufficient-data month are partial: no rank, no anomaly, `is_partial` | Count the month as 0 | Consistent with D-17 | `gold/gold_region_annual.parquet` |
| D-23 | 2026-11-15 | Hide Overview, Year and Briefing from the nav (files kept) | Delete; rework | They depend on analogs (not produced) or SMS copy; pages not to be edited beyond breakage | `web/nav.js` |
| D-24 | 2026-11-15 | Quote only held-out anomaly agreement (89%, whole country, five classes); in-sample figures stay in the findings log and are removed from `gold_accuracy` | Show in-sample with a label | In-sample figures flatter the method | `gold_accuracy`; `web/accuracy.js` |
| D-25 | 2026-11-15 | Upload through DuckDB; `export_calendar.py --via-duckdb` | Disable TLS checks in boto3 | boto3 fails certificate verification on this network; nothing is switched off | `scripts/export_calendar.py`; `14_build_gold.py --upload` |
| D-26 | 2026-11-15 | New pages use the plain SVG approach and a shared `web/mvp.js`; headline view is year totals with months and cameras options | A chart library | No new frameworks | `web/mvp.js` |
| D-27 | 2026-11-15 | Draw page: cells whose centre is inside the shape; a shape smaller than a cell uses the cell it sits in | Reject small shapes | Honest flag rather than hidden | `web/draw.js` |

## 4. Known gaps

Severity is our judgement. "Open" unless marked.

| ID | What is missing | Why it matters | Sev. | What would resolve it |
|---|---|---|---|---|
| G-1 | No data 2000-11 to 2002-12 | The calendar loses 2.2 years | low | Build the Terra bridge, wider band (D-2) |
| G-2 | Small-area values before 2012 are unreliable | Under 50 Aqua detections the range is wider than a factor of 2 (`findings_log.md` §5) | high | Cannot be fixed by modelling; warn users, push to larger areas |
| G-3 | Slow, unexplained drift in the ratio (bias +10% in 2016 to −6% in 2022) | Pre-2012 values may carry a 5–10% level error not fully in the range | medium | Test whether bias tracks fire-season severity (`recommendation.md` next step 2) |
| G-4 | Likely range only 86% on unseen years | Users may read "likely" as more than it is | medium | More held-out years; keep the wording |
| G-5 | **Checked 2026-11-15.** October 2026 is the lowest October in 24 years (0.19× median) | Real low: all three satellites have 31 of 31 valid days and detections per valid day below every earlier October (`data/16_october_check.txt`). Still provisional NRT data | medium | Rerun `16_october_check.py` when SP data replaces NRT |
| G-6 | **Resolved 2026-11-15 (D-22).** Insufficient-data months were counted as 0 in annual totals | Understated those years | low | Done: partial years get `is_partial`, no rank, no anomaly |
| G-7 | Held-out error per calendar month rests on 3 months | `holdout_mape` is noisy | low | Use LOYO over 2012–2022 per month |
| G-8 | MODIS version change (6.2 → 6.03 → 61.03) not checked against FIRMS docs | Could be a real algorithm step | medium | Read FIRMS release notes (`findings_log.md` §4a) |
| G-9 | Possible unflagged gas flares (Vaca Muerta, 1,021 active days) | Slight VIIRS inflation in the west; effect under 3% | low | Extend the static-source mask |
| G-10 | Regions are rough boxes | Edges do not follow provinces or ecoregions | low | Province or ecoregion polygons |
| G-11 | Partly resolved 2026-11-15: tables are published and the web changes are made, but the site is not deployed | The live site shows the old pages (and, with the new tables in R2, the old regions find no rows) until the commit is pushed and Pages redeploys. The `FIRMS` binding must be on Production and Preview | **high** | Commit and push, then check the live pages |
| G-12 | `14_build_gold.py` needs the local, gitignored `data/argentina.duckdb` | Not reproducible in a fresh Codespace without ~6 min of extraction | medium | Rerun 02 → 05 → 07 there, or publish the DuckDB or `cellday` to R2 |
| G-13 | Zone and block anomaly agreement exist only in sample (`findings_log.md` §3). The in-sample rows were removed from `gold_accuracy` on 2026-11-15 | Held-out agreement is known only for the whole country (89%) | medium | Recompute on held-out years at zone and block level |
| G-14 | Map cells are 1° in the browser | Cannot draw fine polygons client-side | low | Server-side sum from the 0.1° table, or lazy-load tiles |
| G-15 | Suomi NPP data after 2025 is not loaded; NOAA-21 absent | No cross-check for NRT months | low | Load them (brief §3) |
| G-16 | Owners of deliverables are not recorded | Status table has "unassigned" | low | Team fills in |
| G-17 | Only Argentina is tested | The method may be Argentina-specific | medium | Rerun on a second region (`recommendation.md` next step 3) |
| G-18 | boto3 cannot verify TLS to R2 on the build machine | The default upload path fails | low | Use `--via-duckdb` (D-25); fix the certificate store |
| G-19 | The existing Map page's tooltip and CSV reference `modis_hotspots` and `viirs_hotspots`, trimmed from the JSON for size | Those fields show "none" on the Map page | low | Re-add the two columns to the cell export, or edit `map.js` |
| G-20 | The Worker falls back to old sample files for any table not in R2 (`gold_region_analogs`), and local `wrangler pages dev` has no R2 | Hidden pages and local previews can show old regions | low | Use `scripts/dev_server.py` for local real-data previews; retire `web/sample/` once analogs are decided |
| G-21 | Links to the two documents point at the `dev` branch on GitHub | 404 until the docs are pushed | low | Push; change `DOCS_BASE` in `web/mvp.js` after merging to main |
| G-22 | The Draw page picks the reliability bin from raw Aqua counts, not coverage-scaled; the cell JSON has no `coverage` | A bin can differ by one step in a month with many missing days | low | Add coverage to the cell export |
| G-23 | Visual checks were done in headless Edge only | No screen-reader or phone test | low | Test in browsers and on a phone |
| G-24 | Production `kubranauts-hotspots.pages.dev` serves `main` (old site): `/problem.html` falls back to the old Map, `/api/gold/gold_accuracy` answers "Unknown table." The new pages are live only on `dev.kubranauts-hotspots.pages.dev` (curl, 2026-11-15) | Judges given the production link see the old site | **high** | Merge `dev` into `main`, or share the preview link |
| G-25 | **Resolved 2026-11-15:** Region picker hidden on the Map page; labels read "Argentina total". Map page: the region picker does not filter cells (every region has `stratum_id = argentina`), so "Region total" for any sub-region is the whole country | Misleading total on the Map page | medium | Filter `web/map.js` cells by the region box, or hide the picker there |
| G-26 | **Resolved 2026-11-15:** Text now says one factor per calendar month for Argentina; Overview link removed. Map page cell text says the ratio is "for this biome and month" (it is per calendar month, whole country) and links to the hidden Overview page | Wrong statement on screen | low | Edit the two strings in `web/map.js` |
| G-27 | **Resolved 2026-11-15:** Calendar removed from the nav (page file kept; Regions replaces it); Map links to Regions. Old Calendar page: the no-estimate month (Paraná Delta 2005-06) is painted "normal" and labelled "Provisional"; converted months are not hatched; help text says VIIRS is "empty before April 2018" (it starts Feb 2012); "Text briefing" links to a hidden page | Contradicts the Regions page | medium | Fix `web/calendar.js`, or drop Calendar from the nav (Regions covers it) |
| G-28 | **Moved to Future Scope 2026-11-15; noted in `HARMONIZATION_APPROACH.md` §8 and `EXPLAIN_IT.md`.** **Method question, not changed.** Gap-day scaling sums detections on all days, including flagged gap days, then scales by days ÷ valid days, so flagged days count twice. Overstates six shown months: NOAA-20 2024-02 +10.4%, 2023-07 +6.3%, 2023-09 +5.9%; Aqua 2003-05 +4.5%, 2003-03 +2.5%; Suomi NPP 2012-03 +0.7% (query on `cellday` LEFT JOIN `valid`, 2026-11-15) | Small level error in a few months; inside the noise of D-18 but not stated | low | Team decides: sum valid days only before scaling (needs a rebuild and re-check) |
| G-29 | **Moved to Future Scope 2026-11-15.** Exact ties are ordered by floating-point noise (Patagonia March 2010 and 2011, both 185.4) | Rank can swap between rebuilds (seen once: local JSON vs R2) | low | Round before ranking, or rank ties as equal |
| G-30 | **Resolved 2026-11-15:** `formatRatio` shows "just under 0.50×" / "just over 1.20×" near a class boundary. Published ratios are rounded to 3 decimals: 0.4996 shows "0.50×" but is classed "much below" (Paraná Delta 2019-08) | Looks inconsistent to a careful reader | low | Display class from the rounded ratio, or show 2 significant decimals only |
| G-31 | **Resolved 2026-11-15:** README sentence fixed. `gold/README.md` says the Delta box is "inside `ar_ne`"; its western strip (lon −61.0 to −60.5) falls in `ar_c` | Doc inaccuracy | low | Fix the README sentence |
| G-32 | **Resolved 2026-11-15:** Draw note reworded. Draw page text says a small shape before 2012 is "flagged indicative only"; the flag follows the Aqua count of the whole cell and can be better | Wording overstates the rule | low | Reword in `web/draw.html` |

## 5. Open questions (need a human)

0. (New) Commit, push and deploy now? The live site stays on the old pages until then (G-11).

1. Which web-app changes go first, and who makes them (G-11)? Upload waits on this.
2. Is the 2003–2022 default anomaly baseline right, or should VIIRS-only (2012–2025) be the default? Both are stored (D-9).
3. Should the app show FRP as a secondary view? (`recommendation.md`)
4. Is the 2018 MODIS version label a real algorithm change? (G-8)
5. Should insufficient-data months be excluded from annual totals or flagged only (G-6)?
6. Rename `*_cell_days` columns to `*_count` now or after the first live release (D-4)?
7. Keep the "Partly sample" pill while analogs stay on sample data, or hide the analog panels?
8. (New 2026-11-15) Should detections on flagged gap days be dropped before scaling (G-28)? Method change; needs a decision. Now in Future Scope.

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
| Method | Drop detections on flagged gap days before scaling (about 10% overstatement in a few 2023-24 months; rebuild, recheck, republish) | G-28 |
| Delivery | Make tied months rank the same way every rebuild (round before ranking) | G-29 |
| Delivery | Web app changes, upload, Codespace-reproducible build | G-11, G-12 |

## 7. Change log (newest first)

- 2026-11-15: Demo polish, no data or method change: Calendar out of the nav; Map picker hidden and labels say Argentina; `formatRatio` near class boundaries; Draw and README wording; gap-day note added to `HARMONIZATION_APPROACH.md` and `EXPLAIN_IT.md`; G-28 and G-29 moved to Future Scope.
- 2026-11-15: Added `scripts/verify_app_data.py` (47 checks: raw recompute, internal consistency, events, boundaries, published figures; 47 PASS on local JSON and on the dev preview), `APP_READING_GUIDE.md` and `EXPLAIN_IT.md`. Found G-24 to G-32 (production serves old `main`; Map region filter; old Calendar markers; gap-day double count question; tie ranks; rounding display; two wording fixes). No data or method changed.

- 2026-11-15: Docs updated: section 7 of `HARMONIZATION_APPROACH.md` now describes the live pages; October 2026 verdict added (section 8); `recommendation.md` marked superseded; in-sample anomaly figures removed outside the findings log.
- 2026-11-15: Added four pages (`problem`, `regions`, `draw`, `accuracy`) with `mvp.js` and `mvp.css`; nav updated; Overview, Year and Briefing hidden. Existing pages: unit label "detections", "not ranked yet" for provisional months.
- 2026-11-15: Published `gold/*.parquet` and `publish/*.json` to R2 through DuckDB (analogs not published). Added `--via-duckdb` and `scripts/dev_server.py`.
- 2026-11-15: Provisional rule and partial-year rule built into the gold tables (D-21, D-22); `gold_accuracy` reduced to 8 held-out rows.
- 2026-11-15: October 2026 check saved (`16_october_check.py`): real low on provisional data (G-5).
- 2026-11-14: Rewrote this file as a living document (status, decisions, gaps, questions, future scope). Added `HARMONIZATION_APPROACH.md`.
- 2026-11-14: Found that the 96/85/71% anomaly-agreement figures are in-sample; `gold_accuracy` rows now carry their own `test_period` (G-13). Updated `gold/README.md`.
- 2026-11-14: Built gold tables, reliability and accuracy files, four figures (`14_build_gold.py`, `15_pitch_figures.py`); wrote `MVP_LOG.md` and `gold/README.md`.
- 2026-11-14: Ran flare-cell and day-only checks (`13_mvp_checks.py`): no mask; day+night stays.
- 2026-11-14: Extended `scripts/export_calendar.py` (new columns and tables, Argentina slice, `--local` mode).
- 2026-11 (earlier): Investigation completed and method chosen (`findings_log.md`, `recommendation.md`).
