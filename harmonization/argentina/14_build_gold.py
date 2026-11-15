"""MVP gold tables for the Argentina harmonized fire calendar (method M1, see recommendation.md).

Input : data/argentina.duckdb (cellday, valid, daily, daily_blk), built by 02_extract -> 05_build_local -> 07_build_daily.
Output: gold/<table>.parquet with the web app's column names (scripts/export_calendar.py publishes them).

  gold_cell_monthly_01deg  0.1 deg cell x month, full resolution (for polygon sums; not exported to the browser)
  gold_cell_monthly        same, aggregated to CELL_RES deg so the JSON stays browser-sized
  gold_region_monthly      region x month: harmonized, likely range, both baselines, anomalies, ranks
  gold_region_annual       region x year
  gold_region_headline     one sentence per region
  gold_calibration         the 12 month factors and their held-out error
  gold_reliability         likely range and flag by area-month size (Aqua detections)
  gold_accuracy            headline accuracy figures with plain-language statements
  (gold_region_analogs is NOT produced: analog years are not part of the validated method.)

Unit: VIIRS-equivalent fire detections ("fire pixels one VIIRS satellite would have seen"), fire filter, day+night.
NOTE: columns named *_cell_days hold detection COUNTS in this version (kept for app compatibility).

Run from harmonization/argentina/: ../../venv/Scripts/python.exe -u 14_build_gold.py [--upload]
--upload copies gold/*.parquet to r2://firms-data/gold/ through DuckDB (needs R2_KEY_ID, R2_SECRET, CF_ACCOUNT_ID, or .env).
"""
import calendar
import os
import sys
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
from common import connect_local, HERE
from pairs import pair

# ---------------- parameters ----------------
START = date(2003, 1, 1)          # calendar starts here; Terra-only and Aqua start-up months are excluded
FIT = range(2012, 2020)           # M1 fit years (Aqua -> Suomi NPP)
E1 = range(2020, 2023)            # held-out test years
LOYO = range(2012, 2023)          # leave-one-year-out years (pre-drift overlap)
BASE_DEFAULT = (2003, 2022)       # harmonized baseline
BASE_VIIRS = (2012, 2025)         # VIIRS-only baseline (observed months only)
N20_START = date(2018, 4, 1)
MIN_VIIRS_COVERAGE = 0.5          # a VIIRS month needs >= 50% valid days, else it is modelled from Aqua (only 2012-01)
LOW_COVERAGE = 0.9
CELL_RES = 1.0                    # degrees for the browser cell table (0.5 deg = 37 MB JSON, too big)
STRATUM = "argentina"
METHOD_VERSION = "M1_month_ratio_v1"
REGIONS = {  # SQL on lat10/lon10 (0.1 deg cell floor). Zones are the rough boxes used in the investigation.
    "argentina": ("Argentina", "TRUE"),
    "ar_ne": ("North-east (Mesopotamia, eastern Chaco, Formosa)", "lat10 > -350 AND lon10 > -605"),
    "ar_nw": ("North-west and western Chaco", "lat10 > -300 AND lon10 <= -605"),
    "ar_c": ("Centre (Pampas, Cordoba, San Luis, La Pampa)", "lat10 > -390 AND NOT (lat10 > -350 AND lon10 > -605) AND lat10 <= -300"),
    "ar_s": ("Patagonia (south of 39 S)", "lat10 <= -390"),
    "ar_delta": ("Parana Delta (box)", "lat10 BETWEEN -345 AND -321 AND lon10 BETWEEN -610 AND -584"),
}
BINS = [0, 5, 20, 50, 200, 1000, 5000, 1e12]
BIN_LABELS = ["<5", "5-19", "20-49", "50-199", "200-999", "1000-4999", ">=5000"]
# Flag thresholds on the half-width of the likely range (max of |low|, |high|), chosen from the LOYO evidence:
#   reliable <= 30% (>= 5,000 Aqua detections), good <= 40% (1,000-4,999), caution <= 65% (50-999), else indicative_only (< 50).
FLAGS = [(0.30, "reliable", "Converted value is usable as shown."),
         (0.40, "good", "Usable; read the likely range, not just the central value."),
         (0.65, "caution","Use for broad comparisons only; a larger area or the seasonal or annual view is more reliable."),
         (np.inf, "indicative_only", "Too few MODIS detections to convert. Select a larger area or use the seasonal or annual view.")]
APP_SOURCE = {"modelled_aqua": "modis_calibrated", "observed_viirs": "viirs_archive", "provisional_nrt": "viirs_nrt",
              "insufficient_data": "modis_calibrated"}

GOLD = HERE / "gold"
GOLD.mkdir(exist_ok=True)
con = connect_local()
log = []


