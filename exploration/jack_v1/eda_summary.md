# EDA summary: MODIS and VIIRS fire detections

Hand-off for someone designing the harmonization method. Self-contained: it does not need the repo. Numbers come from `exploration/eda_firms.ipynb`, run on 2026-11-14 over the full record (`QUICK = False`); see "Limits of this summary" for what was not examined.

## 1. The task

Build one consistent fire record from 2000 to today, in which the sensor of origin no longer matters, and a web calendar on top of it (region and date range, anomalies against mean and median, colour ramps, CSV download). VIIRS (375 m pixels, from 2012) detects about 6 times more fires than MODIS (1 km pixels, from 2000), so a plain time series jumps when the sensor changes. Judging favours a clear, validated method with honest uncertainty over a complicated one.

Working decisions already made by the team: express results in "VIIRS-equivalent" units; use one satellite as reference at a time and never add satellites together (two satellites mean twice the overpasses); reference is Suomi NPP for 2012-01-20 to 2018-03-31 and NOAA-20 after; MODIS reference is Aqua, with Terra-only years (Nov 2000 to Jul 2002) converted to Aqua-equivalent first.

## 2. The data (silver layer)

One row is one detection: one satellite pixel at one moment flagged as containing a fire. Parquet in Cloudflare R2, partitioned `source={modis|viirs_snpp|viirs_noaa20}/year={yyyy}/{archive|sp|nrt}.parquet`, queried with DuckDB 2.0.0.

**Shape.** 52 files, 568,647,228 rows, 10.4 GB. Rows per year:

| Source | Satellites | Years | Rows per year |
|---|---|---|---|
| modis | Terra, Aqua | 2000 to 2025 (Terra from 2000-11-01, Aqua from 2002-07-04) | 0.26M (2000), 1.8M (2001), 3.7M (2002), then 3.7M to 5.1M |
| viirs_snpp | Suomi NPP | 2012 to 2025 | 17.2M to 21.7M |
| viirs_noaa20 | NOAA-20 | 2018-04-01 to 2025 | 14.5M (2018, partial), then 18.0M to 22.5M |

2026 (to 2026-11-14): MODIS 0.8M NRT + 2.3M SP; NOAA-20 7.5M NRT + 9.6M SP; Suomi NPP essentially absent (not loaded). NOAA-21 is not loaded. 2025 is complete and genuinely lower than 2024 (not missing data).

**Columns (27).** `satellite` (Terra, Aqua, Suomi NPP, NOAA-20), `instrument`, `quality` (SP science quality, NRT near real time, 2026 only), `acq_datetime_utc`, `acq_date_utc`, `local_date` (UTC shifted by longitude/15 hours; use for daily counts), `latitude`, `longitude`, `lat10`, `lon10` (0.1 degree cell), `country` and `country_source` (file, lookup_01deg, lookup_1deg, or blank), `daynight` (D/N), `confidence_class` (low/nominal/high) and `confidence_raw`, `frp` (fire radiative power, MW), `bright_main` and `bright_aux` (brightness temperatures, K), `scan` and `track` (pixel size on the ground, km, grows towards the swath edge), `type_reported`, `type_final`, `type_inferred`, `is_vegetation_fire` (`type_final = 0`), `version`, and hive partitions `source`, `year`.

**Types** (`type_final`): 0 vegetation fire, 1 volcano, 2 other static land source (gas flares, industry), 3 offshore. NRT rows have no FIRMS type; it is inferred from a static-source lookup and flagged `type_inferred`. Country for 2026 API rows also comes from lookups.

**Standard fire count:** `is_vegetation_fire AND confidence_class <> 'low'`.

**Null profile.** In 2024 partitions no column has nulls. In 2026 partitions `country` is null in 0.35% (MODIS) and 0.30% (NOAA-20) of rows, and `type_reported` is null in 25.8% (MODIS) and 43.9% (NOAA-20), which is the NRT share (`type_final` is filled from the lookup).

**Monthly cube used for the EDA.** 256,806 rows (satellite x quality x country x month x day/night), 568,647,228 detections, built with the standard filter plus counts at three filter levels. Covers Terra from 2000-10 (UTC 1 Nov shifts to local 31 Oct), Aqua from 2002-07, Suomi NPP from 2012-01, NOAA-20 from 2018-04.

