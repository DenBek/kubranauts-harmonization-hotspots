"""Spot checks for the published fire-calendar data (Argentina MVP). Prints PASS / FAIL / SKIP with the numbers.

Run from the repo root after every data change:

    python scripts/verify_app_data.py                         # local JSON in harmonization/argentina/gold/publish
    python scripts/verify_app_data.py --url https://dev.kubranauts-hotspots.pages.dev   # what the site serves
    python scripts/verify_app_data.py --dir some/folder       # any folder of <table>.json files

Five groups of checks:
  1. raw        Recompute chosen region-months from the local DuckDB (harmonization/argentina/data/argentina.duckdb)
                with SQL written here, independently of 14_build_gold.py. SKIP if the DuckDB file is absent.
  2. internal   Sums, baselines, anomaly ratios and classes, ranks, percentiles, reliability flags, likely ranges.
  3. events     Known Argentine fire events rank near the top of their calendar month.
  4. boundary   2012 seam, modelled/measured switch, no MODIS conversion after 2012-01, provisional months.
  5. contract   Published accuracy and calibration figures match the documented ones (gold/README.md).

The expected numbers are the documented method (harmonization/argentina/gold/README.md); the script never changes data.
Exit code 1 if any check fails.
"""
import argparse
import calendar
import json
import math
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_JSON = ROOT / "harmonization" / "argentina" / "gold" / "publish"
LOCAL_DB = ROOT / "harmonization" / "argentina" / "data" / "argentina.duckdb"
TABLES = ["gold_region_monthly", "gold_region_annual", "gold_cell_monthly", "gold_reliability", "gold_accuracy",
          "gold_calibration", "gold_region_headline"]

# ---- documented method constants (gold/README.md, SCOPE_AND_GAPS.md D-8, D-10, D-11, D-19) ----
FACTORS = {1: 6.53, 2: 6.67, 3: 6.18, 4: 5.52, 5: 4.70, 6: 4.13, 7: 4.00, 8: 4.16, 9: 5.00, 10: 5.56, 11: 6.20, 12: 6.59}
COUNTRY_BAND = (-20.9, 23.2)          # likely range, whole country, one modelled month (%)
ACCURACY = {"median_monthly_error_pct": 9.5, "p90_monthly_error_pct": 19.0, "worst_annual_error_pct": 8.9,
            "mean_bias_pct": -7.2, "likely_range_coverage_pct": 86.1, "anomaly_agreement_country_pct": 88.9,
            "likely_range_low_pct": -20.9, "likely_range_high_pct": 23.2}
CLASS_CUTS = [(0.5, "much_below"), (0.8, "below"), (1.2, "normal"), (1.8, "above")]   # ratio < 0.5, < 0.8, <= 1.2, <= 1.8
FLAG_CUTS = [(0.30, "reliable"), (0.40, "good"), (0.65, "caution"), (math.inf, "indicative_only")]
FIT_YEARS = range(2012, 2020)
BASE_DEFAULT = (2003, 2022)
BASE_VIIRS = (2012, 2025)
FIRST_VIIRS_MONTH = (2012, 2)         # Jan 2012 is modelled (Suomi NPP covers 12 of 31 days)
N20_START = (2018, 4)
FIRST_NRT_MONTH = (2026, 8)
ZONES = ["ar_ne", "ar_nw", "ar_c", "ar_s"]
# Region boxes on lat10/lon10 (0.1 deg cell floor), written from the README table, not copied from the build script.
REGION_SQL = {
    "argentina": "TRUE",
    "ar_ne": "lat10 > -350 AND lon10 > -605",
    "ar_nw": "lat10 > -300 AND lon10 <= -605",
    "ar_c": "lat10 > -390 AND lat10 <= -300 AND NOT (lat10 > -350 AND lon10 > -605)",
    "ar_s": "lat10 <= -390",
    "ar_delta": "lat10 >= -345 AND lat10 <= -321 AND lon10 >= -610 AND lon10 <= -584",
}
# Region-months recomputed from raw: (region, year, month, why)
RAW_CASES = [
    ("argentina", 2010, 9, "modelled from Aqua, whole country"),
    ("argentina", 2012, 1, "seam month, still modelled"),
    ("ar_ne", 2015, 2, "measured, Suomi NPP"),
    ("argentina", 2020, 9, "measured, NOAA-20, big fire year"),
    ("argentina", 2023, 7, "measured, low coverage (84%), scaled for gap days"),
    ("argentina", 2026, 9, "provisional, near real time"),
    ("ar_delta", 2008, 4, "modelled, small area, known event"),
    ("ar_s", 2005, 7, "modelled, small area (Patagonia winter)"),
]
DRAW_CELL = (-33, -61)                 # 1 deg cell (floor lat, floor lon) used by the Draw page's "small area" example