def P(*x):
    s = " ".join(str(v) for v in x)
    print(s, flush=True)
    log.append(s)


# ---------------- 1. month factors (matched valid days, D+N) ----------------
z = pd.concat([pair(con, "Aqua", "Suomi NPP", "A", zone=zz, y0=2012, y1=2025).assign(zone=zz) for zz in ["NE", "NW", "C", "S"]])
z = z.rename(columns={"n_a": "a", "n_b": "v"})[["t", "zone", "a", "v"]]
z["yr"], z["mo"] = z.t.dt.year, z.t.dt.month
cty = z.groupby(["t", "yr", "mo"])[["a", "v"]].sum().reset_index()


def factors(years):
    f = cty[cty.yr.isin(years)].groupby("mo")[["v", "a"]].sum()
    return f.v / f.a


k = factors(FIT)
fitm = cty[cty.yr.isin(FIT)]
k_sd = fitm.assign(l=np.log(fitm.v / fitm.a)).groupby("mo").l.std()   # year-to-year sd of log ratio = factor rel. uncertainty
P("month factors k (Aqua -> SNPP, fit 2012-19):", k.round(3).to_dict())

# ---------------- 2. LOYO country band, E1 scores, annual band ----------------
lo = []
for y in LOYO:
    kk = factors([x for x in LOYO if x != y])
    d = cty[cty.yr == y]
    lo.append(d.assign(p=d.a * d.mo.map(kk)))
lo = pd.concat(lo)
lo["lerr"] = np.log(lo.p / lo.v)
q025, q975 = lo.lerr.quantile([0.025, 0.975])
BAND = (np.exp(-q975), np.exp(-q025))          # actual / predicted, monthly, country
ly = lo.groupby("yr")[["p", "v"]].sum()
ylerr = np.log(ly.p / ly.v)
BAND_YEAR = (np.exp(-ylerr.max()), np.exp(-ylerr.min()))
e1 = cty[cty.yr.isin(E1)].assign(p=lambda d: d.a * d.mo.map(k))
r = e1.p / e1.v
cover = ((e1.v >= e1.p * BAND[0]) & (e1.v <= e1.p * BAND[1])).mean()
e1y = e1.groupby("yr")[["p", "v"]].sum()
E1S = dict(bias=np.exp(np.log(r).mean()) - 1, mdape=np.median(np.abs(r - 1)), p90=np.quantile(np.abs(r - 1), 0.9),
           annual_max=np.max(np.abs(e1y.p / e1y.v - 1)), coverage=cover, months=len(e1))
P(f"country likely range (LOYO 95%): {BAND[0]:.3f}-{BAND[1]:.3f}; annual {BAND_YEAR[0]:.3f}-{BAND_YEAR[1]:.3f}")
P("E1 2020-22:", {kk_: round(v, 4) for kk_, v in E1S.items()})

# app 5-class anomaly agreement at country (E1), baseline = SNPP median of the fit years
APP_CLASS = [(0.5, "much_below"), (0.8, "below"), (1.2 + 1e-9, "normal"), (1.8 + 1e-9, "above"), (np.inf, "much_above")]


def cls(x):
    if x is None or not np.isfinite(x):
        return None
    return next(c for t, c in APP_CLASS if x < t)


med = fitm.groupby("mo").v.median()
agree5 = np.mean([cls(p / med[m]) == cls(v / med[m]) for p, v, m in zip(e1.p, e1.v, e1.mo)])
P(f"app 5-class anomaly agreement, country, E1: {agree5:.3f}")

# ---------------- 3. reliability by area-month size (LOYO, zones + 2deg blocks + country) ----------------
b = pair(con, "Aqua", "Suomi NPP", "A", zone=None, y0=2012, y1=2022, table="daily_blk", extra_group="blat, blon")
b = b.rename(columns={"n_a": "a", "n_b": "v"})[["t", "a", "v"]]
b["yr"], b["mo"] = b.t.dt.year, b.t.dt.month
zz = z[z.yr <= 2022]
res = []
for y in LOYO:
    kk = factors([x for x in LOYO if x != y])
    for d in (zz[zz.yr == y], b[b.yr == y]):
        d = d[(d.a > 0) & (d.v > 0)]
        res.append(pd.DataFrame({"a": d.a.values, "lerr": np.log(d.a.values * d.mo.map(kk).values / d.v.values)}))
res.append(lo[["a", "lerr"]])
res = pd.concat(res)
res["bin"] = pd.cut(res.a, BINS, right=False, labels=BIN_LABELS)
rel = res.groupby("bin", observed=True).lerr.agg(
    n="count", q025=lambda x: x.quantile(.025), q975=lambda x: x.quantile(.975),
    q10=lambda x: x.quantile(.1), q90=lambda x: x.quantile(.9)).reset_index()