**Other table.** `analysis/agg_monthly.parquet` (built earlier from bronze) has monthly counts by sensor, satellite, country, type, day/night and confidence, 2000 to 2025. It uses satellite names Aqua, Terra, N20 and has no Suomi NPP. Annual fire counts from silver and from this table agree within 0.1% for 2019 to 2025.

## 3. Findings

**Counts per year, fire-filtered (millions)**

| Year | Terra | Aqua | Suomi NPP | NOAA-20 |
|---|---|---|---|---|
| 2000 | 0.24 (2 months) | | | |
| 2001 | 1.62 | | | |
| 2002 | 1.68 | 1.75 (from Jul) | | |
| 2003 | 1.58 | 3.20 | | |
| 2004 | 1.55 | 3.16 | | |
| 2005 | 1.56 | 3.19 | | |
| 2006 | 1.44 | 2.90 | | |
| 2007 | 1.60 | 3.19 | | |
| 2008 | 1.48 | 3.02 | | |
| 2009 | 1.33 | 2.82 | | |
| 2010 | 1.43 | 2.96 | | |
| 2011 | 1.45 | 2.92 | | |
| 2012 | 1.58 | 3.00 | 17.35 | |
| 2013 | 1.25 | 2.65 | 15.71 | |
| 2014 | 1.36 | 2.72 | 16.67 | |
| 2015 | 1.45 | 2.91 | 17.67 | |
| 2016 | 1.35 | 2.74 | 16.62 | |
| 2017 | 1.41 | 2.70 | 16.31 | |
| 2018 | 1.27 | 2.52 | 15.55 | 11.76 (from Apr) |
| 2019 | 1.43 | 2.74 | 17.30 | 16.95 |
| 2020 | 1.40 | 2.65 | 17.07 | 16.81 |
| 2021 | 1.38 | 2.62 | 16.69 | 16.47 |
| 2022 | 1.09 | 2.36 | 13.95 | 14.64 |
| 2023 | 1.37 | 2.87 | 18.02 | 17.52 |
| 2024 | 1.32 | 3.11 | 17.42 | 18.63 |
| 2025 | 0.90 | 2.43 | 14.92 | 14.81 |

**Ratios between satellites (annual, global).** Counts, then total FRP in brackets.

| Year | Suomi NPP / Aqua | NOAA-20 / Aqua | Suomi NPP / NOAA-20 | Aqua / Terra |
|---|---|---|---|---|
| 2012 | 5.78 (1.20) | | | 1.90 (2.09) |
| 2013 | 5.93 (1.32) | | | 2.11 (2.42) |
| 2014 | 6.13 (1.34) | | | 2.00 (2.28) |
| 2015 | 6.07 (1.30) | | | 2.00 (2.31) |
| 2016 | 6.07 (1.33) | | | 2.03 (2.38) |
| 2017 | 6.04 (1.27) | | | 1.91 (2.11) |
| 2018 | 6.16 (1.31) | 4.66* (1.02*) | 1.32* (1.28*) | 1.99 (2.15) |
| 2019 | 6.31 (1.29) | 6.18 (1.26) | 1.02 (1.02) | 1.92 (2.21) |
| 2020 | 6.44 (1.37) | 6.34 (1.34) | 1.02 (1.02) | 1.89 (2.12) |
| 2021 | 6.38 (1.27) | 6.29 (1.25) | 1.01 (1.02) | 1.90 (1.96) |
| 2022 | 5.92 (1.29) | 6.21 (1.35) | 0.95 (0.95) | 2.16 (2.58) |
| 2023 | 6.27 (1.26) | 6.10 (1.22) | 1.03 (1.03) | 2.09 (2.11) |
| 2024 | 5.61 (1.17) | 6.00 (1.25) | 0.93 (0.94) | 2.35 (2.83) |
| 2025 | 6.13 (1.39) | 6.09 (1.37) | 1.01 (1.01) | 2.70 (2.91) |

