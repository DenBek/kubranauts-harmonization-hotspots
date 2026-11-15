# Findings log: Argentina MODIS / VIIRS comparability

Running log. Each entry: what, result, where it came from (script + output file under `data/`).
Scripts run from `harmonization/argentina/` with `../../venv/Scripts/python.exe -u <script>`.
Standard fire filter unless noted: `is_vegetation_fire AND confidence_class <> 'low'` ("fire filter").
Prior team notes (`exploration/jack_v1/eda_summary.md`, `docs/desired_output.md`, project brief) were NOT used to steer; cross-check is in section X at the end.

## 0. Profile (01_profile.py, 03_profile_local.py → data/01_profile.txt, data/03_profile_local.txt)

- Silver: 52 files under `silver/detections/source=*/year=*/{archive,sp,nrt}.parquet`, 27 columns, ~569M rows. MODIS 2000–2026, Suomi NPP 2012–2025 (no 2026), NOAA-20 2018-04–2026. NOAA-21 absent. Per-file row counts in `data/01_profile.txt`.
- Argentina extract (`02_extract.py`): every row with `country='Argentina'` OR inside bbox lat −56..−21, lon −74.5..−53 → `data/extract/*.parquet` (187 MB, 12.5M rows; 6.45M are Argentina). One scan of silver took ~6 min.
- **Country label is reliable**: 0 Argentina rows fall outside the bbox. Argentina rows are 98–100% `country_source='file'` (FIRMS) for 2000–2025; 2026 API rows use our 0.1° lookup (NOAA-20 2026: 95k lookup rows). 384 of 21,886 Argentina 0.1° cells also contain detections labelled another country (border cells, 285k detections) — the label is per-pixel, so border splitting is FIRMS's, not ours.
- Nulls: none except `type_reported` in NRT rows (expected; `type_final` filled by lookup).
- Bad values (tiny): Suomi NPP has `frp` down to −1.52 and `bright_main` = 0 in a few rows; frp ≤ 0 in 153 (Aqua), 111 (Terra), 953 (N20), 1325 (SNPP) rows. Negligible.
- Exact duplicates (same satellite, time, lat, lon): 2 SNPP, 1 N20 rows. Negligible. (MODIS bow-tie overlap duplicates are not exact duplicates — not tested.)
- **Semantics differ by sensor:**
  - confidence: MODIS numeric 0–100 binned to low <30, nominal 30–79, high ≥80; VIIRS categorical l/n/h. Not the same scale.
  - pixel size: MODIS scan 1.0–4.8 km (median 1.3), VIIRS 0.32–0.80 km (median 0.44). Pixel area ratio at nadir ≈ 7×.
  - FRP per detection (veg): Aqua mean 59.6 MW, Terra 47.4, VIIRS 13.0 (median 22 vs 5.5).
- **MODIS `version` changes by year** in the files: 6.2 for 2000–2017, 6.03 for 2018–2022, 61.03 for 2023–2025 (6.1NRT for 2026 NRT). VIIRS is "2" throughout. Possible processing steps at 2018 and 2023 — open question whether these are real algorithm changes or only labelling of the FIRMS archive vintages (see section 4).

### Filters per satellite (Argentina, SP only)

| satellite | rows | non-vegetation % | low-conf % | kept % | night % (all) |
|---|---|---|---|---|---|
| Aqua | 1,073,228 | 1.28 | 4.19 | 94.71 | 7.5 |
| Terra | 652,921 | 2.96 | 5.77 | 91.86 | 24.8 |
| Suomi NPP | 2,889,092 | 3.07 | 8.73 | 88.28 | 26.7 |
| NOAA-20 | 1,780,616 | 3.37 | 9.18 | 87.55 | 26.3 |

The fire filter removes ~12% of VIIRS but ~5% of Aqua → it alone shifts the VIIRS/Aqua count ratio by ~7%. Not wrong, but the ratio must be fitted with the same filter used in production.

**Surprise:** Aqua night share 7.5% vs VIIRS 27% even though Aqua and VIIRS cross at nearly the same night time (~01:15 vs ~01:05 local). VIIRS is far more sensitive at night (small/cool fires). Day and night ratios will differ a lot → treat separately or use day-only.

## 5a. Coverage, versions, overpass time (04_coverage.py → data/04_coverage.txt)