rel["likely_low_pct"] = 100 * (np.exp(-rel.q975) - 1)
rel["likely_high_pct"] = 100 * (np.exp(-rel.q025) - 1)
rel["range80_low_pct"] = 100 * (np.exp(-rel.q90) - 1)
rel["range80_high_pct"] = 100 * (np.exp(-rel.q10) - 1)
half = np.maximum(rel.likely_low_pct.abs(), rel.likely_high_pct.abs()) / 100
flag_of = lambda h: next(f for t, f, _ in FLAGS if h <= t)
rel["reliability"] = [flag_of(h) for h in half]
rel["suggestion"] = [next(s for t, _, s in FLAGS if h <= t) for h in half]
rel["aqua_min"] = BINS[:-1]
rel["aqua_max_excl"] = [x if x < 1e12 else None for x in BINS[1:]]
z0 = b[b.a == 0]
P(f"block-months with Aqua=0: {len(z0)}, VIIRS>0 in {100 * (z0.v > 0).mean():.0f}%")
P(rel.drop(columns=["suggestion"]).round(3).to_string())


def band_for(aqua):
    """likely range (low, high) multipliers for an area-month with this many Aqua detections."""
    i = int(np.searchsorted(BINS, aqua, side="right") - 1)
    row = rel.iloc[min(max(i, 0), len(rel) - 1)]
    return 1 + row.likely_low_pct / 100, 1 + row.likely_high_pct / 100, row.reliability


# ---------------- 4. month reference table ----------------
data_end = con.sql("SELECT max(local_date) FROM cellday").fetchall()[0][0]
months = pd.date_range(START, data_end, freq="MS")
vd = con.sql(f"""SELECT satellite, date_trunc('month', local_date)::DATE t, count(*) nd FROM valid
                 WHERE local_date BETWEEN DATE '{START}' AND DATE '{data_end}' GROUP BY ALL""").df()
vd["t"] = pd.to_datetime(vd.t)
valid_days = vd.set_index(["satellite", "t"]).nd
nrt = set(pd.to_datetime(con.sql("""SELECT DISTINCT date_trunc('month', local_date)::DATE FROM cellday
                                    WHERE satellite = 'NOAA-20' AND quality = 'NRT'""").df().iloc[:, 0]))
ref = []
for t in months:
    month_end = date(t.year, t.month, calendar.monthrange(t.year, t.month)[1])
    end = min(month_end, data_end)
    ndays = (end - t.date()).days + 1
    vsat = None if t.year < 2012 else ("Suomi NPP" if t.date() < N20_START else "NOAA-20")
    vcov = valid_days.get((vsat, t), 0) / ndays if vsat else 0
    if vsat and vcov >= MIN_VIIRS_COVERAGE:
        sat, method = vsat, ("provisional_nrt" if t in nrt else "observed_viirs")
    else:
        sat, method = "Aqua", "modelled_aqua"
    cov = valid_days.get((sat, t), 0) / ndays
    ref.append(dict(t=t.date(), year=t.year, month=t.month, ref_sat=sat, viirs_sat=vsat, method=method, coverage=cov,
                    scale=(1 / cov if cov > 0 else None), aqua_cov=valid_days.get(("Aqua", t), 0) / ndays,
                    k=(k[t.month] if method == "modelled_aqua" else None),
                    k_rel_sd=(k_sd[t.month] if method == "modelled_aqua" else None),
                    is_complete=month_end <= data_end))
ref = pd.DataFrame(ref)
P(f"months {ref.t.min()}..{ref.t.max()} ({len(ref)}), data end {data_end}; by method:", ref.method.value_counts().to_dict())
P("low-coverage months (<90%):", ref[ref.coverage < LOW_COVERAGE][["t", "ref_sat", "coverage"]].round(2).to_dict("records"))
con.register("ref_df", ref)
con.sql("CREATE OR REPLACE TEMP TABLE mref AS SELECT * FROM ref_df")