\* 2018 NOAA-20 is a partial year (from April) compared with full years of the others; ignore. Aqua / Terra for 2003 to 2011 is 2.0 to 2.1 (counts) and 2.2 to 2.5 (FRP); 2002 is a partial Aqua year (1.04).

- The global annual VIIRS / Aqua count ratio is stable across the whole VIIRS era: Suomi NPP / Aqua 5.6 to 6.4 for 2012 to 2025, NOAA-20 / Aqua 6.0 to 6.3 for 2019 to 2025. The same ratio on total FRP is 1.17 to 1.39. This holds across the Aqua drift (after about 2022) at global scale.
- It is not stable inside the year or between places:
  - By calendar month, 2019 to 2025, the mean NOAA-20 / Aqua count ratio runs from 5.2 (June) to 8.0 (April); the month-by-year minimum and maximum span 4.8 to 17.1, and one April reaches 17.1 (not yet traced).
  - By country (2019 to 2025): Angola 4.2, DR Congo 4.7, Guinea 4.8, Zambia 5.1, Argentina 5.1, Brazil 6.1, USA 7.1, Australia 7.8, India 8.1, Russia 9.4, Canada 11.9. The global ratio hides this, so a single global factor will not work; the factor depends on fire regime (fire size) and season.
- Total FRP is a more comparable quantity than counts: the VIIRS / Aqua ratio is 1.2 to 1.4 against about 6 for counts.
- FRP per detection (2024): median Terra 17.2 MW, Aqua 21.5, Suomi NPP 5.3, NOAA-20 5.3; mean Terra 38.5, Aqua 46.3, VIIRS 9.67; 99th percentile Terra 364, Aqua 426, VIIRS 81 to 83. Maxima: Suomi NPP 12,470 MW and Terra 12,424 MW against Aqua 11,892 and NOAA-20 2,825 (single extreme detections; check before summing FRP).
- Suomi NPP and NOAA-20 are close to 1:1. Monthly ratio (93 months from 2018-05): median 1.015, interquartile range 1.007 to 1.022, maximum 1.107. The minimum of 0.002 is January 2026, where Suomi NPP is simply not loaded; ignore it. The annual dips to 0.95 (2022) and 0.93 (2024) match Suomi NPP's missing days (below).
- Terra is drifting away from Aqua. Aqua / Terra counts sit at 1.9 to 2.1 from 2003 to 2021, then rise: 2.16 (2022), 2.09, 2.35, 2.70 (2025). On FRP: 2.1 to 2.5 up to 2021, then 2.58, 2.11, 2.83, 2.91. Terra counts fall to 1.09M (2022) and 0.90M (2025) while Aqua stays at 2.4M to 3.1M. Terra's daytime share of detections is 0.74 to 0.81 from 2001 to 2021 (0.76 in 2022), then 0.68 (2023) and 0.61 (2024, 2025), consistent with its orbit drifting to earlier local times. Aqua stays at 0.94 to 0.96 daytime; VIIRS 0.72 to 0.80.
- Pixel size (mean `scan`, 2024): Terra 1.55 km, Aqua 1.57 km, NOAA-20 0.42 km.
- Filters remove very different amounts by instrument (2019 to 2025):

| | Non-vegetation | Low confidence (of vegetation) | Kept |
|---|---|---|---|
| Terra | 7.2% | 5.9% | 87.4% |
| Aqua | 2.9% | 4.4% | 92.9% |
| Suomi NPP | 6.7% | 11.8% | 82.3% |
| NOAA-20 | 6.7% | 12.2% | 81.9% |

  So the confidence filter changes the effective ratio: it removes about 3 times more from VIIRS. Type mix, 2024: vegetation Terra 92.9%, Aqua 97.4%, Suomi NPP 94.0%, NOAA-20 94.0%; static land source (type 2) Terra 6.8%, Aqua 2.5%, VIIRS 5.6%; offshore (type 3) VIIRS 0.34% to 0.35%, MODIS 0.03% to 0.08%; volcano (type 1) MODIS 0.10% to 0.27%, VIIRS 0.07%.