- **Orbit drift is in the data** (median local solar overpass, Argentina detections):
  - Aqua day 13.85–13.95 h for 2002–2022, then 14.17 (2023), 14.53 (2024), 15.05 (2025), 15.79 (2026). Night 1.2–1.3 h → 2.97 h.
  - Terra day 10.2–10.3 h for 2002–2021, 10.03 (2022), 9.84, 9.53, 9.11 (2025), 8.65 (2026).
  - Suomi NPP / NOAA-20: stable 13.8 h day, 1.05 h night all years.
  - Consequence: Aqua is a stable reference only up to ~2022. Calibrating against 2023+ Aqua mixes in drift.
- **Missing days** (no rows globally on a UTC date; also "low" = <20% of 31-day rolling median): table `gaps` in `data/argentina.duckdb` (158 days). Largest: Suomi NPP 2024 19 missing + 4 low, Suomi NPP 2022 15, Aqua 2022 16, Terra 2001 17, Terra 2022 12, Aqua 2002 10 (start-up), Terra 2016 9, NOAA-20 2023 5. These are missing data, not zero fires; pairwise comparisons below drop such dates for both satellites.

## 1. The problem (06_problem.py → plots/01_problem_series.png, data/annual_counts.csv)

Annual Argentina fire counts (fire filter, D+N): Aqua 21k–75k/yr; Terra about half of Aqua; Suomi NPP and NOAA-20 108k–401k/yr.

- The naive stitched series (Terra → Aqua Jul 2002 → Suomi NPP 2012 → NOAA-20 Apr 2018) jumps from 45.7k (2011) to 169k (2012), ~3.7×, with no reason on the ground. It also has a smaller step in Jul 2002 (Aqua sees ~1.8× Terra). Any "record year" or trend over 2000–2026 is dominated by these steps.
- Monthly series (log plot): all four satellites share the same seasonal shape and the same big events (2020, 2022, Aug–Sep peaks); VIIRS sits ~5× above Aqua, Terra ~half below Aqua. Shapes track closely, so the problem looks mostly like a scale factor — section 2 tests how constant it is.
- Annual count ratios: SNPP/Aqua 4.30–5.89 (2012–2025); N20/Aqua 4.44–5.82 (2019–2025); Aqua/Terra 1.54–1.92 until 2023, then 2.22 (2024), 2.45 (2025), 2.51 (2026) — drift of Terra (and Aqua).
- **Annual FRP ratios: SNPP/Aqua 0.90–1.09, N20/Aqua 0.89–1.07.** Total FRP is nearly the same for VIIRS and Aqua in Argentina (Aqua/Terra FRP 2.1–2.8 pre-drift).
- Suomi NPP vs NOAA-20 annual counts 2019–2025: 0.97–1.05 (2018 = 1.42 only because N20 starts in April). Near 1:1 → one VIIRS reference series can switch between them.

## 2. Relationship where sensors overlap (07_build_daily.py, 08_relationship.py → data/08_relationship.txt, plots/02–04)

Method: all pairwise numbers use only local dates valid for both satellites (gap days dropped for both). Zones are rough lat/lon boxes (NE Mesopotamia, NW Chaco/Andean north, C Pampas/Córdoba, S Patagonia), not ecoregions.

- **Pooled ratios (ratio of sums):**

| pair | years | D+N count | day count | night count | D+N FRP | D+N cell-days |
|---|---|---|---|---|---|---|
| SNPP / Aqua | 2012–2022 | 5.18 | 4.07 | 19.4 | 0.99 | 3.09 |
| N20 / Aqua | 2019–2022 | 5.25 | 4.15 | 19.7 | 1.03 | 3.14 |
| SNPP / Aqua | 2023–2025 (drift) | 4.93 | 3.74 | 21.9 | 0.95 | 3.04 |
| SNPP / N20 | 2019–2025 | 1.025 | 1.026 | 1.020 | 1.02 | 0.98 |
| Aqua / Terra | 2003–2021 | 1.79 | 2.17 | 0.56 | 2.33 | 1.70 |
| Aqua / Terra | 2022–2026 (drift) | 2.04 | 2.83 | 0.43 | 2.90 | 1.96 |