# ---------------- 5. cell x month, 0.1 deg ----------------
con.sql(f"""CREATE OR REPLACE TEMP TABLE cm01 AS
WITH c AS (
  SELECT date_trunc('month', local_date)::DATE t, lat10, lon10,
         coalesce(sum(n) FILTER (WHERE satellite = 'Aqua'), 0) aqua,
         coalesce(sum(n) FILTER (WHERE satellite = 'Suomi NPP'), 0) snpp,
         coalesce(sum(n) FILTER (WHERE satellite = 'NOAA-20'), 0) n20
  FROM cellday WHERE local_date >= DATE '{START}' GROUP BY ALL)
SELECT r.year, r.month, r.t month_start, lat10, lon10, c.aqua modis_hotspots,
       CASE r.viirs_sat WHEN 'Suomi NPP' THEN c.snpp WHEN 'NOAA-20' THEN c.n20 END viirs_hotspots,
       r.ref_sat raw_satellite,
       CASE r.ref_sat WHEN 'Aqua' THEN c.aqua WHEN 'Suomi NPP' THEN c.snpp ELSE c.n20 END raw_count,
       r.method, r.coverage, r.k calibration_ratio, r.k_rel_sd factor_rel_sd, r.is_complete,
       r.method = 'provisional_nrt' is_provisional, r.scale
FROM c JOIN mref r USING (t)
WHERE c.aqua > 0 OR (r.viirs_sat = 'Suomi NPP' AND c.snpp > 0) OR (r.viirs_sat = 'NOAA-20' AND c.n20 > 0)""")
con.sql("""CREATE OR REPLACE TEMP TABLE cm01h AS
SELECT *, raw_count * scale * coalesce(calibration_ratio, 1) harmonized FROM cm01""")
P("cell-months 0.1 deg:", con.sql("SELECT count(*) FROM cm01h").fetchall()[0][0])


def copy(sql, name):
    path = (GOLD / f"{name}.parquet").as_posix()
    con.sql(f"COPY ({sql}) TO '{path}' (FORMAT parquet, COMPRESSION zstd)")
    n = con.sql(f"SELECT count(*) FROM read_parquet('{path}')").fetchall()[0][0]
    P(f"wrote gold/{name}.parquet: {n} rows, {os.path.getsize(path) / 1e6:.2f} MB")


APPSRC = "CASE method " + " ".join(f"WHEN '{m}' THEN '{s}'" for m, s in APP_SOURCE.items()) + " END"
copy(f"""SELECT lat10, lon10, ((lat10 + 0.5) / 10)::DOUBLE lat_center, ((lon10 + 0.5) / 10)::DOUBLE lon_center, year, month, month_start,
  modis_hotspots, viirs_hotspots, raw_satellite, raw_count, round(harmonized, 2) harmonized_cell_days, method,
  {APPSRC} source, is_provisional, is_complete, round(coverage, 3) coverage, round(calibration_ratio, 4) calibration_ratio,
  round(factor_rel_sd, 3) factor_rel_sd, '{STRATUM}' stratum_id
  FROM cm01h ORDER BY year, month, lat10, lon10""", "gold_cell_monthly_01deg")

st = int(round(CELL_RES * 10))
copy(f"""SELECT ((cy + 1000) * 10000 + (cx + 1000))::INT cell_id, cx cell_x, cy cell_y,
  round((cx + 0.5) * {CELL_RES}, 3)::DOUBLE lon_center, round((cy + 0.5) * {CELL_RES}, 3)::DOUBLE lat_center, year, month, month_start,
  sum(modis_hotspots)::INT modis_hotspots, sum(modis_hotspots)::INT modis_cell_days, sum(viirs_hotspots)::INT viirs_hotspots,
  sum(viirs_hotspots)::INT viirs_cell_days, '{STRATUM}' stratum_id, round(any_value(calibration_ratio), 4) calibration_ratio,
  round(sum(harmonized), 1) harmonized_cell_days, {APPSRC} source, any_value(is_provisional) is_provisional,
  method, round(any_value(coverage), 3) coverage, any_value(raw_satellite) raw_satellite, sum(raw_count)::INT raw_count,
  any_value(is_complete) is_complete
  FROM (SELECT *, floor(lat10 / {st})::INT cy, floor(lon10 / {st})::INT cx FROM cm01h)
  GROUP BY cx, cy, year, month, month_start, method ORDER BY year, month, cell_id""", "gold_cell_monthly")

# ---------------- 6. region x month ----------------
parts = []
for rid, (_, cond) in REGIONS.items():
    parts.append(con.sql(f"""SELECT '{rid}' region_id, t month_start, coalesce(sum(h.harmonized), 0) harmonized,
        coalesce(sum(h.modis_hotspots), 0) aqua_raw, sum(h.viirs_hotspots) viirs_raw, coalesce(sum(h.raw_count), 0) raw_count
        FROM mref r LEFT JOIN (SELECT * FROM cm01h WHERE {cond}) h ON h.month_start = r.t GROUP BY ALL""").df())