- Fire is concentrated: 9 countries hold 50% of NOAA-20 fire counts (2019 to 2025), 25 hold 80%, 50 hold 95% (237 countries in the data). Largest by NOAA-20 share: DR Congo 10.5%, Brazil 7.7%, Angola 6.7%, Australia 6.2%, Russia 6.1%.
- Country is nearly always present: missing for 0.005% to 0.017% of SP rows and 0.26% to 0.53% of NRT rows in the cube; 0.23% to 0.62% of 2026 rows.
- Spatial footprint, 2024: 10,185 one-degree cells with fire for Aqua against 12,347 for NOAA-20 (VIIRS sees fire in about 21% more cells).

**Gaps (UTC days with no data for a satellite).** A missing day is missing data, not zero fires.

| Satellite | Missing days |
|---|---|
| Terra | 2001: 17 (Jun 16 to Jul 2); 2002: 9 (Mar 20 to 27 and Apr 15); 2003: 7; 2008: 2; 2016: 9 (Feb 19 to 27); 2022: 12 (Oct 11 to 22); 2026: 1 |
| Aqua | 2002: 10 (Jul 30 to Aug 7 and Sep 13); 2022: 16 (Apr 1 to 16) |
| Suomi NPP | 2012: 1; 2022: 15 (Jul 27 to Aug 10); 2024: 19 (five runs, May to Nov) |
| NOAA-20 | 2023: 5; 2024: 1 |

**SP vs NRT, 2026.** NRT starts in August for NOAA-20 and in September for Aqua and Terra (Terra has 724 NRT rows in August). NRT rows have inferred type (100%) while SP rows have none (0%). Country for every 2026 row, SP or NRT, comes from the lookup (100%).

## 4. Limits of this summary

- Not summarised here because they were plots, not numbers: monthly series per satellite, local overpass hour 2019 vs 2025, scan-size distributions, the Argentina year-by-month calendar, the 1 degree spatial maps.
- Ratios by month and by country cover 2019 to 2025 only. How they behaved in the Suomi NPP years 2012 to 2018 (the pre-drift overlap with MODIS) was not examined by country or month.
- The one April with an NOAA-20 / Aqua ratio of 17.1 has not been traced to a year or cause.
- Row-level distributions (FRP, pixel size, type mix) are for 2024 only.
- Day/night and country were examined separately, not jointly with season.

## 5. What this implies for the method (hypotheses, not decisions)

1. A single global factor is ruled out by month and country, even though the global annual ratio is steady. A country by calendar-month factor (with shrinkage where counts are small) is the natural next step, and large countries (Russia, Canada, Brazil, USA, Australia) mix fire regimes, so a smaller region unit may be needed.
2. The steady global annual Suomi NPP / Aqua ratio (5.6 to 6.4 for 2012 to 2025) means a fit on the pre-drift years 2012 to 2019 can be tested directly against 2020 to 2025, but it must be checked region by region before trusting it.
3. FRP and fire-active cell-days are candidate quantities that may harmonize better than raw counts (FRP ratio is 1.2 to 1.4 against about 6).
4. Suomi NPP can be joined to NOAA-20 near 1:1 for the reference series, but only after normalising for missing days (the annual dips of 0.95 and 0.93 are gap years).
5. Terra is a poor long-run reference after about 2022 because of orbit drift (falling counts, shifting day share, Aqua / Terra rising from 2.0 to 2.7). Terra-only years (2000-11 to 2002-06) must be converted to Aqua using the Terra / Aqua overlap, ideally from 2003 to 2011 when the ratio was steady at 2.0 to 2.1.
6. Validation is only possible where MODIS and VIIRS overlap (2012 onward). Pre-2012 values are extrapolation from MODIS and need honest uncertainty bands.
7. Gap days need flagging and per-available-day normalisation.

## 6. Questions for the person or model designing the method

- Primary harmonized quantity: counts, FRP, active cell-days, or more than one?
- Calibration unit and fallback chain: country, biome, or grid cell; how to shrink?
- How to remove the instrument effect of resolution (many small VIIRS detections per large fire) without a fire-size model?
- Anomaly baseline period: 2003 to 2022 (MODIS plus modelled), or 2012 to 2025 (VIIRS era only)?
- How to treat 2026 NRT months and gap days in the calendar?
