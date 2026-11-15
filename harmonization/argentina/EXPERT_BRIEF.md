# Expert brief: harmonizing MODIS and VIIRS fire detections (Argentina MVP)

Single reference for technical questions about this project: the data, the harmonization method, how it was tested, what it cannot do, and what is still open. Built for team members answering judges and for the project chatbot. Status as of **2026-11-15**.

## 0. How to use this document

**Precedence.** This file consolidates the repo. If a number here disagrees with a gold table (`gold/*.parquet`, schema in [gold/README.md](gold/README.md)) or with the code (`14_build_gold.py`), the table or code wins, and the disagreement should be reported to the team. Older logs (`findings_log.md`, `recommendation.md`, `MVP_LOG.md`) are history.

**Evidence tags used below.**
- **[V]** verified in the repo or by a check run on 2026-11-15; the source file or command is given.
- **[U]** unverified: stated in a doc, or a plausible reading, but not checked.
- **[O]** open question or known gap; see section 9 and 10.

**Rules for answering.**
1. Say **fire detections** (satellite pixels flagged as fire). Never "number of fires" or "area burned".
2. A converted number is "what one VIIRS satellite would have counted", not ground truth.
3. Quote accuracy figures with their scope: whole country, monthly, held-out years 2020 to 2022.
4. If the answer is not here, say so. Do not invent a number, date, place or source.
5. Give the likely range as "about 85% likely", never "95% confidence".

## 1. The project in one minute

Satellites have flagged fire pixels in Argentina since 2000 with two cameras. The older one, MODIS (about 1 km pixels), sees fewer small fires than the newer one, VIIRS (about 375 m pixels, from 2012). Joined end to end, Argentina's record jumps about 3.7 times in 2012 for no reason on the ground **[V]** (45,740 detections in 2011, 167,274 in 2012; `verify_app_data.py`).

We built one consistent monthly record for Argentina, January 2003 to today, in **VIIRS-equivalent detections**. From February 2012 it is the VIIRS count itself. Before that it is the MODIS Aqua count multiplied by one fixed factor per calendar month, measured while both cameras flew (2012 to 2019). We tested it on years it had never seen (2020 to 2022): half of the converted months were within 9.5% of the VIIRS measurement, nine in ten within 19%, and the calendar colour class matched in 89% of months (whole country) **[V]** `gold_accuracy`.

It is only tested in Argentina, only against VIIRS (not against the ground), and it is weaker for small areas and for any single month before 2012.

### Ten numbers
| # | Number | Meaning | Source |
|---|---|---|---|
| 1 | 4.0 to 6.7 | VIIRS detections per Aqua detection by calendar month (lowest July, highest February) | `gold_calibration` |
| 2 | ×3.66 | raw jump 2011 to 2012 (45,740 to 167,274) | `verify_app_data.py` |
| 3 | ×0.83 | harmonized 2011 to 2012 (224,264 to 185,087); a real drop, Aqua itself fell 18% | `verify_app_data.py`; `data/annual_counts.csv` |
| 4 | 9.5% | median monthly error, held-out 2020 to 2022, whole country | `gold_accuracy` |
| 5 | 19.0% | 90th percentile monthly error, same test | `gold_accuracy` |
| 6 | 8.9% | worst annual error, same test | `gold_accuracy` |
| 7 | −7.2% | average bias (conversion runs low) | `gold_accuracy` |
| 8 | −20.9% / +23.2% | likely range, one converted month, whole country; held in 86% of test months | `gold_accuracy`, `14_build_gold.py` |
| 9 | 89% | converted and measured month got the same colour class (whole country, held-out) | `gold_accuracy` |
| 10 | 50 | below 50 Aqua detections in an area-month a converted value is only indicative | `gold_reliability` |

Also: 287 months shown (109 converted, 174 measured, 4 provisional) **[V]** `data/14_build_gold.txt`. 47 automatic checks pass **[V]**.

## 2. Data

**Source.** NASA FIRMS active-fire detections (public). We cleaned all satellites into one "silver" table (about 569 million rows worldwide) with identical columns **[V]** `findings_log.md` §0. For Argentina we extracted every row labelled Argentina or inside the box lat −56 to −21, lon −74.5 to −53: 12.5 million rows, of which 6.45 million are labelled Argentina **[V]**. No Argentina-labelled row falls outside the box, and 98 to 100% of labels come directly from FIRMS **[V]**. Border cells can contain detections labelled with a neighbouring country (384 of 21,886 Argentina 0.1° cells); that splitting is FIRMS's per-pixel label **[V]**.

**Satellites and instruments** **[V]** (`findings_log.md` §0, §5a; `docs/harmonization_data_brief.md` §2)
| Satellite | Instrument | Pixel | Argentina data from | Overpass (local solar time) |
|---|---|---|---|---|
| Terra | MODIS | about 1 km (median 1.3 km along the scan) | Oct 2000 | day 10.2 h until 2021, then earlier: 8.65 h in 2026 |
| Aqua | MODIS | same | Jul 2002 | day 13.9 h until 2022, then later: 15.8 h in 2026 |
| Suomi NPP | VIIRS | about 375 m (median 0.44 km) | 20 Jan 2012 | about 13.8 h, stable |
| NOAA-20 | VIIRS | same | 1 Apr 2018 | about 13.8 h, stable |

