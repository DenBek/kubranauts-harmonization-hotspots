# How to read the fire-calendar app (Argentina MVP)

For the team member who has to explain the app to judges. One section per page. Every number cites the file or check that
reproduces it; `verify` = `python scripts/verify_app_data.py` (see the end of this file).

**Which site?** The new pages are on the `dev` preview, **https://dev.kubranauts-hotspots.pages.dev**. The production address
`kubranauts-hotspots.pages.dev` serves the `main` branch, which still has the old site: `/problem.html` there opens the old Map,
and `/api/gold/gold_accuracy` returns "Unknown table." (checked 2026-11-15 with curl). Give judges the preview link until `dev`
is merged into `main`.

## Words used on every page

- **Detection**: one satellite pixel flagged as containing a fire, at one overpass. Not one fire: a big fire lights many pixels.
- **MODIS** (on the Terra and Aqua satellites, pixel about 1 km) and **VIIRS** (Suomi NPP, then NOAA-20, pixel about 375 m).
  VIIRS sees smaller fires, so it reports 4.0 to 6.7 times as many detections as Aqua for the same fires (`gold_calibration`).
- **Harmonized** or **VIIRS-equivalent**: the number of detections one VIIRS satellite would have counted. From February 2012
  this is the VIIRS count itself (**measured**). Before that it is the MODIS Aqua count × a **factor** for that calendar month
  (**converted**, `method = modelled_aqua`).
- **Factor**: VIIRS ÷ Aqua for one calendar month, measured on 2012–2019 when both flew. Twelve numbers, Jan..Dec:
  6.53 6.67 6.18 5.52 4.70 4.13 4.00 4.16 5.00 5.56 6.20 6.59 (`gold_calibration`; recomputed from raw by `verify`).
- **Usual** (baseline median): the middle value of the same calendar month over 2003–2022 (default), or over measured VIIRS
  months 2012–2025 (alternative toggle).
- **Compared with usual** (anomaly ratio): this month ÷ usual. Colour classes: below 0.5 much below, 0.5–0.8 below, 0.8–1.2
  normal, 1.2–1.8 above, over 1.8 much above.
- **Rank**: 1st = busiest of all complete, non-provisional years for that calendar month. **Percentile**: share of those years
  at or below this month.
- **Likely range**: for a converted month, the range with about an 85% chance of containing the true VIIRS value. It was
  tested on 2020–2022, years the factors never saw: it held in 86% of months (`gold_accuracy`).
- **Provisional** (NRT, near real time): VIIRS data released within hours, replaced by final science-quality (SP) data a few
  months later. In the app: August 2026 onwards.
- **Coverage**: share of days in the month with valid satellite data. Missing days are filled by scaling (count × days ÷ valid
  days), never treated as zero fire.

---

## 1. The Problem (`problem.html`)

**What you see.** A bar chart, one bar per year, Argentina only. Switch "Raw, joined end to end" / "Harmonized" and "Year
totals" / "Months" / "Cameras side by side". Three tiles at the top.
- Raw view: orange bars = counted by MODIS Aqua (2003–2011), blue = counted by VIIRS (2012 on). Dashed outline = 2026, in progress.
- Harmonized view: one colour. **Hatched** bars (2003–2011) = converted from MODIS, with **whiskers** = annual likely range.
  Plain bars = measured. 2012 is "mixed" (January converted, February on measured).
- Months view: a line; the hatched background = converted stretch, shaded band = monthly likely range, dotted end = provisional.
- Cameras view: raw Aqua and raw VIIRS on a log scale (each step up the axis is ×10). Nothing converted.

**Data.** `gold_region_monthly` (`raw_count`, `raw_satellite`, `harmonized_cell_days`, `harmonized_low/high`, `modis_cell_days`,
`viirs_cell_days`, `method`) and `gold_region_annual` (`harmonized_cell_days`, `harmonized_low/high`, `method`, `rank`).
Raw yearly bars are summed in the browser from `raw_count`. Note: columns named `*_cell_days` hold detection counts.

**Looks right.** Raw 2011 → 2012: ×3.66 (45,740 → 167,274). Harmonized 2011 → 2012: ×0.83 (224,264 → 185,087). Busiest complete
year 2020 with 390,960 (all from `verify`, "2012 seam" and "events"). In the cameras view the two lines rise and fall together,
VIIRS about 4–7× higher.
**Looks wrong.** A step at 2012 in the harmonized view; hatching or whiskers after 2012; 2026 shown as a solid, ranked bar.

**Judges will ask.**
- *"Harmonized 2012 is 17% below 2011. Is that the seam?"* No: MODIS Aqua alone fell 18% (45,740 → 37,330) and Terra 23% that
  year (`data/annual_counts.csv`), so 2012 was a quieter year on the ground.