- **Season is the dominant structure.** Count ratio by calendar month (SNPP/Aqua, 2012–2022): ~4.2 in Jul–Aug (peak burning season, large fires) to 6.7–6.8 in Nov–Feb. Year-to-year sd of the log ratio within a calendar month is only 0.07–0.18. The heatmap (plots/02) shows the same low-ratio band in Jun–Sep every year. A calendar-month factor captures most of the variation.
- **Fire size / activity.** The monthly count ratio is higher when Aqua detections are more clustered (Aqua detections per cell-day; rank corr 0.37) and when Aqua FRP per detection is higher (0.48), and lower in high-activity months (−0.30). This is correlated with season, so the month factor absorbs much of it.
- **Region.** Pooled count ratio 2012–2022: NE 5.14, NW 4.96, C 5.65, S 6.22 (±12%); the FRP ratio varies more (NE 1.25, NW 0.88). At 2° blocks (≥200 Aqua detections, plots/05): p25–p75 4.4–5.9, extremes 2.2–25. High-ratio blocks are in the west (Neuquén/Mendoza), where VIIRS sees many small detections (see 4c, gas flares).
- **Day vs night.** Night ratio ~20 vs day ~4. Aqua sees few night fires (7% of its detections) while VIIRS sees many (27%) at nearly the same overpass time, so VIIRS is much more sensitive at night. Night ratios are noisy by month (13–46) and drift strongly (plots/04).
- **Drift breaks the relationship after 2022.** Day count ratio N20/Aqua 3.8–4.3 (2019–22) → 3.41 (2024), 3.60 (2025); night 18–23 → 28 (2025), 42 (2026). Day and night move in opposite directions, so D+N looks steadier than it really is. Aqua/Terra day 2.0–2.3 until 2023 → 3.0 (2024), 3.8 (2025), 4.75 (2026).
- **FRP looks comparable on totals but not in detail.** The annual FRP ratio is ~1.0, but monthly FRP ratios are noisier than counts (plots/02) and the log-log slope is below 1 (section 3). FRP totals are dominated by a few large detections, especially for MODIS: the single biggest Aqua detection is a median 2.1% of monthly Argentina FRP (p90 5%), vs 0.4% for VIIRS.
- **Cell-days saturate.** The log-log scatter (plots/03) has slope < 1 for cell-days: in big months VIIRS adds fewer new cells per Aqua cell, so a constant factor would over-predict extremes.
- Edge of swath: 22–23% of MODIS fire detections have scan > 2 km; 8–9% of VIIRS have scan > 0.6 km. Not used in the method; a possible feature later.

## 3. What to measure (09_quantities.py → data/09_quantities.txt). Selection period 2012–2019 ONLY

Candidates: detection count (n), total FRP, active 0.1° cell-days, active 0.25° cell-days; D+N and day-only; country, zone, 2° block. Metrics:
- resid sd: sd of the log ratio after a calendar-month factor (what a month factor cannot explain)
- slope: log-log slope with month intercepts (1 = pure scale)
- anomaly-class agreement: how often Aqua and SNPP put a month in the same class (below p25 / normal / above p75 of the same calendar month)

| level, D+N | quantity | resid sd | slope | anomaly-class agreement |
|---|---|---|---|---|
| country | **count** | **0.095** | **0.99** | **96%** |
| country | FRP | 0.173 | 0.87 | 83% |
| country | cell-days 0.1° | 0.136 | 0.85 | 85% |
| zone | **count** | **0.217** | **0.94** | **85%** |
| zone | FRP | 0.305 | 0.86 | 82% |
| zone | cell-days 0.1° | 0.256 | 0.84 | 81% |
| 2° block | count | 0.552 | 0.91 | 71% |
| 2° block | cell-days 0.1° | 0.498 | 0.83 | 69% |

Day-only gives almost the same numbers as D+N for counts (0.096 at country level).

**Decision (made before looking at 2020–2025):** harmonize the **detection count, day+night, per month**, with a **calendar-month factor**. Reasons: the smallest unexplained residual, slope ≈ 1 (a pure scale factor is justified), the best anomaly agreement, and the easiest to explain ("the number of fire pixels VIIRS would have seen"). FRP and cell-days are not rejected as displays, but they calibrate worse here. At 2° blocks no quantity converts well: 13% of block-months have Aqua = 0 while VIIRS > 0.

## 4. Data quality (10_quality.py → data/10_quality.txt, plots/05_maps.png)