rm = pd.concat(parts)
rm["month_start"] = pd.to_datetime(rm.month_start)
rm = rm.merge(ref.rename(columns={"t": "month_start"}).assign(month_start=lambda d: pd.to_datetime(d.month_start)), on="month_start")
rm["aqua_equiv"] = rm.aqua_raw / rm.aqua_cov.where(rm.aqua_cov > 0)       # coverage-scaled Aqua count in the area-month
rm.loc[(rm.method != "modelled_aqua") & rm.viirs_raw.isna(), "viirs_raw"] = 0
rm["viirs_raw"] = rm.viirs_raw.where(rm.viirs_sat.notna())
ins = (rm.method == "modelled_aqua") & (rm.aqua_raw == 0)
rm.loc[ins, "method"] = "insufficient_data"
rm.loc[ins, "harmonized"] = np.nan
lowm, highm, flag = [], [], []
for rid, mth, a in zip(rm.region_id, rm.method, rm.aqua_equiv):
    if mth == "modelled_aqua":
        l, h, f = band_for(a)
        if rid == "argentina":
            l, h = BAND
            f = flag_of(max(1 - l, h - 1))
        lowm.append(l); highm.append(h); flag.append(f)
    elif mth == "insufficient_data":
        lowm.append(np.nan); highm.append(np.nan); flag.append("indicative_only")
    else:
        lowm.append(1.0); highm.append(1.0); flag.append("reliable")
rm["harmonized_low"] = rm.harmonized * np.array(lowm)
rm["harmonized_high"] = rm.harmonized * np.array(highm)
rm["reliability"] = flag


def stats(g, years, methods):
    s = g[g.year.between(*years) & g.method.isin(methods) & g.is_complete].harmonized.dropna()
    return s


out = []
for (rid, mo), g in rm.groupby(["region_id", "month"]):
    bd = stats(g, BASE_DEFAULT, ["modelled_aqua", "observed_viirs"])
    bv = stats(g, BASE_VIIRS, ["observed_viirs"])
    peers = g[g.is_complete & g.harmonized.notna() & (g.method != "provisional_nrt")].harmonized
    for i, row in g.iterrows():
        o = {}
        # A2 rule: provisional (NRT) and incomplete months show the value only, never an anomaly, rank or percentile.
        ok = bool(row.is_complete) and row.method != "provisional_nrt" and pd.notna(row.harmonized)
        o["anomaly_status"] = ("provisional" if row.method == "provisional_nrt" else "incomplete" if not row.is_complete
                               else "insufficient_data" if row.method == "insufficient_data" else "ok")
        md, mv = bd.median(), bv.median()
        o["baseline_id"] = f"harmonized_{BASE_DEFAULT[0]}_{BASE_DEFAULT[1]}"
        o["baseline_median"], o["baseline_mean"] = md, bd.mean()
        o["baseline_p25"], o["baseline_p75"] = bd.quantile(.25), bd.quantile(.75)
        o["baseline_min"], o["baseline_max"] = bd.min(), bd.max()
        o["baseline_n_years"] = len(bd)
        o["baseline_viirs_median"], o["baseline_viirs_mean"], o["baseline_viirs_n_years"] = mv, bv.mean(), len(bv)
        o["anomaly_ratio"] = row.harmonized / md if ok and md > 0 else np.nan
        o["anomaly_diff"] = row.harmonized - md if ok else np.nan
        o["anomaly_class"] = cls(o["anomaly_ratio"])
        o["anomaly_ratio_viirs"] = row.harmonized / mv if ok and mv > 0 else np.nan
        o["anomaly_class_viirs"] = cls(o["anomaly_ratio_viirs"])
        o["anomaly_class_stable"] = (cls(row.harmonized_low / md) == cls(row.harmonized_high / md)) if ok and md > 0 else None
        o["rank_in_month"] = int((peers > row.harmonized).sum() + 1) if ok else None
        o["percentile_rank"] = 100 * (peers <= row.harmonized).mean() if ok else np.nan
        o["n_years_ranked"] = len(peers)
        out.append(pd.Series(o, name=i))
rm = rm.join(pd.DataFrame(out))
rm["harmonized_cell_days"] = rm.harmonized
rm["modis_cell_days"] = rm.aqua_raw
rm["viirs_cell_days"] = rm.viirs_raw
rm["source"] = rm.method.map(APP_SOURCE)
rm["is_provisional"] = rm.method == "provisional_nrt"
rm["likely_low_pct"] = 100 * (rm.harmonized_low / rm.harmonized - 1)
rm["likely_high_pct"] = 100 * (rm.harmonized_high / rm.harmonized - 1)
REGION_COLS = ["region_id", "year", "month", "month_start", "harmonized_cell_days", "modis_cell_days", "viirs_cell_days",
               "source", "is_complete", "is_provisional", "baseline_median", "baseline_mean", "baseline_p25", "baseline_p75",
               "baseline_min", "baseline_max", "anomaly_ratio", "anomaly_diff", "anomaly_class", "percentile_rank",
               "rank_in_month", "n_years_ranked",
               # added honesty / method fields
               "method", "coverage", "reliability", "harmonized_low", "harmonized_high", "likely_low_pct", "likely_high_pct",
               "anomaly_class_stable", "raw_count", "ref_sat", "aqua_equiv", "baseline_id", "baseline_n_years",
               "baseline_viirs_median", "baseline_viirs_mean", "baseline_viirs_n_years", "anomaly_ratio_viirs",
               "anomaly_class_viirs", "anomaly_status"]
