# Context, prior observations, and open questions (secondary priority)

Read this AFTER you have profiled the data and formed your own view.
Everything here is either (A) a decision the team has made, (B) an observation
from earlier partial exploration that may not hold up, or (C) an assumption or
open question. Where this file disagrees with the data, trust the data and say so.

---

## A. Team decisions (these are choices, not findings)

- Results should be expressed in "VIIRS-equivalent" units: what a VIIRS
  satellite would have recorded, because VIIRS is the continuing instrument.
- Never add satellites together. Two satellites passing over the same place means
  more observations; summing them inflates counts without any change on the ground.
- Intended reference satellites: Suomi NPP for 2012-01 to 2018-03, NOAA-20 from
  2018-04 on. For MODIS, Aqua is the intended reference, with the Terra-only
  period (Nov 2000 to mid 2002) converted to Aqua-equivalent first.
- Intended primary output: one harmonised value per area per month, with an
  uncertainty range and a flag for observed versus modelled.
- Hotspot CSV downloads are served from the detection-level data, not from the
  harmonised table.

You are allowed to recommend changing any of these if the evidence supports it.

---

## B. Prior observations (partial, possibly wrong, re-verify before relying)

### Global scale (from earlier summaries, mostly 2019 onward)
- VIIRS reports roughly 6 times more detections than Aqua per year; total FRP
  differs by only roughly 1.2 to 1.4 times.
- The global annual ratio looked steady, but varied widely by calendar month
  (about 5 to 8, extremes 4.8 to 17.1) and by country (about 4 to 12).
- One April with a VIIRS/Aqua ratio of 17.1 has never been traced.
- Suomi NPP and NOAA-20 looked close to 1:1.
- Terra counts fall and its day/night mix shifts after about 2020; Aqua shows
  smaller drift after about 2022.
- Known missing days exist (for example Aqua, April 2022; Suomi NPP, mid 2022
  and several 2024 periods; Terra in several years). They may or may not fall in
  Argentina.
- The confidence filter appeared to remove about three times more detections
  from VIIRS than from MODIS globally.
- Non-fire sources (gas flares, industry, volcanoes, offshore) appear at
  different rates per sensor.

### Argentina (2012 to 2025, daytime, standard filter, Aqua versus Suomi NPP)
- Monthly VIIRS/Aqua ratio by unit: raw counts about 4.2; distinct 0.1-degree
  cell-days about 3.0; distinct cells about 2.4; FRP about 1.07.
- Month-to-month variability of those ratios was similar for every unit
  (coefficient of variation roughly 0.17 to 0.27), and was higher in 2020 to 2025
  than in 2012 to 2019. No unit was clearly most stable.
- Only about 68% of Aqua cell-days were also seen by VIIRS on the same
  cell-day; only about 25% of VIIRS cell-days were seen by Aqua. So the two are
  not subsets of each other; any mapping is statistical, not event-by-event.
- Ratios varied strongly with region and season in a partial look at 1-degree
  cells (not yet mapped properly).
- Terra/Aqua count ratio swung with season (about 0.3 in winter, 0.5 to 1.0 in
  summer, 2003 to 2011), so a single Terra-to-Aqua factor is unlikely to work.
- Extreme single-detection FRP values of 6,000 to 13,000 MW occurred, clustered
  in space and time (single large fires), so raw FRP sums may be dominated by a
  few events.
- Low-activity months gave unstable monthly ratios (some months had few hundred
  cell-days, others thousands).

### Argentina events usable as sanity checks
Paraná Delta (around April 2008), Paraná Delta and Córdoba (around
August-October 2020), Corrientes (around January-February 2022). Check that a
harmonised series shows these sensibly, without being forced to.

---

## C. Open questions and unverified assumptions

1. Which quantity should be harmonised: detection counts, active cell-days,
   distinct cells, FRP (robustly summarised), or more than one?
2. Is the 2012 to 2019 overlap a clean calibration window, and is 2020 to 2025 a
   fair test, given orbit drift and Suomi NPP gap days?
3. Is restricting to daytime detections a safe simplification? Is night data
   usable at all in Argentina?
4. What regional grouping, if any, captures how the ratio varies inside
   Argentina? Should grouping come from the data (for example mapped ratios) or
   from ecoregions?
5. Does the confidence filter affect the sensors equivalently? Should the same
   rule be applied to both?
6. How far back can a MODIS-to-VIIRS conversion be trusted, especially for the
   Terra-only period before mid 2002?
7. What baseline period should anomalies use (for example 2003 to 2022
   modelled-plus-observed, or 2012 onward observed only), and how sensitive are
   the results to that choice?
8. How should near-real-time months (2026) and gap days appear in the calendar?
9. Is there residual duplication, edge-of-swath double counting, or
   processing-version change that affects counts?
10. What is a realistic uncertainty on a single monthly value for a small area,
    versus a seasonal or annual summary?
11. Is a simple ratio or log-scale regression adequate, or does a count-model
    (for example Poisson or negative binomial) or a flexible machine-learning
    model add a measured improvement?

---

## D. Practical and environment notes (lower priority)

- Environment: a small Codespaces machine (2 cores, about 8 GB RAM); use a
  DuckDB memory limit and a temp directory so large queries spill to disk.
- DuckDB 2.0.0 quirks previously hit: relations have no `.fetchone()` (use
  `.fetchall()[0]`); `days` cannot be used as a column alias; `GROUP BY ALL` with
  a window function over an aggregate can fail (use a subquery); `USING SAMPLE`
  returned rows from the start of files, so use `ORDER BY random() LIMIT n`.
- Credentials come from environment variables; never hard-code them (the repo is
  public).
- Silver-layer standard fire filter used so far:
  `is_vegetation_fire AND confidence_class <> 'low'`. Treat as a starting point,
  not as correct.
- Satellite end-of-life notes (to verify): Suomi NPP stopped new data in
  Nov 2026; Terra and Aqua science scheduled to end in 2027; NOAA-21 exists but
  is not loaded.
- Optional extras the team may add later, out of scope for this investigation:
  reported-event overlays (such as NASA EONET), additional satellites, other
  countries, and the web application itself.