a. **MODIS version labels** (6.2 → 6.03 in 2018 → 61.03 in 2023). The SNPP/Aqua day ratio is 6.6% higher in 2018–22 than in 2012–17 (year sd 0.035–0.07). LOYO yearly biases (section 5) show no step at 2018 itself (2018 −1.1%, 2019 +3.0%), so there is no clear evidence of an algorithm change. The 2023 label change coincides with the drift and cannot be separated from it. **Open question.**
b. **2026 / NRT.** N20/Aqua monthly count ratios in 2026 depart from the 2019–22 same-month ratios in both SP months (Jan 8.9 vs 6.2, Jun 7.2 vs 4.6) and NRT months (Oct 4.7 vs 5.7, Nov 4.8 vs 7.4). Aqua drift (overpass ~15.8 h) and NRT cannot be separated. 2026 MODIS cannot be used for calibration.
c. **Persistent cells.** 937 SNPP 0.1° cells were active on ≥200 days in 2012–2025 (30% of SNPP detections). Most are agricultural (e.g. the Tucumán sugarcane belt around −27.2, −65.4, which is also the top Aqua cell). But SNPP's top cell, −38.4, −69.0 (Neuquén, Vaca Muerta oil and gas), was active on 1,021 days labelled vegetation, and nearby cells look the same. These are **likely unflagged gas flares** that inflate the VIIRS/Aqua ratio in the west. Not removed; next step is to extend the static-source mask.
d. **Outliers / big days.** The largest single days are real events: Aug 2003 (Aqua 2,878), 10 Sep 2013 (SNPP 12,012), 30 Sep–1 Oct 2020 (SNPP 12,002, N20 11,247). No artefact spikes were found.
e. **Known events.** Apr 2008 (Paraná Delta), Aug and Oct 2020, and Jan–Feb 2022 rank #1 for their calendar month in every satellite (Sep 2020 is #4–5 in MODIS, #1 in VIIRS). The sensors agree on which months are exceptional.
f. **Coverage of the MODIS-only era.** Terra only from 2000-11 to 2002-06 (20 months). Low-coverage months: Terra Jun 2001 (47% valid days), Mar 2002 (68%), Dec 2003 (71%); Aqua Jul–Aug 2002 (77–81%). Production needs per-valid-day scaling and a coverage flag.
g. **Low-count units.** At zone level only Patagonia (S) has months with Aqua < 20 (27 of 132 months).
h. DuckDB 2.0 quirk (new): `years` and `months` (like `days`) cannot be used as column aliases. pandas: a column named `le` clashes with `DataFrame.le`.

## 5. Simplest method, honest test (11_method_test.py → data/11_method_test.txt, plots/06–07)

Prespecified: count, D+N, monthly; target = Suomi NPP; methods M0 (single ratio), M1 (calendar-month ratio, country), M2 (zone × month); fit 2012–2019; E1 test 2020–22 (unseen, pre-drift), E2 test 2023–25 (unseen, drift); E3 leave-one-year-out (LOYO) 2012–2022 for intervals.

Country level, monthly:

| method | test | bias | median abs error | RMSE (log) | 90th pct abs error | worst annual error |
|---|---|---|---|---|---|---|
| M0 | E1 2020–22 | −13.3% | 16.5% | 0.258 | 37% | 17.9% |
| **M1** | **E1 2020–22** | **−7.2%** | **9.5%** | **0.135** | **19%** | **8.9%** |
| M2 | E1 2020–22 | −7.8% | 9.3% | 0.138 | 20% | 8.9% |
| M1 | E2 2023–25 | −0.7% | 9.2% | 0.146 | 24% | 7.0% |
| M1 | in-sample 2012–19 | +0.6% | 5.2% | 0.096 | 16% | 6.3% |

- M1 halves M0's error. M2 (zone factors) adds nothing at country level and is mixed per zone (better in C and S, worse in NE). **Keep M1.**
- The same M1 factors predict **NOAA-20** just as well (E1: bias −5.6%, median abs error 9.1%). One factor set serves both VIIRS satellites.
- **Bias is not zero out of sample.** M1 under-predicts VIIRS by about 7% in 2020–22. LOYO yearly biases move from +8 to +10% (2015–16) to −4 to −6% (2020–22), so the ratio has a slow year-to-year component that 8 fit years cannot pin down. The E2 mean of −0.7% hides opposite errors: −10 to −25% in 2022–23, then +10 to +35% in 2024–25 as Aqua drifts later (plots/06). **Do not convert MODIS after 2022.**
- **Intervals.** The LOYO monthly log-error sd is 0.116 → 80% interval for actual/predicted 0.87–1.16, 95% interval 0.79–1.23. Out of sample they under-cover: the 80% interval covers 67% (E1) and 64% (E2); the 95% interval covers 86% in both. Errors are correlated within years, which monthly residuals ignore. **Honest band: show the LOYO 95% band (about −20% / +25% at country scale) and describe it as roughly 85% likely.** Not tuned further, to avoid fitting to the test years.
- **Uncertainty grows fast as areas shrink** (LOYO, M1 factors applied to zones and 2° blocks, by Aqua count in the area-month; 80% range of actual vs predicted):