rmo = rm[REGION_COLS].rename(columns={"ref_sat": "raw_satellite"}).sort_values(["region_id", "month_start"]).reset_index(drop=True)
rmo["month_start"] = rmo.month_start.dt.date
for c_ in ["harmonized_cell_days", "harmonized_low", "harmonized_high", "baseline_median", "baseline_mean", "baseline_p25",
           "baseline_p75", "baseline_min", "baseline_max", "anomaly_diff", "baseline_viirs_median", "baseline_viirs_mean", "aqua_equiv"]:
    rmo[c_] = rmo[c_].round(1)
for c_ in ["anomaly_ratio", "anomaly_ratio_viirs", "coverage", "percentile_rank", "likely_low_pct", "likely_high_pct"]:
    rmo[c_] = rmo[c_].astype(float).round(3)
for c_ in ["rank_in_month", "n_years_ranked", "baseline_n_years", "baseline_viirs_n_years", "modis_cell_days", "viirs_cell_days", "raw_count"]:
    rmo[c_] = rmo[c_].astype("Int64")
rmo["anomaly_class_stable"] = rmo.anomaly_class_stable.astype("boolean")
con.register("rmo", rmo)
copy("SELECT * FROM rmo", "gold_region_monthly")

# ---------------- 7. region x year ----------------
ann = []
for rid, g in rm.groupby("region_id"):
    yrs = []
    for y, gy in g.groupby("year"):
        gy = gy.sort_values("month")
        tot = gy.harmonized.sum(skipna=True)
        n_insuff = int((gy.method == "insufficient_data").sum())
        complete = len(gy) == 12 and bool(gy.is_complete.all()) and n_insuff == 0   # a year with blank months is partial
        methods = set(gy.method)
        mth = (methods.pop() if len(methods) == 1 else ("provisional_nrt" if "provisional_nrt" in methods else "mixed"))
        mod = gy[gy.method == "modelled_aqua"]
        if len(mod):
            l, h, _ = band_for(mod.aqua_equiv.sum())
            l, h = min(l, BAND_YEAR[0]), max(h, BAND_YEAR[1])
            if rid == "argentina":
                l, h = BAND_YEAR
            mod_tot = mod.harmonized.sum()
            low, high = tot - mod_tot * (1 - l), tot + mod_tot * (h - 1)
        else:
            low = high = tot
        cum = gy.harmonized.fillna(0).cumsum() / tot if tot > 0 else pd.Series([np.nan] * len(gy), index=gy.index)
        pick = lambda q: int(gy.month[cum >= q].iloc[0]) if tot > 0 else None
        s0, s1, s2 = pick(.1), pick(.5), pick(.9)
        pk = gy.loc[gy.harmonized.fillna(-1).idxmax()]
        yrs.append(dict(region_id=rid, year=y, harmonized_cell_days=round(tot, 1), peak_month=int(pk.month),
                        peak_month_cell_days=round(pk.harmonized, 1), season_start_month=s0, season_midpoint_month=s1,
                        season_end_month=s2, season_length_months=(s2 - s0 + 1) if tot > 0 else None,
                        months_available=int((gy.is_complete & gy.harmonized.notna()).sum()), is_complete=complete,
                        is_partial=(not complete),
                        method=mth, harmonized_low=round(low, 1), harmonized_high=round(high, 1),
                        months_insufficient=int((gy.method == "insufficient_data").sum())))
    yd = pd.DataFrame(yrs)
    comp = yd[yd.is_complete]
    base = comp[comp.year.between(*BASE_DEFAULT)].harmonized_cell_days.median()
    yd["rank"] = yd.harmonized_cell_days.where(yd.is_complete).rank(ascending=False, method="min").astype("Int64")
    yd["n_years_ranked"] = len(comp)
    yd["anomaly_ratio"] = (yd.harmonized_cell_days / base).round(3).where(yd.is_complete)   # partial years get no anomaly
    ann.append(yd)
