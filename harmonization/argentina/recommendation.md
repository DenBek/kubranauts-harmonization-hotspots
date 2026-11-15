> **SUPERSEDED (2026-11-15).** The method, numbers and decisions now live in [HARMONIZATION_APPROACH.md](HARMONIZATION_APPROACH.md) and the gold tables. Differences: the build fits the factors on **2012–2019**, not 2012–2022 as written below, and the quoted likely range is −20.9% / +23.2%. Kept as the investigation-time recommendation.

# Recommendation: harmonizing MODIS and VIIRS fire counts for Argentina

Evidence is in [findings_log.md](findings_log.md) (sections in brackets) and [plots/](plots/). Scope: Argentina only, 2000-11 to 2026-11. Status: investigation; nothing is implemented in the pipeline.

## The problem in one picture
A series that switches satellites jumps ~3.7× in 2012 (45.7k → 169k detections a year) with no change on the ground, plus a smaller step in Jul 2002 ([plots/01](plots/01_problem_series.png), §1). All four satellites show the same seasons and the same big events, so the gap is mostly a scale difference. That scale is not constant: it depends on the calendar month (4.2× in the Jul–Sep burning peak, 6.8× in Nov–Feb), less on region, and strongly on day vs night (§2).

## What to produce
One table: **area × month → harmonized count, low, high, method, coverage**, in **VIIRS-equivalent detections** ("fire pixels one VIIRS satellite would have seen"; fire filter as in the project rules, day + night).

| Period | Value | Method flag |
|---|---|---|
| 2012-01-20 → 2018-03 | Suomi NPP, measured | observed |
| 2018-04 → present | NOAA-20, measured (factor-free; SNPP/N20 = 1.025, §1–2) | observed |
| 2002-07 → 2011-12 | Aqua × calendar-month factor | modelled |
| 2000-11 → 2002-06 | Terra × its own calendar-month factor (direct to VIIRS) | modelled, wider band |

Gap days: scale each month by days in month ÷ valid days, and flag months under 90% coverage (§4f). The calendar, "vs median" and anomaly views are read from this table.

## Quantity and method: detection count, calendar-month ratio (M1)
- **Why counts.** On the 2012–2019 selection period, counts with a month factor leave the least unexplained (log residual sd 0.095 vs 0.136 cell-days and 0.173 FRP), have a log-log slope of 0.99 (so a plain scale factor is right), and give the same anomaly class as VIIRS in 96% of months (§3). FRP and cell-days were team hypotheses. Both are worse here: FRP is heavy-tailed, and cell-days saturate in big months.
- **Why this method.** It is 12 numbers, one per calendar month: VIIRS total ÷ Aqua total over the overlap years ([data/11_month_factors.csv](data/11_month_factors.csv)). On unseen years 2020–22 it has a median monthly error of 9.5%, a worst annual error of 8.9% and a bias of −7%. That is half the error of a single global factor. Zone-specific factors and day/night-split factors gave no gain (§5). The same factors predict NOAA-20 equally well.
- **Final fit years: 2012–2022.** Those are all the pre-drift overlap years. Never use MODIS after 2022 for fitting or conversion: Aqua's overpass drifts from 13.9 h to 15.1 h local time (2025), and the errors swing from −25% to +35% (§2, §5).

## How to show uncertainty
- Modelled months get a band. At country scale, use the leave-one-year-out (LOYO) 95% band, about **−20% / +25%**. Out of sample it covered 86% of months, so call it "about 85% likely", not 95% (§5). Terra months: about −20% / +30% (80% interval; LOYO sd 0.186 vs 0.116 for Aqua).
- **The band depends on how much fire the area has.** Take it from the Aqua count in the area-month ([data/11_uncertainty_by_count.csv](data/11_uncertainty_by_count.csv)). With ≥1,000 Aqua detections the band is about ±15%. With 50–200 it is about ±35%. With fewer than 20 it is a factor of 2–3, so grey these months out as "too few detections to convert". When Aqua shows zero, VIIRS would usually have seen a few (median 3), so show "≈0, VIIRS-era equivalent unknown", not a hard zero.
- Visual rule: observed months are solid; modelled months are hatched or outlined, with the band in the tooltip.

## Risks and weak evidence
1. **Slow change in the ratio:** LOYO yearly bias moves from +10% (2016) to −6% (2022). The cause is unknown (fire regime? the MODIS collection label change in 2018?). Pre-2012 values could carry a ~5–10% level bias that the band only partly covers.
2. **Only 11 fit years**, and only 8 were used for selection; 2020 and 2022 are extreme years. The factor is weakest in quiet months (Apr–Jun).
3. **Likely unflagged gas flares** (Neuquén / Vaca Muerta; a cell active on 1,021 days but labelled vegetation) inflate VIIRS in the west (§4c).
4. **Small user areas** (< ~200 Aqua detections a month) cannot be converted reliably by any method tried. This is a physical limit, not a modelling choice.
5. 2026 NRT and Aqua drift cannot be separated (§4b). This does not affect the plan, since 2026 is VIIRS-measured.
6. The zones are rough lat/lon boxes, not ecoregions.

## Open questions for the team
- Anomaly baseline period: 2003–2022 (modelled + measured), or the VIIRS era only?
- Should the app also show FRP as a secondary display (it needs little scaling, ~1.0×, but calibrates worse)?
- Is the 2018 MODIS version label (6.2 → 6.03) a real algorithm change? It needs a FIRMS or documentation check.

## Next steps (after review)
1. Extend the static-source mask with persistent non-agricultural cells, and re-check the western ratios.
2. Test whether the yearly bias tracks fire-season severity. If so, consider a two-term model (month factor × activity), but only if it beats M1 on the same LOYO folds.
3. Run the same procedure on a second region, to check that M1 is not Argentina-specific.
4. Then build the gold table (0.1° × month, so any polygon is a sum), with the uncertainty rule above applied to the summed Aqua count of the polygon.
