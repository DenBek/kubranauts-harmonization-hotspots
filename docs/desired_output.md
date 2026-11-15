## The short answer

**The main output is a harmonized monthly time series for any area of interest, 2000 to now, in one unit.** The calendar heatmap is how that series gets shown to users.

Aligning the two datasets onto the same columns doesn't solve it, because the problem isn't column names. Row-level alignment can't work: a MODIS pixel and a VIIRS pixel are different measurements of different footprints, so no column mapping makes them equal. Comparability only exists after you **aggregate** (area x time) and **calibrate** (sensor-to-sensor scaling). So the unit of output is not a detection row. It is an **area x month value with an uncertainty**.

## What you can't do today

With the current data, a manager can already filter hotspots and count them. What they cannot do is answer these:

1. **"Was October 2024 unusual for this area?"** requires a baseline. The VIIRS baseline has 13 years, and the MODIS baseline has 25 years but is on a different scale.
2. **"Is fire activity here trending up or down over 25 years?"** A raw series jumps by about 6x in 2012 when the sensor changes, so any trend, anomaly, or "highest month on record" is dominated by the sensor switch.
3. **"What happens after MODIS dies?"** Without a bridge, the long record stops being usable.

So the thing that doesn't exist yet is **one number per area-month that means the same thing in 2005 and 2025**. Everything else (calendar, map, anomalies, CSV) is a view of that.

## What the output looks like

Think of it as one table, which is the real product:

| area | month | harmonized_value | lower | upper | source_flag | coverage |
|---|---|---|---|---|---|---|
| polygon / cell | 2008-10 | 412 | 350 | 480 | modeled from Aqua | 100% |
| polygon / cell | 2024-10 | 655 | 640 | 670 | observed VIIRS | 97% |

Everything the challenge lists is derived from that table:

- **Calendar heatmap**: month x year grid of `harmonized_value`, with modeled cells visually distinguished
- **Current month vs historical median**: one query over the table
- **Highest months and years**: a sort
- **Anomaly view**: value relative to the median or percentile, which works because the series is now comparable
- **Argentina map**: the same table aggregated by cell instead of by polygon, for a chosen month or period
- **CSV download**: the table, plus optionally the raw hotspots

## Where the hard part sits

The table has two parts with very different difficulty:

- **2012 onward** is mostly observed VIIRS, with a clean Suomi NPP to NOAA-20 hand-off. It is easy.
- **2000 to 2011** is the only place where the research is needed. It is MODIS converted to VIIRS-equivalent, validated on the overlap.

Your harmonization work therefore reduces to one question: **how do we get a trustworthy VIIRS-equivalent value for 2000 to 2011, with honest error bars?** Everything else is engineering.

## Unit decision

Your EDA suggests ordinary counts are the wrong unit, since the ratio is around 6 and varies by season and place. The main output should probably be **"active cell-days" per area-month** (distinct 0.1° cells x days with at least one detection), possibly alongside FRP. This is still countable and explainable ("the number of fire-days across the area"), and likely to calibrate much better. That is what the Query A comparison in my last message decides. If it fails to show a clear winner, the fallback is counts with stratified ratios.

## What this means for your plan

1. **Define the output table first** (schema above), then work backward.
2. Run the unit comparison (Query A) to choose the `harmonized_value` definition.
3. Build the calibration only for the 2000 to 2011 portion, with the 2012 to 2019 fit and 2020 to 2025 forward test as your validation.
4. Precompute the table for Argentina at 0.1° x month, so any user-drawn polygon is a fast sum.
5. Build the calendar and map on top.

For the pitch, the story is: "same area, same unit, 25 years, with error bars where the data are modeled."