NOAA-21 (VIIRS, from 2023) exists but is not loaded. MODIS science is planned to end around 2027, so the record is expressed in VIIRS units **[U]** (dates from the project brief, not re-checked).
Our Suomi NPP data ends 2025-12-31 in the local database **[V]**; the brief says new Suomi NPP data stopped 2 Nov 2026 **[O]** (G-15).

**What counts as a detection.** Vegetation fires only (FIRMS type 0: not volcanoes, flares, industry or offshore) and confidence not "low". Standard filter `is_vegetation_fire AND confidence_class <> 'low'` **[V]**. Confidence is not the same scale: MODIS is numeric 0 to 100 (low below 30, nominal 30 to 79, high 80 and over), VIIRS is categorical l/n/h **[V]**.

| Satellite | rows (SP) | not vegetation | low confidence | kept |
|---|---|---|---|---|
| Aqua | 1,073,228 | 1.28% | 4.19% | 94.71% |
| Terra | 652,921 | 2.96% | 5.77% | 91.86% |
| Suomi NPP | 2,889,092 | 3.07% | 8.73% | 88.28% |
| NOAA-20 | 1,780,616 | 3.37% | 9.18% | 87.55% |

The filter removes about 12% of VIIRS but about 5% of Aqua, so it alone moves the VIIRS to Aqua count ratio by about 7%. The factor must be fitted with the same filter as production, and it is **[V]**.

**Day and night.** Aqua is 7.5% night detections, VIIRS about 27%, although the two cross at almost the same night time (about 01:15 and 01:05). VIIRS is far more sensitive to small, cool fires in the dark **[V]**.

**Local date.** All daily counts use the local solar date: UTC plus longitude/15 hours **[V]** (`docs/harmonization_data_brief.md` §4).

**Science quality (SP) versus near real time (NRT).** NRT is released within hours and replaced by refined SP data months later. In our data NOAA-20 is NRT from 2026-08-01; Aqua is NRT from 2026-09-01 and Terra from 2026-08-31 (MODIS NRT months are not used in the record) **[V]** `data/argentina.duckdb` (`cellday`).

**Valid days and gaps.** A satellite-day is flagged when FIRMS has no rows at all that UTC date, or fewer than 20% of the 31-day rolling median of the global daily count **[V]** (`05_build_local.py`). A flagged UTC date `d` removes local dates `d` and `d−1` **[V]** (`07_build_daily.py`). 158 satellite-days are flagged in all; the largest groups are Suomi NPP 2024 (19 missing, 4 low), Aqua 2022 (16), Suomi NPP 2022 (15), Terra 2001 (17), Terra 2022 (12), Terra 2016 (9), NOAA-20 2023 (5) **[V]** (`findings_log.md` §5a). A missing day is missing data, never zero fire.

**Local build tables** (`data/argentina.duckdb`, not in git): `cellday` (satellite × quality × local date × day/night × 0.1° cell, with fire-filtered count `n`, FRP, pixel area, edge-of-swath count; 2,528,926 rows), `valid`, `daily` and `daily_blk` (daily sums by zone or 2° block), `gaps` **[V]**.

## 3. Why the two cameras differ (the physics behind the factor)

1. **Pixel size and sensitivity.** A VIIRS pixel has about 1/7 the area of a MODIS pixel. A small fire fills part of a VIIRS pixel but disappears inside a MODIS pixel. A large fire lights many VIIRS pixels but few MODIS pixels. So the count ratio depends on the fire-size mix, which depends on season and place **[V]**.
2. **Season.** Argentina's VIIRS/Aqua count ratio is about 4.2 in July and August (peak burning, large fires, pixel-size effect smallest) up to 6.7 to 6.8 from November to February (small agricultural burns that VIIRS sees and MODIS often misses) **[V]** (`findings_log.md` §2). For one calendar month the year-to-year spread of log(ratio) is small (sd 0.07 to 0.18), which is why a month factor works **[V]**.
3. **Day versus night.** Night ratio about 20, day ratio about 4 **[V]**.
4. **Region.** Pooled ratio 2012 to 2022: north-east 5.14, north-west 4.96, centre 5.65, south 6.22. At 2° blocks (about 200 km) it ranges from 2.2 to 25 **[V]**.
5. **Overpass time and orbit drift.** Fires follow a daily cycle that peaks in mid-afternoon. Aqua's day pass: 13.85 to 13.95 h through 2022, then 14.17 (2023), 14.53 (2024), 15.05 (2025), 15.79 (2026); night 1.2 to 1.3 h rising to 2.97 h. Terra: 10.2 to 10.3 h to 2021, then 10.03, 9.84, 9.53, 9.11 (2025), 8.65 (2026). Suomi NPP and NOAA-20 are stable **[V]** (`04_coverage.py`). After 2022 MODIS is no longer a stable measuring stick: day and night counts drift in opposite directions, so day+night totals look steadier than they are (N20/Aqua day ratio 3.8 to 4.3 in 2019 to 2022, 3.41 in 2024, 3.60 in 2025; night 18 to 23, then 28 in 2025 and 42 in 2026) **[V]**.
6. **View angle.** Pixels grow toward the swath edge and lose sensitivity. 22 to 23% of MODIS fire detections have scan above 2 km, 8 to 9% of VIIRS above 0.6 km. Not used in the method **[V]**/[O].
7. **Confidence semantics** differ (above), so the confidence filter affects the two cameras differently.
8. **Static sources.** VIIRS detects more flares and industrial heat. Removed by the vegetation filter; some unflagged flares remain (section 9).
9. **Clouds** hide fires from both cameras at different times of day. Not modelled **[O]**.
10. **Two satellites of the same camera agree.** Suomi NPP / NOAA-20 count ratio on matched days is 1.025 (1.026 day, 1.020 night) for 2019 to 2025 **[V]**. Never add satellites: two satellites mean twice the passes.

