"""Step 5: honest test of the simplest method. Prespecified before running (see findings log section 5):

Quantity: fire-filtered detection count, day+night, per month (decided in step 3 on 2012-2019 only).
Target:   VIIRS reference count (Suomi NPP; NOAA-20 as second target where available).
Inputs:   Aqua monthly count (Terra for the Terra-only bridge).
Methods:
  M0 global ratio        target = k * aqua, k = sum(V)/sum(A) over fit years
  M1 month ratio         k_m per calendar month (country)
  M2 zone x month ratio  k_{z,m} per zone and month; country prediction = sum of zone predictions
Designs:
  E1 fit 2012-2019, test 2020-2022 (unseen, pre-drift)
  E2 fit 2012-2019, test 2023-2025 (unseen, Aqua drifting) -- shows how far forward a conversion holds
  E3 leave-one-year-out over 2012-2022 -> residual spread -> prediction interval; coverage checked on E1/E2
Months compared only on days valid for both satellites (no gap days), so no gap correction enters the test.
"""
import numpy as np
import pandas as pd
from common import connect_local, PLOTS, DATA
from plotstyle import plt, COL
from pairs import pair

con = connect_local()
ZONES = ["NE", "NW", "C", "S"]


def P(*x):
    print(*x, flush=True)


def load(a="Aqua", b="Suomi NPP", y0=2012, y1=2025, q="n"):
    z = pd.concat([pair(con, a, b, "A", zone=zz, y0=y0, y1=y1).assign(zone=zz) for zz in ZONES])
    z = z.rename(columns={f"{q}_a": "a", f"{q}_b": "v"})[["t", "zone", "a", "v"]]
    z["yr"], z["mo"] = z.t.dt.year, z.t.dt.month
    return z


def fit_predict(z, fit_years, method):
    f = z[z.yr.isin(fit_years)]
    if method == "M0":
        k = f.v.sum() / f.a.sum()
        return z.a * k
    if method == "M1":
        cm = f.groupby("mo")[["v", "a"]].sum()
        return z.a * z.mo.map(cm.v / cm.a)
    if method == "M2":
        g = f.groupby(["zone", "mo"])[["v", "a"]].sum()
        k = (g.v / g.a).rename("k")
        return z.a * z.join(k, on=["zone", "mo"]).k


def country(z, pred):
    c = z.assign(p=pred).groupby(["t", "yr", "mo"])[["a", "v", "p"]].sum().reset_index()
    return c


def score(c, label):
    le = np.log(c.p / c.v)
    yr = c.groupby("yr")[["v", "p"]].sum()
    yle = np.log(yr.p / yr.v)
    return dict(test=label, months=len(c), bias_pct=100 * (np.exp(le.mean()) - 1), mdape=100 * np.median(np.abs(c.p / c.v - 1)),
                rmse_log=np.sqrt((le ** 2).mean()), p90_abs_pct=100 * np.quantile(np.abs(c.p / c.v - 1), 0.9),
                annual_bias_pct=100 * (np.exp(yle.mean()) - 1), annual_max_abs_pct=100 * np.max(np.abs(yr.p / yr.v - 1)))


z = load()
FIT = range(2012, 2020)
rows, preds = [], {}
for mth in ["M0", "M1", "M2"]:
    p = fit_predict(z, FIT, mth)
    c = country(z, p)
    preds[mth] = c
    for lab, yrs in [("in-sample 2012-19", FIT), ("E1 2020-22", range(2020, 2023)), ("E2 2023-25", range(2023, 2026))]:
        rows.append(dict(method=mth, **score(c[c.yr.isin(yrs)], lab)))
res = pd.DataFrame(rows).round(3)
P("== country level, target Suomi NPP (counts, D+N, monthly) ==")
P(res.to_string(), "\n")

# zone-level skill (M1 applied with country month factor vs M2)
P("== zone level, E1 2020-22: median abs % error and bias per zone ==")
zr = []
for mth in ["M1", "M2"]:
    p = fit_predict(z, FIT, mth)
    d = z.assign(p=p)
    d = d[d.yr.between(2020, 2022) & (d.v > 0)]
    for zz, g in d.groupby("zone"):
        le = np.log(g.p / g.v)
        zr.append(dict(method=mth, zone=zz, bias_pct=100 * (np.exp(le.mean()) - 1), mdape=100 * np.median(np.abs(g.p / g.v - 1)),
                       rmse_log=np.sqrt((le ** 2).mean())))
P(pd.DataFrame(zr).round(2).to_string(), "\n")