ann = pd.concat(ann)
ANN_COLS = ["region_id", "year", "harmonized_cell_days", "rank", "n_years_ranked", "anomaly_ratio", "peak_month",
            "peak_month_cell_days", "season_start_month", "season_midpoint_month", "season_end_month", "season_length_months",
            "months_available", "is_complete", "method", "harmonized_low", "harmonized_high", "months_insufficient", "is_partial"]
ann = ann[ANN_COLS]
for c_ in ["season_start_month", "season_midpoint_month", "season_end_month", "season_length_months"]:
    ann[c_] = ann[c_].astype("Int64")
con.register("ann", ann)
copy("SELECT * FROM ann ORDER BY region_id, year", "gold_region_annual")

# ---------------- 8. headline ----------------
last = rm[rm.is_complete & (rm.method != "provisional_nrt")].month_start.max()
prov_last = rm[rm.method == "provisional_nrt"].month_start.max()
hl = []
for rid, (name, _) in REGIONS.items():
    g = rm[rm.region_id == rid]
    row = g[g.month_start == last].iloc[0]
    mname = calendar.month_name[last.month]
    prov = " (provisional, near-real-time data)" if row.method == "provisional_nrt" else ""
    ytd = g[(g.year == last.year) & (g.month <= last.month)].harmonized.sum()
    past = [g[(g.year == y) & (g.month <= last.month)].harmonized.sum() for y in range(BASE_DEFAULT[0], BASE_DEFAULT[1] + 1)]
    ytd_med = float(np.median(past))
    if pd.notna(row.anomaly_ratio):
        head = (f"{mname} {last.year}{prov}: {row.anomaly_ratio:.1f}x the usual {mname}, "
                f"rank {int(row.rank_in_month)} of {int(row.n_years_ranked)}.")
    else:
        head = f"{mname} {last.year}{prov}: no usual level to compare against."
    prow = g[g.month_start == prov_last].iloc[0]
    alt = (f"{name} in {mname} {last.year} has {row.harmonized:,.0f} VIIRS-equivalent fire detections. {head} "
           f"Year to date: {ytd / ytd_med:.1f}x the {BASE_DEFAULT[0]}-{BASE_DEFAULT[1]} median for January to {mname}. "
           f"Latest month, {calendar.month_name[prov_last.month]} {prov_last.year}, is provisional: {prow.harmonized:,.0f} detections so far, "
           f"not yet compared with earlier years.")
    hl.append(dict(region_id=rid, as_of_month=last.date(), headline=head, alt_text=alt,
                   month_anomaly_ratio=round(row.anomaly_ratio, 3), month_rank_in_month=row.rank_in_month,
                   ytd_cell_days=round(ytd, 1), ytd_vs_median=round(ytd / ytd_med, 3) if ytd_med else None,
                   top_analog_year=None, method=row.method, region_name=name,
                   latest_provisional_month=prov_last.date(), latest_provisional_value=round(prow.harmonized, 1)))
hl = pd.DataFrame(hl)
hl["month_rank_in_month"] = hl.month_rank_in_month.astype("Int64")
hl["top_analog_year"] = hl.top_analog_year.astype("Int64")
con.register("hl", hl)
copy("SELECT * FROM hl", "gold_region_headline")
for h_ in hl.headline:
    P("  headline:", h_)

# ---------------- 9. calibration ----------------
fa = fitm.groupby("mo")[["a", "v"]].sum()
e1m = e1.assign(ape=lambda d: 100 * np.abs(d.p / d.v - 1)).groupby("mo").ape.mean()
cal = pd.DataFrame({"stratum_id": STRATUM, "month": k.index, "ratio": k.values.round(4),
                    "modis_cell_days_fit": fa.a.values.astype(int), "viirs_cell_days_fit": fa.v.values.astype(int),
                    "n_months": fitm.groupby("mo").size().values, "fit_start": date(2012, 1, 1), "fit_end": date(2019, 12, 31),
                    "holdout_mape": e1m.reindex(k.index).values.round(2), "viirs_sensor": "viirs_snpp",
                    "method_version": METHOD_VERSION, "factor_rel_sd": k_sd.reindex(k.index).values.round(4),
                    "holdout_years": "2020-2022", "modis_satellite": "Aqua",
                    "likely_low_pct": round(100 * (BAND[0] - 1), 1), "likely_high_pct": round(100 * (BAND[1] - 1), 1)})
con.register("cal", cal)
copy("SELECT * FROM cal", "gold_calibration")

# ---------------- 10. reliability + accuracy ----------------
relo = rel[["bin", "aqua_min", "aqua_max_excl", "n", "likely_low_pct", "likely_high_pct", "range80_low_pct",
            "range80_high_pct", "reliability", "suggestion"]].rename(columns={"bin": "size_bin", "n": "n_area_months"})
