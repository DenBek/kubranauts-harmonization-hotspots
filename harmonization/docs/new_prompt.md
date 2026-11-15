# Task: Build the MVP data product for the Argentina harmonized fire calendar

## Context
We are building a web calendar of fire hotspot activity for Argentina (NASA Space
Apps 2026), consistent over time despite the MODIS-to-VIIRS switch. A previous
investigation (harmonization/argentina/, see findings_log.md and
recommendation.md) settled the method. The web app already exists as HTML. This task
is MVP only: build the data files the app will read, run two quick checks, and stop.
Do not redesign the method. Do not spend time on small issues that do not change the
picture; list them in one line at the end.

## Step 0: look at the existing app first (short)
Before building anything, inspect the existing HTML app and report how it expects to
receive data (file format, column names, any sample data, whether it loads Parquet,
JSON or CSV, in the browser or from an API). Adapt the output formats below to what
the app can actually read. If the app has no data layer yet, propose the simplest
format (small JSON/CSV/Parquet files loadable in the browser) and say so. Do not
modify the app unless it is trivial; list any changes needed instead.

## Settled findings (use as given; do not re-investigate)
- Harmonize **detection counts, day+night, per month**, in VIIRS-equivalent units.
- Method M1: one conversion factor per **calendar month** for Argentina, fitted on
  2012-2019 (Aqua -> Suomi NPP). Zone, day/night and FRP/cell-day variants did not help.
- The same factors predict NOAA-20 equally well. VIIRS series: Suomi NPP until
  2018-03, NOAA-20 from 2018-04 (they agree ~1:1 on matched days).
- Out of sample (2020-22): median monthly error ~9.5%, 90th percentile ~19%, annual
  error at most ~9%, anomaly-class agreement 96% at country level (85% at zone, 71% at
  2-degree blocks). Year-level bias drifts from about +10% to -6%.
- The nominal 80% interval under-covered (67%); the 95% interval covered ~86%. Use
  the LOYO 95% band (about -20%/+25% at country scale) and call it a **"likely
  range"** (about 85% chance of containing the true value, measured on held-out years).
- **Do not convert MODIS after 2022** (Aqua/Terra overpass times drift).
- Gap days are missing data, not zero: scale by valid days and flag low coverage.
- When Aqua count is 0 but VIIRS sees fire (96% of such cases), the conversion cannot
  recover it: report `insufficient_data`, never zero.
- Uncertainty grows sharply for small areas (findings_log.md section 5).

## Scope decisions made since the investigation
- **Argentina only.** Keep the code region-parameterised, but do not generalise.
- **Calendar starts at 2003-01.** Terra-only months (2000-11 to 2002-06) and the
  Aqua start-up months of 2002 are **excluded from the gold tables entirely** (hidden
  in the app). Log this gap in the scope doc; do not build the Terra bridge.
- **Day+night counts** stay as the default (already validated). Day-only is only
  reported as a comparison (see check 2).
- **Anomaly baselines, two options, both provided:** default = median (and mean) of
  2003-2022 on the harmonized series; alternative = VIIRS-only baseline (2012-2025
  observed). Store both so the app can toggle between them, and label which is active.
- **Uncertainty wording:** "likely range", tested on held-out years, about 85%.

## Deliverable 1: two quick sanity checks (keep each small; one table each)
1. **Flare-cell sensitivity.** Mark persistent cells (0.1-degree cells active on >=200
   days in VIIRS, plus the Neuquen/Vaca Muerta cluster). Refit the monthly factors
   with and without them. Report how much the factors and the 2020-22 test error
   change. If the change is under ~3%, say so and stop. If larger, report it and
   recommend a simple mask; do not build elaborate flare detection.
2. **Day-only vs day+night.** Compare M1 day-only vs day+night on the 2020-22 test, and
   check the stability of Aqua's day share over 2003-2011. Default stays day+night
   unless day-only is clearly better. Stop there.

## Deliverable 2: the data product (formats adapted to Step 0)
**Cell-month table** (Argentina, 2003-01 to latest), one row per 0.1-degree cell x
month, so any user-drawn polygon is a fast sum:
- `cell` (lat10, lon10), `month`
- `raw_count` (observed, as received) and which satellite supplied it
- `harmonized` (VIIRS-equivalent count): observed VIIRS from 2012-01; Aqua converted
  by the calendar-month factor for 2003-2011
- `method`: `observed_viirs` | `modelled_aqua` | `provisional_nrt`
- `coverage`: fraction of valid satellite-days in the month (gap handling)
- `factor` used and its relative uncertainty

**Country-month table**: harmonized value, lower/upper "likely range", baseline median
and mean for BOTH baselines, anomaly vs median (both baselines), percentile within
calendar month, method flag, coverage.

**Reliability lookup** (the key honesty feature): for area-month sizes (expected
Aqua-equivalent detections: <5, 5-19, 20-49, 50-199, 200-999, 1000-4999, >=5000), give
the likely-range relative error from findings_log.md section 5 and a flag:
`reliable` | `good` | `caution` | `indicative_only`. Choose the thresholds from the
evidence and state them. Include a short plain-language suggestion per level (for
example "select a larger area or use the seasonal or annual view"). Observed VIIRS
months are always reliable regardless of area size; the flag only applies to modelled
(pre-2012) months.

**Headline KPI file** (small JSON the app reads for an "accuracy" panel): median
monthly error, 90th percentile error, worst annual error, anomaly agreement
(country / zone / block), coverage of the likely range on held-out years, test period,
and one-sentence plain-language statements for each.

Rules: 2023 onward uses observed VIIRS (NOAA-20; Suomi NPP only to 2018-03). 2026 NRT
months are `provisional_nrt`. Months with Aqua=0 and no usable VIIRS evidence are
`insufficient_data`.

## Deliverable 3: four pitch figures (reuse existing plots where possible)
1. Seam plot: raw monthly series by satellite plus the naive stitched series.
2. Before/after calendar (month x year), same colour scale, raw vs harmonized.
3. Validation: predicted vs observed for held-out years.
4. Uncertainty vs area size (the reliability table as a plot).
Colour-blind-safe palette (viridis/cividis). Mark modelled months visually.

## Deliverable 4: scope doc
Write `SCOPE_AND_GAPS.md` with three sections: MVP scope, Known gaps, Future scope
(start from the draft I will paste if provided; otherwise write it from this prompt
and the findings log). Be honest and plain; no apologies.

## Principles
- MVP: the simplest thing that works and is explainable. No new modelling.
- Report numbers with uncertainty; always separate observed from modelled.
- If a check contradicts the settled findings, say so; do not expand scope.
- Keep a short log: what you ran, the result, the file produced.

## Stopping rule
Stop after: Step 0 report, the two checks, the data files, the reliability lookup, the
KPI file, the four figures, the scope doc, and a short README of the data schema for
the app developer. List anything that would block the app. Do not build or restyle the
app.