# second target NOAA-20 (fit on SNPP factors, test 2020-22: is the SNPP-trained factor valid for N20?)
zn = load(b="NOAA-20", y0=2019, y1=2025)
k1 = z[z.yr.isin(FIT)].groupby("mo")[["v", "a"]].sum()
pn = zn.a * zn.mo.map(k1.v / k1.a)
cn = country(zn, pn)
P("== target NOAA-20 using SNPP-trained M1 ==")
P(pd.DataFrame([score(cn[cn.yr.between(2020, 2022)], "E1 2020-22"), score(cn[cn.yr.between(2023, 2025)], "E2 2023-25")]).round(3).to_string(), "\n")

# E3 LOYO 2012-2022 with M1 -> interval
P("== E3 leave-one-year-out 2012-2022, M1, country ==")
lo = []
for y in range(2012, 2023):
    fy = [x for x in range(2012, 2023) if x != y]
    c = country(z, fit_predict(z, fy, "M1"))
    lo.append(c[c.yr == y])
lo = pd.concat(lo)
lo["lerr"] = np.log(lo.p / lo.v)
s = lo.lerr.std()
P(f"LOYO monthly log-error sd {s:.3f}, mean {lo.lerr.mean():.3f}, bias {100*(np.exp(lo.lerr.mean())-1):.1f}%")
P("LOYO per-year bias %:", (100 * (np.exp(lo.groupby("yr").lerr.mean()) - 1)).round(1).to_dict())
q10, q90 = lo.lerr.quantile([0.1, 0.9])
q025, q975 = lo.lerr.quantile([0.025, 0.975])
P(f"empirical 80% interval on ratio pred/actual: {np.exp(q10):.3f}-{np.exp(q90):.3f}; 95%: {np.exp(q025):.3f}-{np.exp(q975):.3f}")
c1 = preds["M1"]
for lab, yrs in [("E1 2020-22", range(2020, 2023)), ("E2 2023-25", range(2023, 2026))]:
    d = c1[c1.yr.isin(yrs)]
    lo80, hi80 = d.p / np.exp(q90), d.p / np.exp(q10)
    lo95, hi95 = d.p / np.exp(q975), d.p / np.exp(q025)
    P(f"{lab}: 80% interval coverage {100*((d.v>=lo80)&(d.v<=hi80)).mean():.0f}%, 95% coverage {100*((d.v>=lo95)&(d.v<=hi95)).mean():.0f}%  (n={len(d)})")

# uncertainty vs area size: LOYO residual sd at zone and 2deg block level by Aqua count bin
P("\n== uncertainty vs activity: LOYO (2012-2022) monthly log-error sd by Aqua monthly count bin, M1 factors applied to zones and 2deg blocks ==")
b = pair(con, "Aqua", "Suomi NPP", "A", zone=None, y0=2012, y1=2022, table="daily_blk", extra_group="blat, blon")
b = b.rename(columns={"n_a": "a", "n_b": "v"})[["t", "blat", "blon", "a", "v"]]
b["yr"], b["mo"] = b.t.dt.year, b.t.dt.month
zz = z[z.yr <= 2022][["t", "zone", "a", "v", "yr", "mo"]]
allr = []
for y in range(2012, 2023):
    f = z[(z.yr != y) & (z.yr <= 2022)].groupby("mo")[["v", "a"]].sum()
    k = f.v / f.a
    for lev, d in [("zone", zz[zz.yr == y]), ("blk", b[b.yr == y])]:
        d = d[(d.a > 0) & (d.v > 0)]
        allr.append(pd.DataFrame({"lev": lev, "a": d.a.values, "lerr": np.log(d.a.values * d.mo.map(k).values / d.v.values)}))
allr.append(pd.DataFrame({"lev": "country", "a": lo.a.values, "lerr": lo.lerr.values}))
allr = pd.concat(allr)
bins = [0, 5, 20, 50, 200, 1000, 5000, 1e9]
allr["bin"] = pd.cut(allr.a, bins, right=False)
tab = allr.groupby("bin", observed=True).lerr.agg(["count", "mean", "std", lambda x: x.quantile(.1), lambda x: x.quantile(.9)])
tab.columns = ["n", "mean_log_err", "sd_log_err", "p10", "p90"]
tab["ratio_80pct_lo"], tab["ratio_80pct_hi"] = np.exp(-tab.p90), np.exp(-tab.p10)
P(tab.round(3).to_string())
tab.to_csv(DATA / "11_uncertainty_by_count.csv")
z0 = b[(b.a == 0)]
P(f"\nblock-months with Aqua = 0: {len(z0)}; of those VIIRS > 0: {(z0.v > 0).sum()}; median VIIRS when Aqua=0: {z0[z0.v>0].v.median()}, p90 {z0[z0.v>0].v.quantile(.9)}")