relo["size_bin"] = relo.size_bin.astype(str)
for c_ in ["likely_low_pct", "likely_high_pct", "range80_low_pct", "range80_high_pct"]:
    relo[c_] = relo[c_].round(1)
relo["applies_to"] = "modelled_aqua months only; observed VIIRS months are always reliable"
con.register("relo", relo)
copy("SELECT * FROM relo", "gold_reliability")

acc = pd.DataFrame([
    ("median_monthly_error_pct", 100 * E1S["mdape"], "%", "Half of the converted months were within {v:.1f}% of what VIIRS actually measured."),
    ("p90_monthly_error_pct", 100 * E1S["p90"], "%", "Nine converted months in ten were within {v:.1f}% of the VIIRS measurement."),
    ("worst_annual_error_pct", 100 * E1S["annual_max"], "%", "Converted annual totals were never more than {v:.1f}% off."),
    ("mean_bias_pct", 100 * E1S["bias"], "%", "On average the conversion came out {a:.1f}% {d} than VIIRS in the test years."),
    ("likely_range_coverage_pct", 100 * E1S["coverage"], "%", "The likely range contained the true VIIRS value in {v:.0f}% of test months."),
    ("likely_range_low_pct", 100 * (BAND[0] - 1), "%", "At country scale the true value is likely (about 85% chance) to be no more than {v:.0f}% below the converted value."),
    ("likely_range_high_pct", 100 * (BAND[1] - 1), "%", "At country scale the true value is likely (about 85% chance) to be no more than {v:.0f}% above the converted value."),
    ("anomaly_agreement_country_pct", 100 * agree5, "%", "Using the calendar's five colour classes, converted and measured months matched {v:.0f}% of the time (whole country, held-out years)."),
], columns=["metric", "value", "unit", "statement"])
acc["statement"] = [s.format(v=abs(v) if "low_pct" in m else v, a=abs(v), d="lower" if v < 0 else "higher")
                    for m, v, s in zip(acc.metric, acc.value, acc.statement)]
acc["value"] = acc.value.astype(float).round(1)
acc["test_period"] = "2020-01 to 2022-12 (held out; factors fitted on 2012-2019)"
acc["source"] = "E1 test (11_method_test.py, 14_build_gold.py)"
acc["method_version"] = METHOD_VERSION
acc["computed_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
con.register("acc", acc)
copy("SELECT * FROM acc", "gold_accuracy")
for s_ in acc.statement:
    P("  kpi:", s_)

# ---------------- 11. consistency checks ----------------
c1 = con.sql("""SELECT max(abs(a - b)) FROM (SELECT year, month, sum(harmonized) a FROM cm01h GROUP BY ALL)
                JOIN (SELECT year, month, harmonized_cell_days b FROM rmo WHERE region_id = 'argentina')
                USING (year, month)""").fetchall()[0][0]
c2 = con.sql(f"""SELECT max(abs(a - b)) FROM (SELECT year, month, sum(harmonized_cell_days) a
                 FROM read_parquet('{(GOLD / 'gold_cell_monthly.parquet').as_posix()}') GROUP BY ALL)
                JOIN (SELECT year, month, harmonized_cell_days b FROM rmo WHERE region_id = 'argentina') USING (year, month)""").fetchall()[0][0]
P(f"check: 0.1deg cells sum to country month, max abs diff {c1:.2f}; {CELL_RES}deg cells, max abs diff {c2:.2f} (rounding)")
nn = con.sql("SELECT count(*) FROM rmo WHERE isnan(harmonized_cell_days) OR isnan(anomaly_ratio)").fetchall()[0][0]
P(f"check: NaN values in region table (must be 0, nulls are fine): {nn}")
(HERE / "data" / "14_build_gold.txt").write_text("\n".join(log) + "\n", encoding="utf-8")

if "--upload" in sys.argv:
    # Upload through DuckDB (own TLS handling; boto3 fails on networks that re-sign HTTPS). Re-writes each Parquet file.
    import os as _os
    con.sql(f"""CREATE OR REPLACE SECRET r2 (TYPE r2, KEY_ID '{_os.environ["R2_KEY_ID"]}',
        SECRET '{_os.environ["R2_SECRET"]}', ACCOUNT_ID '{_os.environ["CF_ACCOUNT_ID"]}')""")
    for p in sorted(GOLD.glob("*.parquet")):
        con.sql(f"COPY (SELECT * FROM read_parquet('{p.as_posix()}')) TO 'r2://firms-data/gold/{p.name}' (FORMAT parquet, COMPRESSION zstd)")
        print(f"uploaded gold/{p.name}")