- *"Why not just multiply everything by one number?"* One number gave a 16.5% typical monthly error on unseen years; one per
  calendar month gave 9.5% (`findings_log.md` §5, method M0 vs M1).
- *"Why start in 2003?"* Before mid-2002 only Terra flew; we did not build or test a Terra conversion (D-2).

## 2. Regions (`regions.html`)

**What you see.** Region chips (Argentina, North-east, North-west, Centre, Patagonia, Paraná Delta), a baseline toggle, and a
month × year calendar: columns are years, rows are months.
- Square colour = class against usual (blue quieter, ember busier). A vertical line marks "VIIRS measured from here" (2012).
- **Hatched** square = converted from MODIS. **"!"** = caution, **"?"** = indicative only (small counts), faded fill too.
- **Dashed square with "P"** = provisional or month in progress: value shown, no colour, ratio or rank (rule D-21).
- **"n/a"**, empty outline = no estimate (MODIS saw zero in that area-month; only Paraná Delta, June 2005).
- Side panel for the selected month: value, method badge, likely range and flag (converted months), "compared with usual",
  rank ("1st of 24 Aprils"), valid-day coverage. Below: monthly series, latest months, top 8 months and top 6 years, CSV.

**Data.** `gold_region_monthly` (value, method, `reliability`, `harmonized_low/high`, `anomaly_ratio`/`_class`,
`anomaly_ratio_viirs`/`_class_viirs`, `baseline_median`/`baseline_viirs_median`, `rank_in_month`, `percentile_rank`,
`n_years_ranked`, `anomaly_status`, `coverage`), `gold_region_annual` (top years), `gold_reliability` (flag advice text).
Region boxes: `gold/README.md` "Regions". They are rough lat/lon boxes, not provinces.

**Looks right.** The four zones add up to Argentina every month (`verify`: max difference 0.2). Paraná Delta April 2008:
15,263, "more than 10×" (exact 161.3×), 1st of 24 Aprils. North-east January and February 2022: 1st of 24. Argentina August and
October 2020: 1st of 23. August to November 2026: dashed P. Converted months for the whole of Argentina are all "reliable": they use the
country likely range (−20.9%/+23.2%), not the area-size table.
**Looks wrong.** Any coloured square from August 2026 on; a hatched square after January 2012; a "0" where the panel should
say "No estimate"; a rank on a provisional month.

**Judges will ask.**
- *"161 times normal? Really?"* The usual April in that box is small (median 94.6 detections), so the ratio explodes; the
  clearer statement is "busiest April in 24 years", and the app shows anything above 10× as "more than 10×" (exact value in the CSV).
- *"Why is the rank out of 23 in some months and 24 in others?"* Ranks use complete, non-provisional years 2003–2026; for
  August to December, 2026 is provisional or unfinished, so only 23 years count.
- *"Can I trust a hatched square in Patagonia?"* Only roughly: most Patagonian converted months are "indicative only" (67 of 109)
  because MODIS saw fewer than 50 detections there (`gold_region_monthly`, `reliability`).

## 3. Draw an Area (`draw.html`)

**What you see.** A map. Draw a rectangle or polygon, or type corners, or click an example. The app picks the 1° map cells
(about 100 km) whose **centre** is inside your shape (highlighted squares), adds them up, and shows the same calendar, side panel
and series as Regions. Four tiles: cells inside, detections in 2025, typical reliability before 2012, converted months by flag.

**Data.** `gold_cell_monthly` (1° cells: `harmonized_cell_days`, `modis_cell_days`, `method`) and `gold_reliability`. Everything
else is computed in the browser (`web/draw.js`): sum of cells; flag and likely range from the bin of the area's Aqua count;
usual = median of the same month 2003–2022 in your area; rank among your area's own months.

**Looks right.** The 1° cells add up to the Argentina month (`verify`: max difference 2, rounding). The "Paraná Delta" example
selects 9 cells and gives 15,307 for April 2008, close to the Regions box (15,263); the two differ because the example covers
whole 1° cells, a bit larger than the 0.1° box. Small shapes get "indicative only" or "caution" for most months before 2012.
**Looks wrong.** A shape over the sea or outside Argentina showing detections; a tiny shape flagged "reliable" before 2012
(possible only if its one cell had over 5,000 Aqua detections that month).

**Judges will ask.**
- *"Why 100 km cells? I drew a small field."* The browser table is 1° to stay small (0.5° would be 37 MB, D-13). Your shape uses
  the whole cell it sits in, and the flag says how much to trust it.
- *"Why is my small area so uncertain before 2012?"* With under 50 MODIS detections the likely range is wider than −80%/+80%
  (`gold_reliability`); the information is not in the MODIS data. From 2012 the values are measured and reliable at any size.

## 4. How Accurate Is This? (`accuracy.html`)