# Terra bridge: predict SNPP from Terra directly vs chained Terra->Aqua->SNPP. Fit 2012-2019, test 2020-2021 (pre Terra drift).
P("\n== Terra bridge (for Nov 2000 - Jun 2002), test 2020-2021 ==")
zt = load(a="Terra", b="Suomi NPP", y0=2012, y1=2021)
ct = zt[zt.yr.isin(FIT)].groupby("mo")[["v", "a"]].sum()
p_direct = country(zt, zt.a * zt.mo.map(ct.v / ct.a))
ta = load(a="Terra", b="Aqua", y0=2003, y1=2021)
kta = ta[ta.yr.between(2003, 2011)].groupby("mo")[["v", "a"]].sum()
p_chain = country(zt, zt.a * zt.mo.map(kta.v / kta.a) * zt.mo.map(k1.v / k1.a))
P(pd.DataFrame([score(p_direct[p_direct.yr.isin([2020, 2021])], "Terra direct"),
                score(p_chain[p_chain.yr.isin([2020, 2021])], "Terra chained via Aqua (fit 2003-11)")]).round(3).to_string())
lot = []
for y in range(2012, 2022):
    f = zt[(zt.yr != y)].groupby("mo")[["v", "a"]].sum()
    d = country(zt[zt.yr == y], zt[zt.yr == y].a * zt[zt.yr == y].mo.map(f.v / f.a))
    lot.append(np.log(d.p / d.v))
lot = pd.concat(lot)
P(f"Terra direct LOYO 2012-2021 monthly log-error sd {lot.std():.3f} (vs Aqua {s:.3f}); 80% ratio interval {np.exp(-lot.quantile(.9)):.3f}-{np.exp(-lot.quantile(.1)):.3f}")

# save factors and LOYO residual quantiles for the record
k_final = z[z.yr.between(2012, 2022)].groupby("mo")[["v", "a"]].sum()
fac = pd.DataFrame({"k_snpp_over_aqua_fit2012_19": k1.v / k1.a, "k_fit2012_22": k_final.v / k_final.a,
                    "k_snpp_over_terra_fit2012_19": ct.v / ct.a})
P("\n== month factors ==\n", fac.round(3).to_string())
fac.to_csv(DATA / "11_month_factors.csv")

# ---- plot: country monthly actual vs predicted (M1), 2012-2025, with 80% band; and error by year ----
fig, ax = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True)
c = preds["M1"]
ax[0].fill_between(c.t, c.p / np.exp(q90), c.p / np.exp(q10), color=COL["Aqua"], alpha=0.25, lw=0, label="80% interval (from LOYO)")
ax[0].plot(c.t, c.v, color=COL["Suomi NPP"], label="Suomi NPP measured")
ax[0].plot(c.t, c.p, color=COL["Aqua"], ls="--", lw=1.2, label="Aqua × month factor (fit 2012–19)")
ax[0].set_yscale("log"); ax[0].legend(loc="upper left", ncol=3)
ax[0].set_title("Argentina monthly fire detections: measured VIIRS vs MODIS converted (M1)", loc="left")
for a_ in ax:
    a_.axvspan(pd.Timestamp("2012-01-01"), pd.Timestamp("2019-12-31"), color="#f3f3f3", zorder=0)
    a_.axvline(pd.Timestamp("2023-01-01"), color=COL["other"], ls=":", lw=1)
ax[1].bar(c.t, 100 * (c.p / c.v - 1), width=25, color=np.where(c.yr <= 2019, COL["other"], COL["Terra"]))
ax[1].axhline(0, color="#333", lw=0.8)
ax[1].set_ylabel("error %, predicted vs measured")
ax[1].set_title("Monthly error (grey = fit years, blue = unseen years; dotted line = start of Aqua drift)", loc="left")
fig.tight_layout(); fig.savefig(PLOTS / "06_method_test.png")

fig, ax = plt.subplots(figsize=(6, 3.6))
tt = tab.reset_index()
ax.plot(range(len(tt)), 100 * (tt.ratio_80pct_hi - 1), marker="o", color=COL["Terra"], label="80% upper (actual above pred)")
ax.plot(range(len(tt)), 100 * (tt.ratio_80pct_lo - 1), marker="o", color=COL["Aqua"], label="80% lower")
ax.set_xticks(range(len(tt)), ["<5", "5-19", "20-49", "50-199", "200-999", "1k-5k", ">=5k"], fontsize=8)
ax.axhline(0, color="#333", lw=0.8)
ax.set_xlabel("Aqua detections in the area-month"); ax.set_ylabel("actual vs predicted, %")
ax.set_title("Conversion uncertainty shrinks with activity (LOYO)", loc="left")
ax.legend(fontsize=7)
fig.tight_layout(); fig.savefig(PLOTS / "07_uncertainty_vs_count.png")
P("plots saved")
