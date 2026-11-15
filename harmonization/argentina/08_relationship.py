"""Step 2: relationship between sensors where they overlap (Argentina). Output: data/08_relationship.txt + plots."""
import numpy as np
import pandas as pd
from common import connect_local, PLOTS
from plotstyle import plt, COL
from pairs import pair, QTY

con = connect_local()


def P(*x):
    print(*x, flush=True)


def rs(df, q):  # ratio of sums b/a
    return df[f"{q}_b"].sum() / df[f"{q}_a"].sum()


P("== A. pooled ratio of sums, by pair, period, day/night ==")
rows = []
for a, b, y0, y1 in [("Aqua", "Suomi NPP", 2012, 2022), ("Aqua", "NOAA-20", 2019, 2022), ("Aqua", "Suomi NPP", 2023, 2025),
                     ("Aqua", "NOAA-20", 2023, 2026), ("NOAA-20", "Suomi NPP", 2019, 2025), ("Terra", "Aqua", 2003, 2021),
                     ("Terra", "Aqua", 2022, 2026), ("Terra", "Suomi NPP", 2012, 2021)]:
    for dn in ["A", "D", "N"]:
        df = pair(con, a, b, dn, y0=y0, y1=y1, by="month")
        rows.append(dict(pair=f"{b}/{a}", years=f"{y0}-{y1}", dn=dn, **{q: round(rs(df, q), 3) for q in QTY}))
P(pd.DataFrame(rows).to_string(), "\n")

# monthly SNPP vs Aqua 2012-2022 pre-drift, D+N, all quantities
m = pair(con, "Aqua", "Suomi NPP", "A", y0=2012, y1=2022)
m["yr"], m["mo"] = m.t.dt.year, m.t.dt.month
P("== B. monthly log-ratio spread (SNPP/Aqua, 2012-2022, months with Aqua n>=50) ==")
mm = m[m.n_a >= 50].copy()
for q in QTY:
    lr = np.log(mm[f"{q}_b"] / mm[f"{q}_a"])
    P(f"{q:9s} geo-mean ratio {np.exp(lr.mean()):.3f}  sd(log) {lr.std():.3f}  "
      f"IQR ratio {np.exp(lr.quantile(.25)):.2f}-{np.exp(lr.quantile(.75)):.2f}  n_months {len(lr)}")
P(f"months dropped (Aqua n<50): {(m.n_a < 50).sum()} of {len(m)}\n")

P("== C. ratio of sums by calendar month (SNPP/Aqua 2012-2022, D+N) with year-to-year spread ==")
cm = []
for mo, g in m.groupby("mo"):
    row = {"mo": mo, "aqua_n": int(g.n_a.sum())}
    for q in ["n", "frp", "celldays"]:
        yr = g[g.n_a >= 50]
        r = yr[f"{q}_b"] / yr[f"{q}_a"]
        row[q] = round(rs(g, q), 2)
        row[q + "_yr_sd_log"] = round(np.log(r).std(), 2) if len(r) > 2 else np.nan
    cm.append(row)
P(pd.DataFrame(cm).to_string(), "\n")

P("== D. annual ratio of sums by zone (SNPP/Aqua, D+N) ==")
zz = []
for z in ["NE", "NW", "C", "S", "ALL"]:
    d = pair(con, "Aqua", "Suomi NPP", "A", zone=z, y0=2012, y1=2025, by="year")
    for q in ["n", "frp", "celldays"]:
        s = (d[f"{q}_b"] / d[f"{q}_a"]).round(2)
        s.index = d.t.dt.year
        zz.append(s.rename(f"{z}_{q}"))
P(pd.concat(zz, axis=1).T.to_string(), "\n")
P("zone pooled 2012-2022:")
for z in ["NE", "NW", "C", "S"]:
    d = pair(con, "Aqua", "Suomi NPP", "A", zone=z, y0=2012, y1=2022, by="year")
    P(z, {q: round(rs(d, q), 2) for q in QTY}, "aqua_n", int(d.n_a.sum()))

P("\n== E. fire size: monthly ratios vs Aqua FRP/detection, Aqua detections per cell-day, Aqua n (2012-2022, Aqua n>=50) ==")
mm = mm.assign(r=mm.n_b / mm.n_a, frp_per=mm.frp_a / mm.n_a, clus=mm.n_a / mm.celldays_a,
               rf=mm.frp_b / mm.frp_a, rc=mm.celldays_b / mm.celldays_a)
for c in ["frp_per", "clus", "n_a"]:
    P(f"spearman with {c}: count ratio {mm.r.rank().corr(mm[c].rank()):.2f}; "
      f"frp ratio {mm.rf.rank().corr(mm[c].rank()):.2f}; cellday ratio {mm.rc.rank().corr(mm[c].rank()):.2f}")
mm["clus_bin"] = pd.qcut(mm.clus, 4)
P(mm.groupby("clus_bin", observed=True)[["r", "rf", "rc"]].median().round(2).to_string())
mm["size_bin"] = pd.qcut(mm.n_a, 4)
P(mm.groupby("size_bin", observed=True)[["r", "rf", "rc"]].median().round(2).to_string())