**What you see.** Tiles with held-out accuracy figures, a scatter of converted against measured months, a table of likely
range by the number of MODIS detections in the area-month, flag advice, and "works best / does not work" lists.

**Data.** `gold_accuracy` (8 rows, all scored on 2020–2022) and `gold_reliability` (7 rows). The scatter is the static image
`web/img/pitch_3*.png` made by `15_pitch_figures.py`.

**Looks right (`verify`, "contract").** Typical monthly error within 9.5%; 9 months in 10 within 19.0%; worst year 8.9%; average
bias −7.2% (conversion runs low); likely range held in 86% of test months; same colour class as measured in 89%; country
likely range −21% to +23%. Reliability bins: ≥5,000 reliable (−12/+25%) down to <5 indicative only (−85/+626%).
**Looks wrong.** Any figure labelled "in sample", or 96%/85%/71% agreement (those are fit-year figures, D-24).

**Judges will ask.**
- *"Tested on what?"* Factors fitted on 2012–2019 only, then used to predict 2020–2022 from MODIS and compared with what VIIRS
  measured. The method never saw those years.
- *"Why does the conversion run 7% low?"* The VIIRS/Aqua ratio drifts slowly from year to year (+8–10% in 2015–16 to −4–6% in
  2020–22, `findings_log.md` §5); eight fit years cannot pin that down. It is inside the likely range and is stated, not hidden.
- *"Why only Argentina?"* That is the only place it was tested.

## 5. Map (`index.html`, older page)

**What you see.** Circles on 1° cells for one month; size and colour grow with the value; a timeline you can play; a cell list
and cell detail; a box tool with CSV. Metric switch: Harmonized / MODIS (raw Aqua) / VIIRS (raw, empty before 2012).

**Data.** `gold_cell_monthly`. Colour scale fixed across all months.

**Caveats to know before a demo.** The region picker does not filter the map: every region shares `stratum_id = argentina`,
so "Region total" for Paraná Delta is the whole-country total. The cell detail says the ratio is "for this biome and month";
it is one factor per calendar month for the whole country. The "hotspots" fields show "–" or "not included" (trimmed, G-19).
Converted and measured months look the same here. Prefer Draw an Area for local questions.

## 6. Calendar (`calendar.html`, older page)

**What you see.** A heat map (rows = years, columns = months), side panel with a bullet chart (dot = value, band = middle half
of past years, line = usual), "same month across years" bars, and "by sensor" lines.

**Data.** `gold_region_monthly`, default baseline only.

**Caveats.** Converted months are not hatched, and there are no reliability flags. The one no-estimate month (Paraná Delta,
June 2005) is painted in the "normal" colour with the label "Provisional, not compared yet". Help text says VIIRS is "empty
before April 2018"; in this data VIIRS starts in February 2012 (Suomi NPP). Regions shows the same data with the honesty
markers, so demo Regions instead.

---

## Checking the numbers yourself

`scripts/verify_app_data.py` runs 47 checks and prints PASS/FAIL with the numbers. Run it after every data change:

```bash
python scripts/verify_app_data.py                                              # local JSON (harmonization/argentina/gold/publish)
python scripts/verify_app_data.py --url https://dev.kubranauts-hotspots.pages.dev   # what the site actually serves
```

1. **raw**: rebuilds the 12 factors and eight region-months (converted Sep 2010 and Jan 2012, Suomi NPP Feb 2015, NOAA-20 Sep
   2020, low-coverage Jul 2023, provisional Sep 2026, Delta Apr 2008, Patagonia Jul 2005) plus one Draw-page cell, with SQL written
   in the script against `data/argentina.duckdb`. Skipped if that file is missing.
2. **internal**: zones add to the country, cells add to the country, years add to their months; usual, ratio, class, rank,
   percentile, flag and likely range recomputed for all 1,722 region-months.
3. **events**: Delta Apr 2008 and Aug–Oct 2020, Centre Aug–Oct 2020, North-east Jan–Feb 2022 near the top of their month; 2020 the
   busiest year.
4. **boundary**: method and satellite by period, no conversion after January 2012, the 2012 seam, the provisional rule, blanks
   not zeros, partial years unranked.
5. **contract**: accuracy figures and factors match `gold/README.md`.

Result on 2026-11-15: 47 PASS, 0 FAIL on the local JSON and on the live preview. Planting two errors in a copy (one value +10%,
one ratio on a provisional month) turned 7 checks to FAIL, so the checks do catch errors.

Checks allow for rounding in the published JSON (values to 0.1, coverage to 0.001). Two rounding effects you may see in the app:
a ratio of 0.4996 is shown "0.50×" but classed "much below"; and two months with identical values (Patagonia March 2010 and
2011, both 185.4) can swap rank between rebuilds.