## 4. Harmonization: the techniques

### 4.1 Why not align rows
A MODIS pixel and a VIIRS pixel are different measurements of different footprints. No column mapping makes them equal. Comparability exists only after aggregation (area × time) and calibration (sensor-to-sensor scaling) **[V]** (`docs/desired_output.md`).

### 4.2 What we harmonize
**Count of fire detections, day plus night, per calendar month, in VIIRS-equivalent units**: "the number of fire pixels one VIIRS satellite would have seen". Chosen before looking at 2020 to 2025.

### 4.3 Which quantity: counts, FRP or cell-days (selection period 2012 to 2019 only) **[V]** (`data/09_quantities.txt`)
Compared on Suomi NPP versus Aqua, calendar-month factor, whole country, day+night:
| Quantity | residual sd of log ratio (lower is better) | log-log slope (1 = plain scale factor) | class agreement Aqua vs VIIRS (in sample) |
|---|---|---|---|
| **Detection count** | **0.095** | **0.991** | 95.8% |
| Total FRP | 0.173 | 0.866 | 83.3% |
| Active 0.1° cell-days | 0.136 | 0.847 | 85.4% |
| Active 0.25° cell-days | 0.132 | 0.814 | 79.2% |

At zone level counts also win (0.217 vs 0.305 FRP, 0.256 cell-days). At 2° blocks cell-days has a slightly lower residual (0.498 vs 0.552) but no quantity converts well (13% of block-months have Aqua zero while VIIRS is positive).
- **FRP** (heat output) totals are similar between cameras (ratio about 1.0 annually; SNPP/Aqua 0.90 to 1.09) but convert worse month to month, and MODIS totals are dominated by a few huge pixels (the largest Aqua detection is a median 2.1% of the monthly FRP, p90 5%, versus 0.4% for VIIRS).
- **Cell-days saturate**: in big months VIIRS adds fewer new cells per Aqua cell, so a constant factor overestimates extremes.
- The project brief suggested FRP or cell-days might calibrate better; in Argentina they did not.
- The 96/85/71% agreement figures are **in sample** (fit years) and are not quoted as accuracy.

### 4.4 The method (M1, "calendar-month ratio")
For calendar month *m* (1 to 12):

**k_m = Σ V(y, m) ÷ Σ A(y, m)**, summed over the eight fit years y = 2012 to 2019, using only local dates valid for **both** Suomi NPP (V) and Aqua (A), whole country, fire-filtered, day+night **[V]** (`14_build_gold.py` `factors`).

| Month | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k | 6.53 | 6.67 | 6.18 | 5.52 | 4.70 | 4.13 | 4.00 | 4.16 | 5.00 | 5.56 | 6.20 | 6.59 |

(`gold_calibration`; `verify_app_data.py` recomputes them from `cellday` to within 0.0001.)

**Applying it.** For each 0.1° cell and month in a converted month: **H = Aqua count × (days in month ÷ valid Aqua days) × k_m**. Cells are summed to regions, the country or a drawn area, so all views add up **[V]**. Measured months use H = VIIRS count × (days ÷ valid days) with no factor. Regions and drawn areas use the **same country factor**, not their own.

### 4.5 Assembling the series **[V]** (`14_build_gold.py` section 4; `gold/README.md`)
| Months | Value | `method` |
|---|---|---|
| 2003-01 to 2012-01 | Aqua × k_m (Jan 2012 included) | `modelled_aqua` |
| 2012-02 to 2018-03 | Suomi NPP, measured | `observed_viirs` |
| 2018-04 to 2026-07 | NOAA-20, measured (SP) | `observed_viirs` |
| 2026-08 on | NOAA-20, near real time | `provisional_nrt` |
| converted month with Aqua = 0 in the area | blank, not zero | `insufficient_data` |