P("\n== F. drift: annual ratios by day/night ==")
for dn in ["D", "N"]:
    for b in ["Suomi NPP", "NOAA-20"]:
        d = pair(con, "Aqua", b, dn, y0=2012, y1=2026, by="year")
        P(dn, b, "/Aqua n  ", dict(zip(d.t.dt.year, (d.n_b / d.n_a).round(2))))
        P(dn, b, "/Aqua FRP", dict(zip(d.t.dt.year, (d.frp_b / d.frp_a).round(2))))
d = pair(con, "Terra", "Aqua", "D", y0=2003, y1=2026, by="year")
P("D Aqua/Terra n", dict(zip(d.t.dt.year, (d.n_b / d.n_a).round(2))))
d = pair(con, "Terra", "NOAA-20", "D", y0=2018, y1=2026, by="year")
P("D N20/Terra n", dict(zip(d.t.dt.year, (d.n_b / d.n_a).round(2))))

P("\n== G. edge-of-swath share of fire detections (MODIS scan>2km, VIIRS scan>0.6km) ==")
P(con.sql("""SELECT satellite, round(100*sum(n_edge)/sum(n),1) pct_edge,
             round(sum(area_sum)/sum(n),3) mean_px_area_km2 FROM cellday GROUP BY 1""").df().to_string())

# ---------- plots ----------
fig, ax = plt.subplots(1, 3, figsize=(13, 4.3))
for i, q in enumerate(["n", "frp", "celldays"]):
    h = m.assign(r=np.log2(m[f"{q}_b"] / m[f"{q}_a"]).where(m.n_a >= 50)).pivot(index="yr", columns="mo", values="r")
    c = np.nanmean(h.values)
    im = ax[i].imshow(h - c, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    ax[i].set_xticks(range(12), list("JFMAMJJASOND"))
    ax[i].set_yticks(range(len(h)), h.index)
    ax[i].set_title(f"{q}: SNPP/Aqua, log2 ratio minus mean\n(mean ratio {2**c:.2f}; blank = Aqua n<50)", loc="left", fontsize=9)
    ax[i].grid(False)
fig.colorbar(im, ax=ax, shrink=0.8, label="log2 deviation (±1 = 2× higher/lower)")
fig.savefig(PLOTS / "02_ratio_heatmap.png", bbox_inches="tight")

fig, ax = plt.subplots(1, 3, figsize=(13, 4.2))
zc = {"NE": COL["Terra"], "NW": COL["Aqua"], "C": COL["Suomi NPP"], "S": COL["NOAA-20"]}
for z in zc:
    d = pair(con, "Aqua", "Suomi NPP", "A", zone=z, y0=2012, y1=2022)
    d = d[d.n_a > 0]
    for i, q in enumerate(["n", "frp", "celldays"]):
        ax[i].scatter(d[f"{q}_a"], d[f"{q}_b"], s=10, alpha=0.6, color=zc[z], label=z, edgecolors="none")
for i, q in enumerate(["n", "frp", "celldays"]):
    ax[i].set_xscale("log")
    ax[i].set_yscale("log")
    lo, hi = ax[i].get_xlim()
    xs = np.logspace(np.log10(max(lo, 0.1)), np.log10(hi), 10)
    ax[i].plot(xs, xs, color=COL["other"], ls="--", lw=1, label="1:1")
    ax[i].set_xlabel(f"Aqua {q} per month")
    ax[i].set_ylabel(f"Suomi NPP {q} per month")
    ax[i].set_title(f"{q}, zone x month, 2012-2022", loc="left")
ax[0].legend(title="zone")
fig.tight_layout()
fig.savefig(PLOTS / "03_scatter_zone.png")

fig, ax = plt.subplots(1, 2, figsize=(11, 3.8))
for dn, ls in [("D", "-"), ("N", ":")]:
    for b in ["Suomi NPP", "NOAA-20"]:
        d = pair(con, "Aqua", b, dn, y0=2012, y1=2026, by="year")
        ax[0].plot(d.t.dt.year, d.n_b / d.n_a, ls=ls, color=COL[b], marker="o", ms=3, label=f"{b}/Aqua {dn}")
        ax[1].plot(d.t.dt.year, d.frp_b / d.frp_a, ls=ls, color=COL[b], marker="o", ms=3, label=f"{b}/Aqua {dn}")
ax[0].set_title("Count ratio VIIRS/Aqua by year (day solid, night dotted)", loc="left")
ax[1].set_title("FRP ratio VIIRS/Aqua by year", loc="left")
for a_ in ax:
    a_.set_yscale("log")
    a_.axvspan(2022.5, 2026.5, color="#f0f0f0", zorder=0)
    a_.text(2022.7, a_.get_ylim()[1] * 0.8, "Aqua drift", fontsize=8)
ax[0].legend(fontsize=7, ncol=2)
fig.tight_layout()
fig.savefig(PLOTS / "04_ratio_by_year_daynight.png")
P("plots saved")
