"""Step 3: compare candidate quantities on the SELECTION period only (SNPP vs Aqua, 2012-2019).
2020-2025 are held out for step 5 and are NOT looked at here.

Quantities: n (detections), frp (sum MW), celldays (0.1deg cell-days with >=1 det), cells25 (0.25deg cell-days).
Day/night: A (both) and D (day only).
Levels: ALL (country), zone (4 boxes), blk (2deg blocks).

Metrics (all on months where Aqua > 0 unless noted):
  resid_sd   sd of log(VIIRS/Aqua) after removing calendar-month mean (what a month-factor cannot explain)
  slope      OLS slope of log VIIRS on log Aqua with calendar-month intercepts (1 = pure scale factor)
  yr_sd      sd of the annual log ratio (year-to-year stability)
  anom_rho   Spearman rank corr of monthly anomaly (value / median of same calendar month) between sensors
  class_agr  % months where both sensors give the same anomaly class (below p25 / normal / above p75 of own history)
  zero_mis   % of unit-months where Aqua = 0 but VIIRS > 0 (ratio method cannot recover these)
"""
import numpy as np
import pandas as pd
from common import connect_local, DATA
from pairs import pair, QTY

con = connect_local()
Y0, Y1 = 2012, 2019


def P(*x):
    print(*x, flush=True)


def slope_with_month(la, lb, mo):
    X = np.column_stack([la] + [(mo == k).astype(float) for k in sorted(set(mo))])
    beta = np.linalg.lstsq(X, lb, rcond=None)[0]
    return beta[0]


def metrics(df, unit_cols):
    df = df.copy()
    df["mo"] = df.t.dt.month
    df["yr"] = df.t.dt.year
    out = {}
    for q in QTY:
        a, b = df[f"{q}_a"], df[f"{q}_b"]
        ok = (a > 0) & (b > 0)
        d = df[ok]
        lr = np.log(d[f"{q}_b"] / d[f"{q}_a"])
        resid = lr - lr.groupby([d[c] for c in unit_cols + ["mo"]]).transform("mean")
        yr = d.groupby(unit_cols + ["yr"])[[f"{q}_a", f"{q}_b"]].sum()
        ylr = np.log(yr[f"{q}_b"] / yr[f"{q}_a"])
        ysd = ylr.groupby(level=unit_cols).std().mean() if unit_cols else ylr.std()
        sl = slope_with_month(np.log(d[f"{q}_a"].values), np.log(d[f"{q}_b"].values), d["mo"].values)

        def anom(col):
            med = df.groupby(unit_cols + ["mo"])[col].transform("median")
            return df[col] / med.replace(0, np.nan)
        an_a, an_b = anom(f"{q}_a"), anom(f"{q}_b")
        okk = an_a.notna() & an_b.notna()
        rho = an_a[okk].rank().corr(an_b[okk].rank())

        def cls(s):
            g = s.groupby([df[c] for c in unit_cols + ["mo"]])
            lo, hi = g.transform(lambda x: x.quantile(.25)), g.transform(lambda x: x.quantile(.75))
            return np.where(s < lo, -1, np.where(s > hi, 1, 0))
        ca, cb = cls(df[f"{q}_a"]), cls(df[f"{q}_b"])
        out[q] = dict(resid_sd=resid.std(), slope=sl, yr_sd=ysd, anom_rho=rho,
                      class_agr=100 * (ca == cb).mean(), zero_mis=100 * ((a == 0) & (b > 0)).mean(), n_units=len(df))
    return pd.DataFrame(out).T.round(3)


res = {}
for dn in ["A", "D"]:
    res[("ALL", dn)] = metrics(pair(con, "Aqua", "Suomi NPP", dn, zone="ALL", y0=Y0, y1=Y1), [])
    z = pd.concat([pair(con, "Aqua", "Suomi NPP", dn, zone=zz, y0=Y0, y1=Y1).assign(zone=zz)
                   for zz in ["NE", "NW", "C", "S"]])
    res[("zone", dn)] = metrics(z, ["zone"])
    b = pair(con, "Aqua", "Suomi NPP", dn, zone=None, y0=Y0, y1=Y1, table="daily_blk", extra_group="blat, blon")
    # complete the block x month grid so zero months count (blocks with any fire in the period)
    grid = b[["blat", "blon"]].drop_duplicates().merge(pd.DataFrame({"t": sorted(b.t.unique())}), how="cross")
    b = grid.merge(b, on=["blat", "blon", "t"], how="left").fillna(0)
    b["blk"] = b.blat.astype(str) + "_" + b.blon.astype(str)
    big = b.groupby("blk").n_a.sum()
    b = b[b.blk.isin(big[big >= 200].index)]  # blocks with >=200 Aqua detections in 2012-2019
    res[("blk", dn)] = metrics(b, ["blk"])

for k, v in res.items():
    P(f"== level {k[0]}, daynight {k[1]} (SNPP vs Aqua, {Y0}-{Y1}) ==")
    P(v.to_string(), "\n")
pd.concat(res, names=["level", "dn", "qty"]).to_csv(DATA / "09_quantities.csv")

P("== heavy tails: share of monthly total FRP from the single largest cell-day max detection (median over months, ALL, A) ==")
P(con.sql(f"""WITH m AS (SELECT satellite, date_trunc('month', local_date) t, sum(frp) tot, max(frp_max) mx
   FROM cellday WHERE year(local_date) BETWEEN {Y0} AND {Y1} GROUP BY ALL)
   SELECT satellite, round(median(mx/tot),3) med_share_top, round(quantile_cont(mx/tot,0.9),3) p90_share FROM m GROUP BY 1 ORDER BY 1""").df().to_string())
