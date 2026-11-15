# Task: Investigate how to make MODIS and VIIRS fire detections comparable

## Your role
You are a data scientist investigating a large real dataset from scratch. Your
first job is to understand what exists and how the two sensor families relate.
Do NOT implement a final solution or build the web app yet. Report what you
actually find, recommend an approach backed by evidence, and stop for review.

Nobody (including whoever wrote this prompt) has fully explored this data.
Treat everything outside this file as unverified. A second file,
`02_context_and_hypotheses.md`, holds team notes and earlier observations. Read
it only AFTER you have profiled the data and formed your own view, then use it
to cross-check, not to steer.

## The challenge (NASA Space Apps 2026, written by CONAE, Argentina)
Build a web application showing a burning activity calendar of fire hotspots
for a user-selected area and date range, from the early 2000s to the present,
in which the sensor of origin no longer matters.

Background: MODIS (older instrument, coarser pixels, from 2000) and VIIRS
(newer, finer pixels, from 2012) both detect active fires from space, but their
raw detection numbers are not directly comparable. A naive series that switches
from one to the other shows a jump that reflects the instrument, not the fires.
MODIS is being retired, so the long historical record must be bridged to VIIRS.

The app is meant to let emergency managers, scientists, and land managers:
- see which months and years had the most fire activity in an area,
- compare the current month against the historical median or average,
- spot anomalies and seasonal patterns (colour-coded calendar),
- download analytics and a CSV of the hotspots.

Judging favours a clear, validated method with honest uncertainty over a
complicated one. Simple, explainable, and tested beats sophisticated.

## Scope
Focus on **Argentina only**. Keep code parameterised so another region could be
added later, but do not generalise now.

## The data (what you can rely on)
- Fire detections, one row per detection (one satellite pixel flagged as fire).
- Stored as Parquet in an object store, partitioned by source and year,
  queried with DuckDB. Hundreds of millions of rows in total.
- Sensors: MODIS on Terra and Aqua; VIIRS on Suomi NPP and NOAA-20 (others may
  exist). Coverage start dates differ by satellite.
- Columns include satellite, date/time, location, a 0.1-degree grid cell,
  country, day/night, confidence class, fire radiative power (FRP), pixel size,
  and fire type flags.
- Find the exact paths, credentials, and column names in the project README or
  by inspecting the files. Do not assume; list and check.

Everything else about the data (quality, gaps, relationships) is for you to find.

## How to investigate (the dataset is large, so work smart)
1. **Profile before analysing.** List files, row counts per source/year,
   column types, null rates, value ranges, and distinct values of categorical
   columns. Check whether column semantics differ between sensors.
2. **Never pull raw rows into memory.** Aggregate in DuckDB (GROUP BY by day,
   month, grid cell, satellite) and bring only the small result into pandas.
   Filter on the partition columns (source, year) so only needed files are read.
3. **Subset to Argentina early** (by the country column, and verify that it is
   reliable, for example against a latitude/longitude bounding box). Save a
   compact Argentina extract or aggregate to local disk so later steps are fast.
4. **Sample carefully.** Use random sampling across the whole file, not the head
   of the file (files may be sorted by date). Prefer full aggregates over
   samples whenever the aggregate is cheap.
5. **Look at the data, not just numbers.** Produce plots: time series per
   satellite, scatter plots between sensors, ratio heatmaps, maps. Describe what
   you see in plain language before drawing conclusions.
6. **Check units and filters explicitly.** Anything that removes rows (fire-type
   filters, confidence filters, day/night restrictions) may affect the sensors
   differently. Quantify what each filter removes per sensor before choosing one.
7. **Look for the unexpected.** Missing days, sudden steps, outliers, duplicate
   detections, edge-of-swath effects, changes in processing versions, drifting
   observation times. A missing day is missing data, not zero fires.
8. **Keep a log.** Maintain a running file of findings, surprises, dead ends,
   and open questions, with the query or code that produced each result.

## What I want you to work out (in roughly this order)
1. **Make the problem visible.** Show how the sensors differ over time in
   Argentina, including what a naive stitched series looks like. Say what you see.
2. **Understand the relationship between sensors where they overlap.** Is it
   simple, stable, or does it depend on season, region, fire size, year, time of
   day, or something you discover? Where does it break down?
3. **Decide what to measure.** The raw detection count may not be the best
   quantity to harmonise. Identify candidate quantities (you may propose your own)
   and compare them on evidence: stability, sensitivity to the sensor change,
   robustness to outliers, and interpretability for a non-expert.
4. **Assess data quality and coverage.** Gaps, outliers, inconsistent
   labelling, and any limit on how far back or forward a conversion can be trusted.
5. **Test the simplest sensible method honestly.** Fit it on part of the
   overlap period, evaluate on years it did not see (and on later years), and
   report error and bias including where it fails. Only try something more
   flexible if the simple method is clearly inadequate, and compare them fairly.
6. **Recommend.** State what the main output should be, which quantity and method
   you recommend, how uncertainty should be shown, what remains risky, and what
   you would do next. Say where the evidence is weak.

## Principles
- Prefer simple, explainable methods; justify any added complexity with a
  measured improvement.
- Report numbers with uncertainty. Distinguish observed values from modelled ones.
- If the data contradicts anything you were told, say so and trust the data.
- Avoid over-fitting your choices to the evaluation period. Decide the unit and
  grouping first, then test once, and be transparent about every comparison tried.
- Do not guess at facts about satellites or processing; if it matters, find it in
  the data or flag it as an open question.

## Stopping rule
When you have covered steps 1-6, stop. Deliver: (a) your findings log,
(b) the key plots, (c) a one-page recommendation with the evidence, risks, and
open questions. Do not start implementing the pipeline or web app until reviewed.