| Aqua detections in area-month | 80% range |
|---|---|
| ≥ 5,000 | −10% / +17% |
| 1,000–5,000 | −15% / +17% |
| 200–1,000 | −23% / +24% |
| 50–200 | −35% / +30% |
| 20–49 | −49% / +35% |
| 5–19 | −66% / +71% |
| < 5 | −71% / +225% |

  When Aqua = 0 in a block-month, VIIRS saw fire in 96% of cases (median 3, p90 13 detections). Conversion cannot recover these. **Small areas and quiet months are fundamentally uncertain before 2012.**
- **Terra bridge (Nov 2000 – Jun 2002).** A direct SNPP/Terra month factor (fit 2012–19, test 2020–21) beats the chain Terra → Aqua (2003–11) → SNPP: bias −4.8% vs −5.8%, RMSE 0.127 vs 0.141. LOYO sd is 0.186 (vs 0.116 for Aqua), 80% interval 0.81–1.27. The Terra factor is very seasonal (6.4 in Dec to 16.0 in Jun), plausibly because Terra crosses at ~10:15, before the afternoon fire peak (open: not verified beyond the overpass hours). Use the direct factor with the wider Terra band.
- Post-hoc (not prespecified; 12_posthoc_daynight.py): separate day and night month factors (as the project brief proposes) do not help: E1 RMSE 0.142 vs 0.135, E2 0.151 vs 0.146. Night factors (13–46) are unstable.
- A more flexible model was not tried. M1 is adequate at country and zone scale (median error ~9%, annual within ~9%). Where it fails (small areas, Aqua = 0, drift), the information is not in the MODIS data, so extra MODIS-based features would not fix it.

## X. Cross-check against team notes (read only after sections 0–5)

Sources: `exploration/jack_v1/eda_summary.md` (global EDA), `docs/desired_output.md`, project brief. The `02_context_and_hypotheses.md` named in the task does not exist in the repo.

| Team claim | Argentina evidence | Verdict |
|---|---|---|
| Gap days (Terra 2001 17, Aqua 2022 16, SNPP 2022 15, 2024 19, N20 2023 5…) | Identical list found independently | Agrees |
| SNPP ≈ NOAA-20 near 1:1 | 1.025 for counts on matched days (dips in their annual figures are gaps) | Agrees |
| Terra and Aqua drift from ~2022 | Seen directly in overpass hours and ratios | Agrees. Their "global ratio holds across drift" holds for D+N totals only: day and night drift cancel |
| VIIRS/Aqua ~6 (global) | Argentina 5.2 pooled, 4.2–6.8 by month | Consistent; Argentina is lower than global |
| Brief: Argentina VIIRS/(Terra+Aqua) 2019 3.19, 2020 3.5 | N20/(Aqua+Terra) 3.09, 3.44 on our filtered data | Close |
| "FRP is more comparable than counts" | Ratio is near 1, but it calibrates worse than counts (resid sd 0.17 vs 0.10, slope 0.87) | **Contradicted** for harmonization; true only as "less scaling needed" |
| "Active cell-days likely calibrate much better" (desired_output.md) | Worse at country and zone (0.136 vs 0.095), saturating slope 0.85; marginally lower residual only at 2° blocks | **Contradicted** for Argentina |
| Terra-only years via Terra→Aqua (2003–11) then →VIIRS | Direct Terra→VIIRS slightly better | Minor revision |
| Country × month × day/night factors | Day/night split did not help | Revision: month factor, D+N |
| Fit 2012–2019, test 2020–2025 | Done; also shows conversion breaks after 2022 | Agrees, with the drift limit |
| VIIRS reference SNPP to 2018-03, N20 after | Works; the factor transfers to N20 | Agrees |
