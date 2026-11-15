# How to explain it: one-page cheat sheet (Argentina fire calendar)

Plain-English notes for presenting to judges. Sources are in brackets; `verify` = `python scripts/verify_app_data.py`.
Show the app at **https://kubranauts-hotspots.pages.dev** once `dev` is merged into `main`. Until then the new site is only at **https://dev.kubranauts-hotspots.pages.dev** and production still runs the old one (`SCOPE_AND_GAPS.md` G-24). The nav has four pages: The problem, Fire calendar, Draw an area, How accurate is it? Run `python scripts/verify_app_data.py` before presenting (47 checks).

## The 60-second story

**Problem.** Satellites have counted fires in Argentina since 2000, but the camera changed. The old one (MODIS) sees 1 km
squares; the new one (VIIRS, from 2012) sees 375 m squares and catches smaller fires, so it reports 4 to 7 times as many
detections. Join the two records and fire seems to jump almost fourfold in 2012. That jump never happened on the ground.

**Method.** While both cameras flew (2012 to 2019) we measured, for each calendar month, how many VIIRS detections there are
for every MODIS Aqua detection. Before 2012 we multiply MODIS by that month's number. From 2012 we use VIIRS as measured.
Everything is in one unit: "detections one VIIRS satellite would have counted".

**Result.** One record, 2003 to today, with no jump at 2012. On years the method never saw (2020 to 2022), half the converted
months were within 9.5% of what VIIRS measured, and the calendar colour matched in 89% of months. Known disasters (Paraná Delta
2008 and 2020, Corrientes 2022) come out as the busiest months on record.

**Limits.** Tested only in Argentina. Before 2012, small areas are rough (we flag them). The newest months are provisional and
are not compared. The calendar starts in 2003, not 2000.

## Ten numbers to know cold

| # | Number | What it means | Source |
|---|---|---|---|
| 1 | **4.0 to 6.7** | VIIRS detections per Aqua detection, by calendar month (lowest July, highest February) | `gold_calibration`; `verify` raw |
| 2 | **×3.7** | Raw record jump 2011 → 2012 (45,740 → 167,274 joined end to end; Suomi NPP alone counted 169,182 in all of 2012), purely from the camera change | `verify` boundary; `data/annual_counts.csv` |
| 3 | **×0.83** | Harmonized 2011 → 2012 (224,264 → 185,087). Aqua alone fell 18% that year, so the drop is real | `verify`; `data/annual_counts.csv` |
| 4 | **9.5%** | Typical (median) error of a converted month, whole country, unseen years 2020–2022 | `gold_accuracy` |
| 5 | **19%** | 9 converted months in 10 were within this | `gold_accuracy` |
| 6 | **8.9%** | Worst error of a converted year | `gold_accuracy` |
| 7 | **−7%** | Converted values ran low on average in the test years | `gold_accuracy` |
| 8 | **86% → "about 85%"** | How often the likely range (−21% / +23% for the country) contained the true value | `gold_accuracy`; D-10 |
| 9 | **89%** | Converted and measured months got the same colour class (whole country, unseen years) | `gold_accuracy`; D-24 |
| 10 | **50** | Below 50 MODIS detections in an area-month, a converted value is "indicative only" | `gold_reliability`; D-11 |

Also handy: 287 months shown, 109 converted, 174 measured, 4 provisional (`data/14_build_gold.txt`). 2020 is the busiest
complete year (390,960). Paraná Delta April 2008: 15,263 detections, busiest of 24 Aprils (`verify` events).

## Hard questions, honest answers

- **Why fit on 2012–2019 only?** Two reasons. Aqua's overpass time was stable until 2022, then drifted later (13.9 h → 15.8 h by
  2026), which changes what it sees (`findings_log.md` §5a). And we kept 2020–2022 out of the fit so the accuracy figures are a
  real test, not a fit to the answer (D-8).
- **Why stop converting MODIS after 2022?** Because of that drift, converted values were off by −25% to +35% in 2022–2025 (D-7).
  We don't need it: VIIRS measures every month from February 2012.
- **Why not fire radiative power (FRP, the heat given off)?** Total FRP is similar for both cameras, which is tempting, but month
  to month it converts worse than counts: unexplained error 0.17 vs 0.095 (log scale), and it does not scale in a straight line
  (slope 0.87 vs 0.99) (`findings_log.md` §3). A few huge MODIS pixels dominate its FRP totals.
- **Why does the calendar start in 2003?** Before July 2002 only Terra flew. Terra passes in the morning, before the afternoon fire
  peak, and its conversion is less certain (spread 0.19 vs 0.12). We did not build it for this version (D-2, G-1).
- **Why is October 2026 so low?** Checked: all three satellites had data on all 31 days, and each saw fewer detections per day
  than in any October since 2003 (Aqua 30.8 vs a previous low of 45.4; NOAA-20 144 vs 262) (`data/16_october_check.txt`). So it is a
  real low, but on provisional data, so the app shows the value without a colour or rank.
- **Why is 161× shown as "more than 10×"?** In that small box a usual April has about 95 detections, so any big fire gives a huge
  ratio that suggests false precision. "Busiest April in 24 years" is the honest headline. The exact ratio is in the CSV.
- **What does "likely range" mean?** For a converted month, the range that contained the true VIIRS value in 86% of unseen test
  months. We call it "about 85% likely". It is not a 95% guarantee.
- **What happens in small areas?** The fewer MODIS detections, the wider the range: under 50 it spans more than −80% to +80%, so
  the app flags it "indicative only". If MODIS saw nothing, we show "no estimate", not zero, because VIIRS usually saw some fire
  (96% of such cases). From 2012, values are measured and fine at any size.
- **Isn't VIIRS just a different error?** Yes. VIIRS is the reference scale, not ground truth. The series is "what VIIRS would
  have counted", not the number of fires or the area burned. We have not checked it against burned-area maps or fire reports.
- **Suomi NPP to NOAA-20 in 2018, another seam?** They count within 3–5% of each other per year (0.97–1.05), and our factors
  predict NOAA-20 just as well (`findings_log.md` §1, §5).
- **Any known flaw in the monthly numbers?** Yes, small: a few months with missing satellite days (mostly 2023 and 2024, for example
  NOAA-20 February 2024) may be overstated by up to about 10%. We found it after the build and have not changed the data (G-28).
- **Why not add the satellites together?** Two satellites means twice the passes, so counts go up with no change on the ground.
- **Why boxes, not provinces?** No province shapes were in the data; the four zones are the level we tested (D-20, G-10).

## Do not say

- "Number of fires" or "area burned". Say **fire detections**.
- "Accurate to 9.5%" as a blanket claim. It is the **typical** monthly error for the **whole country** on 2020–2022. Zones and
  small areas before 2012 are worse.
- "96% agreement" (or 85%, 71%). Those are fit-year figures (D-24). The held-out figure is 89%, whole country.
- "95% confidence interval". Say "likely range, about 85%".
- "October 2026 is a record low" as a final fact. It is provisional data.
- "Works anywhere" or "global". Tested in Argentina only.
- "Validated against the ground". It is validated against VIIRS.
- "Fires are increasing / decreasing since 2000". No trend test was done; the record starts in 2003, and a slow 5–10% level
  error before 2012 is possible (G-3).
- "Calibrated per biome" (the old Map page says this). It is one factor per calendar month for the whole country.
- "The Paraná Delta region is the Delta". It is a rough lat/lon box.