results = []


def report(group, name, ok, detail):
    status = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
    results.append((group, status))
    print(f"[{status}] {group:8s} {name}: {detail}", flush=True)


def ym(r):
    return (r["year"], r["month"])


def missing(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def cls(ratio):
    if missing(ratio):
        return None
    for cut, name in CLASS_CUTS:
        if (ratio < cut) if cut < 1 else (ratio <= cut + 1e-9):
            return name
    return "much_above"


# ---------------- loading ----------------

def load(args):
    out = {}
    for t in TABLES:
        if args.url:
            req = urllib.request.Request(f"{args.url.rstrip('/')}/api/gold/{t}", headers={"User-Agent": "kubranauts-verify/1.0"})
            with urllib.request.urlopen(req, timeout=180) as f:
                d = json.load(f)
        else:
            d = json.loads((Path(args.dir) / f"{t}.json").read_text(encoding="utf-8"))
        out[t] = d
        print(f"loaded {t}: {len(d.get('rows', []))} rows, source={d.get('source', 'file')}")
    return out


# ---------------- 1. recompute from raw ----------------

def check_raw(T):
    group = "raw"
    if not LOCAL_DB.exists():
        report(group, "recompute from the local DuckDB", None, f"{LOCAL_DB} not found (rebuild with 02 -> 05 -> 07)")
        return
    import duckdb
    con = duckdb.connect(str(LOCAL_DB), read_only=True)
    data_end = con.sql("SELECT max(local_date) FROM cellday").fetchall()[0][0]

    # factors: VIIRS (Suomi NPP) / Aqua on days valid for both, fit years 2012-2019, fire filter already in cellday.n
    fac = dict(con.sql(f"""
        WITH both_ AS (SELECT local_date FROM valid WHERE satellite = 'Aqua'
                       INTERSECT SELECT local_date FROM valid WHERE satellite = 'Suomi NPP'),
        d AS (SELECT month(local_date) mo, satellite, sum(n) n FROM cellday JOIN both_ USING (local_date)
              WHERE year(local_date) BETWEEN {FIT_YEARS[0]} AND {FIT_YEARS[-1]} AND satellite IN ('Aqua', 'Suomi NPP')
              GROUP BY ALL)
        SELECT mo, sum(n) FILTER (WHERE satellite = 'Suomi NPP') / sum(n) FILTER (WHERE satellite = 'Aqua') FROM d GROUP BY mo
    """).fetchall())
    pub = {r["month"]: r["ratio"] for r in T["gold_calibration"]["rows"]}
    worst = max(abs(fac[m] - pub[m]) for m in range(1, 13))
    report(group, "12 month factors recomputed from cellday", worst < 0.001,
           f"max |recomputed - published| = {worst:.5f}; Sep {fac[9]:.3f}, Jul {fac[7]:.3f}, Feb {fac[2]:.3f}")

    monthly = {(r["region_id"], r["year"], r["month"]): r for r in T["gold_region_monthly"]["rows"]}
    for rid, y, m, why in RAW_CASES:
        start = date(y, m, 1)
        end = min(date(y, m, calendar.monthrange(y, m)[1]), data_end)
        ndays = (end - start).days + 1
        if (y, m) < FIRST_VIIRS_MONTH:
            sat, k = "Aqua", fac[m]
        else:
            sat, k = ("Suomi NPP" if (y, m) < N20_START else "NOAA-20"), 1.0
        n = con.sql(f"""SELECT coalesce(sum(n), 0) FROM cellday WHERE satellite = '{sat}' AND {REGION_SQL[rid]}
                        AND local_date BETWEEN DATE '{start}' AND DATE '{end}'""").fetchall()[0][0]
        nvalid = con.sql(f"""SELECT count(*) FROM valid WHERE satellite = '{sat}'
                             AND local_date BETWEEN DATE '{start}' AND DATE '{end}'""").fetchall()[0][0]
        mine = n * (ndays / nvalid) * k
        row = monthly.get((rid, y, m))
        shown = row["harmonized_cell_days"] if row else None
        ok = shown is not None and abs(mine - shown) <= max(0.5, 0.001 * shown)
        report(group, f"{rid} {y}-{m:02d} ({why})", ok,
               f"{sat} raw {n:,} x {ndays}/{nvalid} valid days x factor {k:.3f} = {mine:,.1f}; app shows "
               f"{shown if shown is None else f'{shown:,.1f}'} ({row['method'] if row else 'no row'})")

    # Draw page: one 1-degree cell, September 2010
    cy, cx = DRAW_CELL
    y, m = 2010, 9
    n = con.sql(f"""SELECT coalesce(sum(n), 0) FROM cellday WHERE satellite = 'Aqua'
        AND lat10 BETWEEN {cy * 10} AND {cy * 10 + 9} AND lon10 BETWEEN {cx * 10} AND {cx * 10 + 9}
        AND year(local_date) = {y} AND month(local_date) = {m}""").fetchall()[0][0]
    nvalid = con.sql(f"SELECT count(*) FROM valid WHERE satellite = 'Aqua' AND year(local_date) = {y} AND month(local_date) = {m}").fetchall()[0][0]
    mine = n * 30 / nvalid * fac[m]
    cell = [r for r in T["gold_cell_monthly"]["rows"] if r["lat_center"] == cy + 0.5 and r["lon_center"] == cx + 0.5 and r["year"] == y and r["month"] == m]
    shown = cell[0]["harmonized_cell_days"] if cell else 0.0
    report(group, f"Draw page 1-degree cell lat {cy}..{cy + 1}, lon {cx}..{cx + 1}, {y}-{m:02d}", abs(mine - shown) <= 0.5,
           f"Aqua raw {n} -> {mine:.1f}; cell table {shown}")


# ---------------- 2. internal consistency ----------------

def check_internal(T):
    group = "internal"
    M = T["gold_region_monthly"]["rows"]
    by_region = defaultdict(list)
    for r in M:
        by_region[r["region_id"]].append(r)
    key = {(r["region_id"], r["year"], r["month"]): r for r in M}

    # zones sum to the country
    worst, n = 0.0, 0
    for r in by_region["argentina"]:
        parts = [key[(z, r["year"], r["month"])]["harmonized_cell_days"] for z in ZONES]
        if any(missing(p) for p in parts) or missing(r["harmonized_cell_days"]):
            continue
        worst = max(worst, abs(sum(parts) - r["harmonized_cell_days"]))
        n += 1
    report(group, "NE + NW + Centre + Patagonia = Argentina, every month", worst <= 0.5, f"{n} months, max diff {worst:.2f}")

    # 1-degree map cells sum to the country
    cells = defaultdict(float)
    ncell = defaultdict(int)
    for c in T["gold_cell_monthly"]["rows"]:
        if not missing(c["harmonized_cell_days"]):
            cells[ym(c)] += c["harmonized_cell_days"]
            ncell[ym(c)] += 1
    diffs = [abs(cells[ym(r)] - r["harmonized_cell_days"]) for r in by_region["argentina"] if not missing(r["harmonized_cell_days"])]
    tol = 0.05 * max(ncell.values())        # each cell is rounded to 0.1
    report(group, "map cells (1 deg) sum to the Argentina month", max(diffs) <= tol,
           f"max diff {max(diffs):.2f} detections (rounding tolerance {tol:.1f})")

    # year totals = sum of the months
    worst = 0.0
    for a in T["gold_region_annual"]["rows"]:
        s = sum(r["harmonized_cell_days"] for r in by_region[a["region_id"]] if r["year"] == a["year"] and not missing(r["harmonized_cell_days"]))
        worst = max(worst, abs(s - a["harmonized_cell_days"]))
    report(group, "year totals = sum of the monthly values", worst <= 1.0, f"{len(T['gold_region_annual']['rows'])} region-years, max diff {worst:.2f}")

    # baselines, anomaly ratios, classes, ranks, percentiles
    bad = defaultdict(list)
    for rid, rows in by_region.items():
        for mo in range(1, 13):
            g = [r for r in rows if r["month"] == mo]
            base = [r["harmonized_cell_days"] for r in g if BASE_DEFAULT[0] <= r["year"] <= BASE_DEFAULT[1]
                    and r["is_complete"] and r["method"] in ("modelled_aqua", "observed_viirs") and not missing(r["harmonized_cell_days"])]
            basev = [r["harmonized_cell_days"] for r in g if BASE_VIIRS[0] <= r["year"] <= BASE_VIIRS[1]
                     and r["is_complete"] and r["method"] == "observed_viirs"]
            peers = [r["harmonized_cell_days"] for r in g if r["anomaly_status"] == "ok"]
            med, medv = statistics.median(base), statistics.median(basev)
            for r in g:
                tag = f"{rid} {r['year']}-{mo:02d}"
                if abs(r["baseline_median"] - med) > 0.15:
                    bad["baseline median"].append(f"{tag}: {r['baseline_median']} vs {med:.1f}")
                if abs(r["baseline_viirs_median"] - medv) > 0.15:
                    bad["VIIRS-only baseline median"].append(f"{tag}: {r['baseline_viirs_median']} vs {medv:.1f}")
                if r["anomaly_status"] != "ok":
                    continue
                v = r["harmonized_cell_days"]
                if abs(r["anomaly_ratio"] - v / med) > 0.002 * max(1, v / med):
                    bad["anomaly ratio = value / median"].append(f"{tag}: {r['anomaly_ratio']} vs {v / med:.3f}")
                # class from value / median, not from the rounded ratio (0.4996 is published as 0.5 but is "much below")
                if r["anomaly_class"] != cls(v / med):
                    bad["anomaly class from 0.5/0.8/1.2/1.8"].append(f"{tag}: {r['anomaly_class']} vs {cls(v / med)}")
                # ties: published values are rounded to 0.1, so accept any rank inside the tie range
                hi = sum(p > v + 0.05 for p in peers) + 1
                lo = sum(p > v - 0.05 for p in peers)
                if not (hi <= r["rank_in_month"] <= max(lo, hi)):
                    bad["rank in calendar month"].append(f"{tag}: {r['rank_in_month']} vs {hi}..{lo}")
                if r["n_years_ranked"] != len(peers):
                    bad["number of years ranked"].append(f"{tag}: {r['n_years_ranked']} vs {len(peers)}")
                pmin = 100 * sum(p < v - 0.05 for p in peers) / len(peers)
                pmax = 100 * sum(p <= v + 0.05 for p in peers) / len(peers)
                if not (pmin - 0.01 <= r["percentile_rank"] <= pmax + 0.01):
                    bad["percentile"].append(f"{tag}: {r['percentile_rank']} vs {pmin:.1f}..{pmax:.1f}")
    for name in ["baseline median", "VIIRS-only baseline median", "anomaly ratio = value / median",
                 "anomaly class from 0.5/0.8/1.2/1.8", "rank in calendar month", "number of years ranked", "percentile"]:
        b = bad.get(name, [])
        report(group, name + " (recomputed)", not b, f"{len(b)} mismatches" + (f", e.g. {b[:3]}" if b else ""))

    # reliability flags and likely ranges
    rel = sorted(T["gold_reliability"]["rows"], key=lambda r: r["aqua_min"])
    for r in rel:
        half = max(abs(r["likely_low_pct"]), abs(r["likely_high_pct"])) / 100
        expect = next(f for cut, f in FLAG_CUTS if half <= cut)
        if expect != r["reliability"]:
            bad["reliability table"].append(f"{r['size_bin']}: {r['reliability']} vs {expect}")
    report(group, "reliability table flags follow the 30/40/65% half-width rule", not bad.get("reliability table"),
           "; ".join(f"{r['size_bin']} {r['reliability']} ({r['likely_low_pct']:+.0f}/{r['likely_high_pct']:+.0f}%)" for r in rel))

    flag_bad, range_bad = [], []
    for r in M:
        tag = f"{r['region_id']} {r['year']}-{r['month']:02d}"
        v = r["harmonized_cell_days"]
        if r["method"] in ("observed_viirs", "provisional_nrt"):
            if r["reliability"] != "reliable":
                flag_bad.append(f"{tag} measured but {r['reliability']}")
            if not missing(v) and (abs(r["harmonized_low"] - v) > 0.05 or abs(r["harmonized_high"] - v) > 0.05):
                range_bad.append(f"{tag} measured but range {r['harmonized_low']}-{r['harmonized_high']}")
        elif r["method"] == "modelled_aqua":
            if r["region_id"] == "argentina":
                lo_pct, hi_pct, flag = COUNTRY_BAND[0], COUNTRY_BAND[1], "reliable"
            else:
                aqua = r["modis_cell_days"] / r["coverage"]
                b = [x for x in rel if aqua >= x["aqua_min"]][-1]
                lo_pct, hi_pct, flag = b["likely_low_pct"], b["likely_high_pct"], b["reliability"]
            if r["reliability"] != flag:
                flag_bad.append(f"{tag}: {r['reliability']} vs {flag} (Aqua {r['modis_cell_days']})")
            # the range is computed before the value is rounded to 0.1, so allow 0.05 x multiplier, plus the range's own rounding
            fl, fh = 1 + lo_pct / 100, 1 + hi_pct / 100
            if abs(r["harmonized_low"] - v * fl) > 0.05 * fl + 0.06 + 0.001 * v or abs(r["harmonized_high"] - v * fh) > 0.05 * fh + 0.06 + 0.001 * v:
                range_bad.append(f"{tag}: {r['harmonized_low']}-{r['harmonized_high']} vs {lo_pct:+}/{hi_pct:+}%")
        elif r["method"] == "insufficient_data":
            if r["reliability"] != "indicative_only":
                flag_bad.append(f"{tag} insufficient but {r['reliability']}")
    n_mod = sum(r["method"] == "modelled_aqua" for r in M)
    report(group, "reliability flag per region-month (measured = reliable; modelled = Aqua-count bin)", not flag_bad,
           f"{len(flag_bad)} mismatches of {len(M)} rows" + (f", e.g. {flag_bad[:3]}" if flag_bad else ""))
    report(group, "likely range per region-month (measured = the value; modelled = band)", not range_bad,
           f"{len(range_bad)} mismatches; {n_mod} modelled rows checked" + (f", e.g. {range_bad[:3]}" if range_bad else ""))

    # headline
    hl_bad = []
    last_ok = max(ym(r) for r in by_region["argentina"] if r["anomaly_status"] == "ok")
    for h in T["gold_region_headline"]["rows"]:
        r = key[(h["region_id"], *last_ok)]
        if str(h["as_of_month"])[:7] != f"{last_ok[0]}-{last_ok[1]:02d}" or abs(h["month_anomaly_ratio"] - r["anomaly_ratio"]) > 0.001:
            hl_bad.append(h["region_id"])
    report(group, "headline sentence uses the latest compared month", not hl_bad,
           f"as of {last_ok[0]}-{last_ok[1]:02d}" + (f"; wrong: {hl_bad}" if hl_bad else ""))

    nan = sum(1 for r in M for k, v in r.items() if isinstance(v, float) and math.isnan(v))
    neg = sum(1 for r in M if not missing(r["harmonized_cell_days"]) and r["harmonized_cell_days"] < 0)
    report(group, "no NaN and no negative values", nan == 0 and neg == 0, f"NaN {nan}, negative {neg}")


# ---------------- 3. known events ----------------

def check_events(T):
    group = "events"
    key = {(r["region_id"], r["year"], r["month"]): r for r in T["gold_region_monthly"]["rows"]}
    cases = [  # region, year, month, max rank expected, label
        ("ar_delta", 2008, 4, 1, "Parana Delta fires, April 2008"),
        ("ar_delta", 2020, 8, 1, "Parana Delta, August 2020"),
        ("ar_delta", 2020, 9, 5, "Parana Delta, September 2020"),
        ("ar_delta", 2020, 10, 3, "Parana Delta, October 2020"),
        ("ar_c", 2020, 8, 2, "Centre (Cordoba), August 2020"),
        ("ar_c", 2020, 9, 2, "Centre (Cordoba), September 2020"),
        ("ar_c", 2020, 10, 2, "Centre (Cordoba), October 2020"),
        ("ar_ne", 2022, 1, 1, "Corrientes (north-east), January 2022"),
        ("ar_ne", 2022, 2, 1, "Corrientes (north-east), February 2022"),
    ]
    for rid, y, m, best, label in cases:
        r = key[(rid, y, m)]
        ok = r["rank_in_month"] is not None and r["rank_in_month"] <= best and r["anomaly_class"] == "much_above"
        report(group, label, ok, f"rank {r['rank_in_month']} of {r['n_years_ranked']}, {r['anomaly_ratio']}x usual "
               f"({r['harmonized_cell_days']:,.0f} vs median {r['baseline_median']:,.1f}), {r['anomaly_class']}, {r['method']}")
    a = {(x["region_id"], x["year"]): x for x in T["gold_region_annual"]["rows"]}
    r = a[("argentina", 2020)]
    report(group, "2020 is the busiest complete year for Argentina", r["rank"] == 1,
           f"rank {r['rank']} of {r['n_years_ranked']}, {r['harmonized_cell_days']:,.0f} detections")
    big = sorted((r for r in T["gold_region_monthly"]["rows"] if not missing(r["anomaly_ratio"]) and r["anomaly_ratio"] > 10),
                 key=lambda r: -r["anomaly_ratio"])
    report(group, "months shown as 'more than 10x' (exact ratio only in the CSV)", True,
           f"{len(big)} region-months; top: " + ", ".join(f"{r['region_id']} {r['year']}-{r['month']:02d} {r['anomaly_ratio']:.1f}x" for r in big[:3]))


# ---------------- 4. boundaries ----------------

def check_boundary(T):
    group = "boundary"
    M = T["gold_region_monthly"]["rows"]

    def expected(r):
        if ym(r) < FIRST_VIIRS_MONTH:
            return {"modelled_aqua", "insufficient_data"}, "Aqua"
        if ym(r) < FIRST_NRT_MONTH:
            return {"observed_viirs"}, "Suomi NPP" if ym(r) < N20_START else "NOAA-20"
        return {"provisional_nrt"}, "NOAA-20"
    bad = [f"{r['region_id']} {r['year']}-{r['month']:02d} {r['method']}/{r['raw_satellite']}" for r in M
           if r["method"] not in expected(r)[0] or r["raw_satellite"] != expected(r)[1]]
    report(group, "method and satellite by period (Aqua to 2012-01, Suomi NPP to 2018-03, NOAA-20, NRT from 2026-08)", not bad,
           f"{len(bad)} rows off" + (f", e.g. {bad[:3]}" if bad else ""))
    after = [r for r in M if r["year"] > 2022 and r["method"] == "modelled_aqua"]
    report(group, "no MODIS conversion after 2022 (in fact none after 2012-01)", not after, f"{len(after)} converted rows after 2022")
    cal_cells = [c for c in T["gold_cell_monthly"]["rows"] if (c["method"] == "modelled_aqua") != (c["calibration_ratio"] is not None)]
    report(group, "map cells carry a factor only in converted months", not cal_cells, f"{len(cal_cells)} cells off")

    meas_bad = [r for r in M if r["method"] in ("observed_viirs", "provisional_nrt")
                # coverage is published to 3 decimals, so allow 0.0005 / coverage relative error
                and abs(r["harmonized_cell_days"] - r["raw_count"] / r["coverage"]) > 0.0006 * r["raw_count"] / r["coverage"] ** 2 + 0.06]
    report(group, "measured months = raw VIIRS count / valid-day coverage (no factor)", not meas_bad,
           f"{len(meas_bad)} off" + (f", e.g. {[(r['region_id'], ym(r)) for r in meas_bad[:3]]}" if meas_bad else ""))

    A = {r["year"]: r for r in T["gold_region_annual"]["rows"] if r["region_id"] == "argentina"}
    raw = defaultdict(int)
    for r in M:
        if r["region_id"] == "argentina":
            raw[r["year"]] += r["raw_count"] or 0
    jr, jh = raw[2012] / raw[2011], A[2012]["harmonized_cell_days"] / A[2011]["harmonized_cell_days"]
    report(group, "2012 seam: raw record jumps, harmonized does not", jr > 3 and 0.6 < jh < 1.4,
           f"raw 2011->2012 x{jr:.2f} ({raw[2011]:,} -> {raw[2012]:,}); harmonized x{jh:.2f} "
           f"({A[2011]['harmonized_cell_days']:,.0f} -> {A[2012]['harmonized_cell_days']:,.0f})")

    nulls = ["anomaly_ratio", "anomaly_diff", "anomaly_class", "rank_in_month", "percentile_rank", "anomaly_ratio_viirs", "anomaly_class_viirs"]
    prov = [r for r in M if r["anomaly_status"] != "ok"]
    leak = [f"{r['region_id']} {r['year']}-{r['month']:02d} {k}" for r in prov for k in nulls if not missing(r.get(k))]
    months = sorted({f"{r['year']}-{r['month']:02d}:{r['anomaly_status']}" for r in prov})
    report(group, "provisional / in-progress / no-estimate months carry no anomaly, rank or percentile", not leak,
           f"{len(prov)} rows ({', '.join(months)}); leaks: {leak[:3] if leak else 'none'}")
    okrows = [r for r in M if r["anomaly_status"] == "ok"]
    gaps = [r for r in okrows if any(missing(r.get(k)) for k in ["anomaly_ratio", "anomaly_class", "rank_in_month"])]
    report(group, "every compared month has ratio, class and rank", not gaps, f"{len(okrows)} rows, {len(gaps)} incomplete")
    ins = [r for r in M if r["method"] == "insufficient_data"]
    report(group, "no-estimate months are blank, never zero", all(missing(r["harmonized_cell_days"]) for r in ins),
           ", ".join(f"{r['region_id']} {r['year']}-{r['month']:02d}" for r in ins) or "none")
    part = [r for r in T["gold_region_annual"]["rows"] if r["is_partial"]]
    report(group, "partial years (in progress or with a blank month) have no rank or anomaly",
           all(r["rank"] is None and missing(r["anomaly_ratio"]) for r in part),
           ", ".join(sorted({f"{r['region_id']} {r['year']}" for r in part})))


# ---------------- 5. published figures ----------------

def check_contract(T):
    group = "contract"
    acc = {r["metric"]: r for r in T["gold_accuracy"]["rows"]}
    bad = [f"{k}: {acc[k]['value'] if k in acc else 'missing'} vs {v}" for k, v in ACCURACY.items()
           if k not in acc or abs(acc[k]["value"] - v) > 0.11]
    held = all("held out" in r["test_period"] for r in acc.values())
    report(group, "accuracy panel = documented held-out figures (2020-2022)", not bad and held and len(acc) == 8,
           f"{len(acc)} rows, all held-out: {held}; " + (", ".join(bad) if bad else ", ".join(f"{k.replace('_pct', '')} {acc[k]['value']}" for k in ACCURACY)))
    cal = {r["month"]: r for r in T["gold_calibration"]["rows"]}
    bad = [f"{m}: {cal[m]['ratio']}" for m, v in FACTORS.items() if abs(cal[m]["ratio"] - v) > 0.006]
    fit = {(str(r["fit_start"])[:4], str(r["fit_end"])[:4]) for r in cal.values()}
    report(group, "12 month factors and fit years 2012-2019", not bad and fit == {("2012", "2019")},
           f"fit {fit}; " + ("mismatch " + ", ".join(bad) if bad else " ".join(f"{cal[m]['ratio']:.2f}" for m in range(1, 13))))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="site base URL, e.g. https://dev.kubranauts-hotspots.pages.dev")
    ap.add_argument("--dir", default=str(LOCAL_JSON), help="folder with <table>.json (default: local publish folder)")
    ap.add_argument("--skip-raw", action="store_true", help="do not recompute from the local DuckDB")
    args = ap.parse_args()
    T = load(args)
    print()
    if args.skip_raw:
        report("raw", "recompute from the local DuckDB", None, "--skip-raw")
    else:
        check_raw(T)
    check_internal(T)
    check_events(T)
    check_boundary(T)
    check_contract(T)
    n = defaultdict(int)
    for _, s in results:
        n[s] += 1
    print(f"\n{n['PASS']} PASS, {n['FAIL']} FAIL, {n['SKIP']} SKIP")
    sys.exit(1 if n["FAIL"] else 0)


if __name__ == "__main__":
    main()