- **Rule for choosing VIIRS:** a month is measured only if VIIRS has at least 50% valid days; otherwise it is converted from Aqua. This is why January 2012 is converted (Suomi NPP covers 12 of 31 days) **[V]**.
- **Suomi NPP to NOAA-20 in April 2018** needs no correction: ratio 1.025 on matched days, and the Suomi-trained factors also predict NOAA-20 (held-out 2020 to 2022: bias −5.6%, median error 9.1%) **[V]**.
- **Gap days:** scaled by days ÷ valid days; `coverage` is the valid share. The month in progress is not scaled to a full month, is flagged incomplete and gets no comparison.
- **Why Aqua and not Terra for 2003 to 2011:** Aqua is the steadier, larger reference (about 3 million detections a year worldwide versus Terra's roughly half). Terra-only months (Nov 2000 to Jun 2002) are excluded (section 4.9).
- **Why VIIRS rather than MODIS units:** VIIRS continues; MODIS is ending.
- **Why no MODIS conversion after 2022:** see 4.8.

### 4.6 Anomalies and ranks **[V]**
- **Usual** = median of the same calendar month over complete harmonized months 2003 to 2022 (default), or over measured VIIRS months 2012 to 2025 (alternative baseline). Both stored.
- **Compared with usual** = month ÷ usual. Classes: below 0.5 much below; 0.5 to 0.8 below; 0.8 to 1.2 normal; 1.2 to 1.8 above; over 1.8 much above.
- **Rank** = 1 + number of years that were busier, among complete, non-provisional years with an estimate; **percentile** = share of those years at or below. Usually 24 years (2003 to 2026) for months that are complete in 2026, 23 otherwise.
- **Provisional rule:** NRT months and the month in progress show the value only; ratio, class, rank and percentile are null (D-21). Years with a no-estimate month are partial: no rank, no anomaly (D-22).
- Ratios above 10 display as "more than 10×"; exact values are in the CSV. The classes use the app's existing thresholds (D-19).
- **Season start, midpoint, end** = the months where 10%, 50% and 90% of the year's total is reached.

### 4.7 Uncertainty: the likely range **[V]** (`11_method_test.py`, `14_build_gold.py`)
1. **Leave-one-year-out (LOYO).** For each year 2012 to 2022, fit factors on the other ten years and predict the held-out year from Aqua. Monthly log-error sd = 0.116.
2. **Band.** The 95% interval of actual ÷ predicted is 0.791 to 1.232 (equivalently −20.9% / +23.2% around a converted value). The 80% interval is 0.859 to 1.148 on predicted/actual.
3. **Honest coverage.** On unseen years the 80% interval contained the truth only 67% (2020 to 2022) and 64% (2023 to 2025) of the time; the 95% interval contained it 86% of the time in both. Errors within a year are correlated, and a month-by-month calculation ignores that. We did not widen it further (it would be tuning to the test years) and **call it "likely range, about 85%"**.
4. **Annual band.** Largest LOYO yearly errors give 0.918 to 1.081 (about −8.2% / +8.1%).
5. **Size of the area.** Applying the factors to zones and 2° blocks, error grows as the Aqua count falls. Likely range (low/high) by Aqua detections in the area-month:

| Aqua detections | likely range | 80% range | flag |
|---|---|---|---|
| 5,000 or more | −12% / +25% | −10% / +17% | reliable |
| 1,000 to 4,999 | −23% / +38% | −15% / +17% | good |
| 200 to 999 | −32% / +52% | −23% / +24% | caution |
| 50 to 199 | −48% / +62% | −35% / +30% | caution |
| 20 to 49 | −82% / +82% | −49% / +35% | indicative only |
| 5 to 19 | −83% / +169% | −65% / +71% | indicative only |
| fewer than 5 | −85% / +626% | −71% / +225% | indicative only |

   Flag rule on the half-width of the likely range: up to 30% reliable, up to 40% good, up to 65% caution, above that indicative only. These cut-offs are our choice, not a standard (D-11). Measured months are always reliable (D-12). The whole-country converted months use the country band and are all "reliable".
6. **When Aqua saw nothing.** In 2,871 block-months Aqua was zero; VIIRS was positive in 2,752 (96%), median 3, 90th percentile 13 detections. A factor cannot recover that, so the month is blank (D-17).
7. **Areas.** The browser sums 1° cells and picks the size bin from raw Aqua counts (not coverage-scaled, G-22).

### 4.8 Why MODIS is not converted after 2022 **[V]**
Applying the 2012-to-2019 factors to unseen 2023 to 2025 gives an average bias near zero (−0.7%) **only because opposite errors cancel**: about −10% to −25% in 2022 and 2023, then +10% to +35% in 2024 and 2025 as Aqua's pass moves later. Median monthly error stays about 9.2% and the 90th percentile 24.3%. 2026 MODIS NRT cannot be separated from drift (for example N20/Aqua ratio in January 2026 8.9 vs 6.2 in 2019 to 2022). Since VIIRS has measured every month since February 2012, no MODIS conversion is needed after January 2012 at all.

### 4.9 Not built: the Terra bridge (Nov 2000 to Jun 2002) **[V]** (`findings_log.md` §5)
A direct Terra→VIIRS month factor beat the chain Terra→Aqua→VIIRS on 2020 to 2021 (bias −4.8% vs −5.8%, rmse_log 0.127 vs 0.141). Terra's factor is strongly seasonal (6.4 in December to 16.0 in June; SNPP/Terra: Jan 7.05, Feb 7.64, Mar 9.21, Apr 10.62, May 12.15, Jun 16.00, Jul 15.17, Aug 9.84, Sep 8.32, Oct 8.21, Nov 6.71, Dec 6.38), plausibly because Terra crosses at about 10:15 before the afternoon fire peak **[U]** (not verified beyond the overpass hours). Its LOYO sd is 0.186 (vs 0.116 for Aqua). The calendar therefore starts in 2003. Terra-only months also have low-coverage issues (Jun 2001 47% valid days, Mar 2002 68%, Dec 2003 71%; Aqua Jul to Aug 2002 77 to 81%).

### 4.10 Alternatives tried and rejected **[V]**
| Alternative | Result | Decision |
|---|---|---|
| One global factor (M0) | held-out 2020 to 22: bias −13.3%, median error 16.5%, p90 37%, worst year 17.9% | rejected |
| **One factor per month (M1)** | bias −7.2%, median 9.5%, p90 19.0%, worst year 8.9%, rmse_log 0.135 | **chosen** |
| Zone × month (M2) | median 9.3%, p90 20.3%, rmse_log 0.138; zone results mixed (north-east and south median error lower, centre slightly higher, biases differ); no gain at country level | rejected |
| Separate day and night factors | median 6.5% but bias −8.0%, rmse_log 0.142 (vs 0.135), night factors unstable (13 to 46) | rejected; **a close call, see section 9** |
| Day-only | median 8.7% but p90 21.5% and worst year 9.5% | day+night stays |
| Mask Vaca Muerta flares | factors change 1.7% mean, 3.2% max; test error unchanged (median 9.4%) | no mask |
| Mask all persistent cells (200+ active days) | removes 31% of VIIRS (mostly real farm fires); median 8.3% but p90 20.6%, worst year 10.2% | rejected |
| Fit 2012 to 2022 instead of 2012 to 2019 | factors shift −5% (April) to +10% (November); would use all test years | rejected so the accuracy figures stay a real test (D-8) |
| Flexible or machine-learning model | not tried; where it fails (small areas, Aqua zero, drift) the information is missing from MODIS, so extra MODIS features would not fix it | not pursued **[O]** |

### 4.11 Worked examples
**September 2010, whole country (converted).** Aqua counted 7,895 filtered detections, all days valid. September factor 5.004 = 272,111 (Suomi NPP) ÷ 54,377 (Aqua) over 2012 to 2019 matched days. Harmonized = 7,895 × 5.004 = **39,508**. Likely range −20.9%/+23.2% = **31,233 to 48,664**. Usual September (median 2003 to 2022) is 40,113; ratio 0.985, "normal" **[V]**.
**Paraná Delta, April 2008 (converted, small box).** Aqua 2,766 × 5.518 = **15,263** detections; usual April in that box is a median 94.6, so 161.3×, rank 1 of 24 Aprils. Shown as "more than 10×" **[V]**.
**Measured month: September 2020, whole country.** NOAA-20 67,328 on 30 of 30 valid days: 67,328; rank 5 of 23, 1.68× usual **[V]**.
**Gap-scaled: July 2023.** NOAA-20 6,221 × 31/26 valid days = 7,417 **[V]**.

## 5. Regions, cells and the app's data model

**Regions** (rough latitude-longitude boxes on 0.1° cells; not provinces) **[V]** (`gold/README.md`): `argentina` (everything FIRMS labels Argentina), `ar_ne` (lat > −35, lon > −60.5), `ar_nw` (lat > −30, lon ≤ −60.5), `ar_c` (−39 < lat ≤ −30, not NE), `ar_s` (lat ≤ −39), `ar_delta` (Paraná Delta box, lat −34.5 to −32.1, lon −61.0 to −58.4; mostly inside `ar_ne`, its western strip is in `ar_c`). The four zones add up to the country (max difference 0.2 detections, `verify_app_data.py`).

**Gold tables** (Parquet in R2 `gold/`, JSON in `publish/`, read through `/api/gold/<table>`): `gold_region_monthly` (1,722 rows; region × month), `gold_region_annual` (144), `gold_cell_monthly` (54,760; 1° cells), `gold_cell_monthly_01deg` (549,849; server-side, not exported), `gold_reliability` (7), `gold_accuracy` (8), `gold_calibration` (12), `gold_region_headline` (6). `gold_region_analogs` is **not produced** (analog years are not part of the validated method). Columns named `*_cell_days` hold detection counts (kept for app compatibility, D-4) **[V]**.

**Why 1° cells in the browser:** 0.5° would be 37 MB of JSON; 1° is 15 MB (0.5 MB gzipped) (D-13). Drawn shapes sum the 1° cells whose centre is inside the shape; a shape smaller than a cell uses the cell it sits in.

**Unit in code:** `raw_count × (1/coverage) × k` per 0.1° cell (`cm01h` in `14_build_gold.py`), so the 0.1° table sums exactly to the country month (max difference 0.05) **[V]**.

## 6. Verification evidence **[V]** (`scripts/verify_app_data.py`, 47 checks; run 2026-11-15)
- Recomputed from `cellday` with independent SQL: all 12 factors (max difference 0.00005) and 8 region-months (converted Sep 2010 and Jan 2012; Suomi NPP Feb 2015; NOAA-20 Sep 2020; low-coverage Jul 2023; provisional Sep 2026; Delta Apr 2008; Patagonia Jul 2005) plus one map cell. All matched to 0.1.
- Internal consistency: zones add to the country; cells add to the country; years add to months; baseline medians, ratios, classes, ranks, percentiles, flags and likely ranges recomputed for all 1,722 region-months.
- Planting two errors in a copy turned 7 checks to FAIL, so the checks catch errors.
- The data served by the production site read back identical to the local files except two tie-ranked months (Patagonia: March 2010 and 2011 both 185.4, or June 2005 and 2011 both 53.6; the rank differs by one). On 2026-11-15 37 checks (without the raw recompute) passed on downloaded production data **[V]**.

**Known events rank where expected** (`gold_region_monthly`; also the leave-one-year-out table in `findings_log.md` §4e):
| Event | Value | Usual | Result |
|---|---|---|---|
| Paraná Delta, Apr 2008 | 15,263 | 94.6 | 161.3×, 1st of 24 |
| Paraná Delta, Aug 2020 | 13,698 | 476.4 | 28.8×, 1st of 23 |
| Centre (Córdoba), Aug / Sep / Oct 2020 | 9,787 / 12,172 / 8,908 | 4,969 / 4,904 / 2,913 | 1.97× / 2.48× / 3.06×; ranks 1, 1, 2 |
| North-east (Corrientes), Jan / Feb 2022 | 37,082 / 30,647 | 2,575 / 3,850 | 14.4× / 8.0×; 1st, 1st of 24 |
| Argentina Aug / Sep / Oct 2020 | 102,254 / 67,328 / 49,974 | 44,738 / 40,113 / 23,999 | 2.29× / 1.68× / 2.08×; ranks 1, 5, 1 |
| 2020 annual | 390,960 | | 1st of 23 complete years |

All four satellites rank these months first (Sep 2020 is 4th or 5th in MODIS, 1st in VIIRS) **[V]** (`findings_log.md` §4e). 23 region-months exceed 10× (21 are in the Delta box) **[V]**.

## 7. October 2026 **[V]** (`16_october_check.py`, `data/16_october_check.txt`)
October 2026 (provisional, NOAA-20): 4,453 detections against a usual October of 23,999, which is 0.19×; the lowest of 24 Octobers (the previous lowest was 7,580). Valid days are 31 of 31 for Aqua, Terra and NOAA-20, and detections per valid day are below every earlier October on all three (Aqua 30.8 vs past minimum 45.4, median 130.3; Terra 16.4 vs 31.1 and 93.0; NOAA-20 143.6 vs 262.3 and 561.1). September 2026, also NRT, is above September 2025, so NRT data is not low across the board. **Verdict: a real low on provisional data**; a processing effect specific to NRT October data cannot be ruled out. The app shows the value without colour, ratio or rank.

## 8. Operations (state on 2026-11-15)
- **Production** `https://kubranauts-hotspots.pages.dev` (branch `main`), **preview** `https://dev.kubranauts-hotspots.pages.dev` (branch `dev`). Cloudflare Pages; the Worker `functions/api/gold/[table].js` reads `publish/<table>.json` through the R2 binding `FIRMS`; browsers only call same-origin `/api/gold/...` **[V]**.
- The demo story is four pages: The problem, Fire calendar, Draw an area, How accurate is it? A teammate later changed the home page and nav (the map is the home page, "Draw an area" opens the map with drawing tools, a chatbot page `chat.html` exists). **[U]** I have not reviewed how the new map page computes flags, ranks or ranges; the numbers in this brief come from the gold tables, not from that page.
- **Chatbot** (`functions/api/chat.js`) uses `web/chat_context.txt` as its system prompt and three lookup tools (`get_month`, `get_year`, `top_months`) on `publish/chat_lookup.json` **[V]** (file headers). `chat_context.txt` is an earlier summary; this brief is longer and takes precedence.
- **Twilio** sending (`functions/api/notify.js`) is off unless `TWILIO_LIVE` is "true" and a recipient list is set; the page never sees phone numbers **[V]** (file header).
- Publishing: `14_build_gold.py --upload`, then `scripts/export_calendar.py` (`--via-duckdb` where boto3 fails TLS). After any data change run `scripts/verify_app_data.py`.

## 9. Known gaps and limitations (with the honest answer)
| ID | Gap | Size / evidence | Honest answer |
|---|---|---|---|
| G-1 | No data 2000-11 to 2002-12 | 2.2 years | Terra bridge tested but not built (section 4.9) |
| G-2 | Small-area values before 2012 are unreliable | under 50 Aqua detections, range wider than ±80% | cannot be fixed by modelling; flagged in the app; from 2012 values are measured |
| G-3 | Slow drift in the ratio | LOYO yearly bias +8 to +10% (2015 to 2016) to −4 to −6% (2020 to 2022) | cause unknown (fire regime, processing, chance); pre-2012 level could carry a 5 to 10% error only partly covered by the range |
| G-4 | Likely range holds only 86% on unseen years | 36 test months | wording is "about 85%", not 95% |
| G-5 | October 2026 is a record low on provisional data | section 7 | rerun the check when science-quality data replaces NRT |
| G-7 | Held-out error per calendar month rests on 3 months | `holdout_mape` in `gold_calibration` **[V]** | noisy. Mean absolute % error by month: Jan 14.3, Feb 7.5, Mar 9.3, Apr 10.8, May 6.8, Jun 12.5, Jul 10.7, Aug 10.0, Sep 3.1, Oct 6.0, Nov 17.0, Dec 12.0. Largest in November and January, smallest in September. `HARMONIZATION_APPROACH.md` §8 says the error is largest in April to June; the table does not support that |
| G-8 | MODIS version labels change: 6.2 (to 2017), 6.03 (2018 to 2022), 61.03 (2023 to 2025), 6.1NRT (2026 NRT) | ratio 6.6% higher in 2018 to 2022 than 2012 to 2017, but no step at 2018 itself (2018 −1.1%, 2019 +3.0%) | not checked against FIRMS documentation; open |
| G-9 | Possible unflagged gas flares in the west | Vaca Muerta cell active 1,021 days labelled vegetation | tested: factors change under 3%; no mask |
| G-10 | Regions are rough boxes | | not provinces or ecoregions |
| G-13 | Zone and block anomaly agreement exist only in sample | held-out agreement known only for the whole country (89%) | |
| G-15 | Suomi NPP after 2025 not loaded; NOAA-21 absent | | no cross-check for the 2026 NRT months |
| G-17 | Only Argentina tested | | method may be Argentina-specific |
| G-22 | Draw page picks the size bin from raw (not coverage-scaled) Aqua counts | a bin can differ by one step in a gappy month | low |
| G-28 | **Double count on flagged gap days** | NOAA-20 Feb 2024 +10.4%, Jul 2023 +6.3%, Sep 2023 +5.9%; Aqua May 2003 +4.5%, Mar 2003 +2.5%; Suomi NPP Mar 2012 +0.7% **[V]** | detections on flagged days are summed and the month is also scaled up for those days, so those days count twice; method fix needs a decision and a rebuild; stated, not changed |
| G-29 | Exact ties order by floating-point noise | Patagonia Mar 2010 and 2011 (both 185.4); Jun 2005 and 2011 (both 53.6) **[V]** | ranks can differ by one between rebuilds |
| G-30 | Ratios rounded to 3 decimals | e.g. 0.4996 | display now reads "just under 0.50×" |

**Limitations the audience should hear (not in the G list):**
- **Zone-level accuracy is worse than the country figure** **[V]** (`data/11_method_test.txt`). Held-out 2020 to 2022 with M1: north-east bias −7.4%, median error 13.8%; north-west −4.1%, 8.4%; centre −18.2%, 16.1%; south (Patagonia) −12.4%, 21.3%. The 9.5% and 89% figures are whole-country only.
- Accuracy is measured against VIIRS, which is a different measuring instrument, not ground truth. We have not compared to burned-area maps or field reports **[O]**.
- Detection counts are not area burned or number of fires.
- Held-out period is only 3 years (36 months) and 2020 and 2022 were extreme fire years; 2020 to 2022 is also the period just before drift.
- Terra and Aqua are single satellites with orbit drift; MODIS 2023 on is unusable for calibration.
- Cloud, view angle and bow-tie duplicates in MODIS are not modelled. MODIS bow-tie overlap duplicates were not tested **[O]**.
- No trend analysis was done; the record starts in 2003.

## 10. Open questions (for the team) and what would resolve them
| # | Question | Evidence so far | What would resolve it |
|---|---|---|---|
| 1 | Default anomaly baseline: harmonized 2003 to 2022, or measured VIIRS 2012 to 2025? | both stored; the app toggles (D-9) | team decision; a VIIRS-only baseline is purer but has only 14 years |
| 2 | Should detections on flagged gap days be dropped before scaling? | G-28 | rebuild and recheck (`verify_app_data.py`), republish |
| 3 | Is the 2018 MODIS version change real? | G-8 | read FIRMS release notes |
| 4 | Should day and night get separate factors? | day+night median error 9.5% (bias −7.2%, rmse 0.135); split median 6.5% (bias −8.0%, rmse 0.142); night factors 13 to 46, unstable | more held-out years; a night-only stability test |
| 5 | Should FRP be shown as a second view? | counts calibrate better; FRP needs little scaling (about 1.0×) | a product decision |
| 6 | Why does the VIIRS/Aqua ratio drift (+10% to −6%)? | not explained | test whether yearly bias tracks fire-season severity; two-term model only if it beats M1 on the same leave-one-year-out folds |
| 7 | Does the method hold in another region or country? | Argentina only | rerun the pipeline on a second region |
| 8 | Can Terra extend the record to 2000? | direct factor tested; wider band | build with its wider range |
| 9 | Do province or ecoregion polygons change the answers? | rough boxes only | polygon data |
| 10 | Rename `*_cell_days` columns to `*_count`? | cosmetic | build, export list and JS changed together |
| 11 | Does the 2012 to 2019 fit generalize to 2003 to 2011? | assumed, not testable (no VIIRS before 2012) | no direct test exists; indirect checks only (events, seasonality) |
| 12 | Should the VIIRS reference after 2018 use NOAA-21 too? | not loaded | load NOAA-21 and Suomi NPP 2026 |
| 13 | How much of the 2026 NRT low is real? | section 7 | rerun when SP data arrives |
| 14 | Build runs only with a local, gitignored DuckDB (G-12) | 6 minutes to rebuild | publish the DuckDB or rebuild in the Codespace |

## 11. Likely technical questions and answers
**Method**
- *Why a ratio and not a regression or machine learning?* The relation is close to a plain scale factor (log-log slope 0.99 for counts) with a stable month-to-month pattern. A twelve-number ratio is easy to explain, easy to audit and needs no extrapolation beyond the fit range. More flexible models were not tried because the failures (small areas, zero Aqua, drift) are missing information, not model form **[V]/[O]**.
- *Why per calendar month?* Because fire size and the VIIRS/Aqua ratio vary by season (4.0 in July, 6.7 in February). It halved the error of a single factor (16.5% to 9.5%) **[V]**.
- *Why fit on only 2012 to 2019?* Aqua's pass time was stable until 2022; 2020 to 2022 were held out so the accuracy figures are a real test (D-8). Using 2012 to 2022 would shift the factors by −5% to +10% **[V]**.
- *Why not use 2012 to 2022 for the final factors now that the test is done?* They were fitted before the test; refitting would make the reported errors describe different factors than the ones used. A refit is a team decision **[O]**.
- *Why one factor for the whole country and not per region?* A zone-by-month factor (M2) did not improve the country fit (median 9.3% vs 9.5%) and the zone results were mixed **[V]**. Zones use the country factor, so zone errors are larger (section 9).
- *Why day and night together?* Separate factors lowered the median error but raised bias and rmse, and the night factors vary from 13 to 46 **[V]**/[O].
- *Why counts and not FRP?* Counts leave less unexplained spread (0.095 vs 0.173) and scale in a straight line (slope 0.99 vs 0.87). FRP's total looks similar across cameras but converts worse **[V]**.
- *How are missing days handled?* As missing data: month scaled by days/valid days, coverage shown. G-28 describes an overstatement of up to about 10% in a few months **[V]**.
- *Why no uncertainty from a model?* The band is empirical, from leave-one-year-out prediction errors, widened by the size of the area. It is not a statistical confidence interval **[V]**.
- *Why "about 85%" and not 95%?* The nominal 95% interval covered 86% on unseen years, so we say what we measured **[V]**.
- *Is Suomi NPP to NOAA-20 a seam?* No: ratio 1.025 on matched days, and the factors predict NOAA-20 as well as Suomi NPP **[V]**.
- *What about Terra?* Not used for 2003 onward; Aqua is the reference. Terra-only 2000 to mid 2002 is excluded **[V]**.

**Validation**
- *Tested on what?* Factors fitted on 2012 to 2019, then used to predict 2020 to 2022 from Aqua (36 months) and compared with measured Suomi NPP/NOAA-20 totals. Also 2023 to 2025 (drift) and leave-one-year-out 2012 to 2022 **[V]**.
- *Is 9.5% "the accuracy"?* It is the median monthly error for the whole country. The 90th percentile is 19%, worst year 8.9%, and areas are worse **[V]**.
- *Why does it run 7% low?* The ratio drifts slowly (+8 to +10% in 2015 to 2016, −4 to −6% in 2020 to 2022); eight fit years cannot pin it down. The bias is stated, not hidden **[V]**.
- *Can you validate pre-2012?* No. There is no VIIRS before 2012. We assume the relation holds; the known events (April 2008, August to October 2020, January to February 2022) rank at the top in all satellites, which is a consistency check, not a proof **[V]**.
- *Do you compare with any independent data?* Not yet (burned area, field reports) **[O]**.

**Data**
- *Why does VIIRS see more?* Smaller pixels and higher sensitivity, especially at night **[V]**.
- *Which fires are removed?* FIRMS-typed non-vegetation sources and low-confidence detections; some flares may remain **[V]**.
- *What is provisional data?* Near real time; replaced by science-quality data months later; values can change **[V]**.
- *What about double counting two overpasses?* We count detections per pass and never add satellites; the unit is "one VIIRS satellite's count" **[V]**.
- *How do you handle the date line, time zones?* Local solar date = UTC + longitude/15 hours **[V]**.

**Interpretation**
- *Is 2012 a real drop?* Harmonized 2011 to 2012 is ×0.83; Aqua alone fell 18% and Terra 23% that year, so 2012 was a quieter year **[V]**.
- *Why is a small Delta box 161× normal?* Its usual April is only about 95 detections; the safer headline is "busiest April in 24 years" **[V]**.
- *Why October 2026 is low?* Section 7.
- *What happens in small areas?* Wide likely range and flags; if Aqua saw nothing, no estimate, not zero **[V]**.
- *Can this be used for trends?* Not yet claimed. No trend test was done **[V]**.

## 12. What we can and cannot claim
**Can say:** one monthly record, 2003 to today, in one unit, for Argentina; converted months come with a tested likely range; measured months are measured; on unseen years half the months were within 9.5% and the colour class matched 89% of the time (whole country); known events come out as record months; provisional months are not compared.
**Do not say:** "number of fires" or "area burned"; "accurate to 9.5%" without scope; "95% confidence"; "96%, 85% or 71% agreement" (in sample); "validated against the ground"; "works anywhere" or "global"; "October 2026 is a record low" as a final fact; "fires are rising or falling since 2000"; "calibrated per biome" (it is one factor per calendar month for the country); "the Paraná Delta region is the Delta" (it is a box).

## 13. Where each number comes from
| Item | File | Command to reproduce |
|---|---|---|
| Factors, test errors, intervals | `11_method_test.py` → `data/11_method_test.txt`; `14_build_gold.py` → `data/14_build_gold.txt` | `cd harmonization/argentina && python -u 14_build_gold.py` |
| Quantity comparison | `09_quantities.py` → `data/09_quantities.txt` | `python -u 09_quantities.py` |
| Flare and day-only checks | `13_mvp_checks.py` → `data/13_mvp_checks.txt` | |
| Day/night factor test | `12_posthoc_daynight.py` → `data/12_posthoc_daynight.txt` | |
| Overpass drift, versions, gaps | `04_coverage.py` → `data/04_coverage.txt` | |
| October 2026 | `16_october_check.py` → `data/16_october_check.txt` | |
| Published tables | `gold/*.parquet`; JSON via `scripts/export_calendar.py` | |
| 47 checks | `scripts/verify_app_data.py` | `python scripts/verify_app_data.py [--url <site>]` |
| Decisions and gaps (D-, G-) | `SCOPE_AND_GAPS.md` | |
| Method in plain English | `HARMONIZATION_APPROACH.md` | |

## 14. Glossary
**Detection / hotspot:** one flagged pixel at one overpass. **FIRMS:** NASA's active-fire data service. **MODIS / VIIRS:** the older and newer cameras. **Harmonized / VIIRS-equivalent:** the count one VIIRS satellite would have reported. **Factor (k):** the calendar-month multiplier from Aqua to VIIRS. **Measured / converted / provisional:** VIIRS count / Aqua × factor / near-real-time VIIRS. **Held-out years:** 2020 to 2022, kept out of the fit. **LOYO:** leave-one-year-out. **Likely range:** the empirical interval that held about 85% of the time on unseen years. **Reliability flag:** reliable / good / caution / indicative only, from the Aqua count in the area-month. **Coverage:** share of days with valid satellite data. **Usual:** median of the same calendar month over the baseline years. **SP / NRT:** science-quality / near-real-time data. **Drift:** the slow change in a satellite's overpass time. **In sample:** measured on the data the method was fitted to.
