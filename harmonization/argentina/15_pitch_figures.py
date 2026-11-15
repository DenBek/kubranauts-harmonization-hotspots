"""Four pitch figures for the Argentina MVP (colour-blind-safe viridis / cividis; modelled months marked).

Needs 14_build_gold.py to have run. Run from harmonization/argentina/:
    ../../venv/Scripts/python.exe -u 15_pitch_figures.py
Output: plots/pitch_1_seam.png, pitch_2_calendar.png, pitch_3_validation.png, pitch_4_uncertainty.png
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
import numpy as np
import pandas as pd
from common import connect_local, PLOTS, HERE
from pairs import pair

GOLD = HERE / "gold"
con = connect_local()
plt.rcParams.update({"axes.axisbelow": True, "figure.dpi": 130, "axes.spines.top": False, "axes.spines.right": False, "font.size": 9,
                     "legend.frameon": False, "axes.grid": True, "grid.color": "#e6e6e6", "grid.linewidth": 0.6})
VIR = plt.cm.viridis
SAT_COL = {"Terra": VIR(0.05), "Aqua": VIR(0.33), "Suomi NPP": VIR(0.6), "NOAA-20": VIR(0.82)}

# ---------- raw monthly by satellite + naive stitched ----------
raw = con.sql("""SELECT satellite, date_trunc('month', local_date)::DATE t, sum(n) n FROM cellday
                 WHERE local_date >= DATE '2000-11-01' GROUP BY ALL""").df()
raw["t"] = pd.to_datetime(raw.t)
wide = raw.pivot(index="t", columns="satellite", values="n").sort_index()


def stitched_source(t):
    if t < pd.Timestamp("2002-07-01"):
        return "Terra"
    if t < pd.Timestamp("2012-01-01"):
        return "Aqua"
    return "Suomi NPP" if t < pd.Timestamp("2018-04-01") else "NOAA-20"


wide["stitched"] = [wide.loc[t, stitched_source(t)] for t in wide.index]
rm = con.sql(
    f"SELECT * FROM read_parquet('{(GOLD / 'gold_region_monthly.parquet').as_posix()}') WHERE region_id = 'argentina'").df()
rm["t"] = pd.to_datetime(rm.month_start)
rm = rm.set_index("t")
modelled = rm.method.isin(["modelled_aqua", "insufficient_data"])

# ---------- figure 1: the seam ----------
fig, ax = plt.subplots(2, 1, figsize=(11, 6.8), gridspec_kw={"height_ratios": [1.15, 1]})
for s, c in SAT_COL.items():
    ax[0].plot(wide.index, wide[s], color=c, lw=1.1, label=s)
ax[0].plot(wide.index, wide.stitched, color="black", lw=0.9, ls="--", label="naive stitched (switches satellite)")
ax[0].set_yscale("log")
ax[0].set_ylabel("fire detections per month")
ax[0].set_title("Argentina: raw monthly fire detections by satellite. VIIRS sees ~4-7x more than MODIS Aqua", loc="left")
ax[0].legend(ncol=5, loc="lower left", fontsize=8)
for x in ["2002-07-01", "2012-01-01", "2018-04-01"]:
    ax[0].axvline(pd.Timestamp(x), color="#999", lw=0.8, ls=":")
yr_st = wide.stitched[wide.index >= "2003-01-01"].groupby(wide.index[wide.index >= "2003-01-01"].year).sum()
ann = con.sql(f"""SELECT year, harmonized_cell_days h, harmonized_low lo, harmonized_high hi, method, is_complete
  FROM read_parquet('{(GOLD / 'gold_region_annual.parquet').as_posix()}') WHERE region_id = 'argentina' ORDER BY year""").df()
x = np.arange(len(ann))
ax[1].bar(x - 0.2, yr_st.reindex(ann.year).values / 1e3, width=0.4, color="#b5b5b5", label="naive stitched (raw)")
is_mod = ann.method != "observed_viirs"
ax[1].bar(x[~is_mod] + 0.2, ann.h[~is_mod] / 1e3, width=0.4, color=VIR(0.6), label="harmonized: measured VIIRS")
ax[1].bar(x[is_mod] + 0.2, ann.h[is_mod] / 1e3, width=0.4, color="white", edgecolor=VIR(0.33), hatch="////", lw=0.8,
          label="harmonized: MODIS converted (modelled)")
ax[1].errorbar(x[is_mod] + 0.2, ann.h[is_mod] / 1e3, yerr=[(ann.h - ann.lo)[is_mod] / 1e3, (ann.hi - ann.h)[is_mod] / 1e3],
               fmt="none", ecolor="#333", lw=0.8, capsize=2)
ax[1].set_xticks(x, [f"{y}" + ("*" if not c else "") for y, c in zip(ann.year, ann.is_complete)], rotation=90, fontsize=7.5)
ax[1].set_ylabel("thousand detections per year")
ax[1].set_title("Annual totals: the 2012 jump (x3.7) disappears after harmonization (VIIRS-equivalent units; * = incomplete year)", loc="left")
ax[1].legend(fontsize=8, loc="upper right")
fig.tight_layout()
fig.savefig(PLOTS / "pitch_1_seam.png")

# ---------- figure 2: before / after calendar ----------
yrs = list(range(2003, 2027))
before = wide.stitched[wide.index >= "2003-01-01"]
B = np.full((12, len(yrs)), np.nan)
A = np.full((12, len(yrs)), np.nan)
M = np.zeros((12, len(yrs)), bool)
for t, v in before.items():
    B[t.month - 1, t.year - 2003] = v
for t, r in rm.iterrows():
    A[t.month - 1, t.year - 2003] = r.harmonized_cell_days
    M[t.month - 1, t.year - 2003] = r.method in ("modelled_aqua", "insufficient_data")
norm = LogNorm(vmin=np.nanmin([np.nanmin(B[B > 0]), np.nanmin(A[A > 0])]), vmax=np.nanmax([np.nanmax(B), np.nanmax(A)]))
fig, ax = plt.subplots(2, 1, figsize=(11, 6.4), sharex=True)
for a, Z, title in [(ax[0], B, "Before: raw counts from whichever satellite was flying (naive stitched)"),
                    (ax[1], A, "After: harmonized, VIIRS-equivalent detections (dots = modelled from MODIS Aqua)")]:
    im = a.imshow(Z, aspect="auto", cmap="cividis", norm=norm, interpolation="nearest")
    a.set_yticks(range(12), ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"])
    a.set_title(title, loc="left")
    a.grid(False)
yy, mm = np.where(M.T)
ax[1].scatter(yy, mm, s=4, color="white", edgecolor="none")
ax[1].set_xticks(range(len(yrs)), yrs, rotation=90, fontsize=7.5)
ax[0].axvline(2012 - 2003 - 0.5, color="white", lw=1.2)
ax[0].text(2012 - 2003 - 0.3, 11.3, "sensor switch, 2012", fontsize=7.5, color="white")
fig.colorbar(im, ax=ax, label="detections per month (log, same scale)", shrink=0.85)
fig.savefig(PLOTS / "pitch_2_calendar.png", bbox_inches="tight")

# ---------- figure 3: validation on held-out years ----------
z = pd.concat([pair(con, "Aqua", "Suomi NPP", "A", zone=zz, y0=2012, y1=2022) for zz in ["NE", "NW", "C", "S"]])
c = z.groupby("t")[["n_a", "n_b"]].sum().reset_index()
c["yr"], c["mo"] = c.t.dt.year, c.t.dt.month
fit = c[c.yr.between(2012, 2019)].groupby("mo")[["n_b", "n_a"]].sum()
k = fit.n_b / fit.n_a
e1 = c[c.yr.between(2020, 2022)].assign(p=lambda d: d.n_a * d.mo.map(k))
lo = []
for y in range(2012, 2023):
    f = c[(c.yr != y)].groupby("mo")[["n_b", "n_a"]].sum()
    d = c[c.yr == y]
    lo.append(d.assign(p=d.n_a * d.mo.map(f.n_b / f.n_a)))
lo = pd.concat(lo)
cal = con.sql(f"SELECT * FROM read_parquet('{(GOLD / 'gold_calibration.parquet').as_posix()}')").df()
l_pct, h_pct = cal.likely_low_pct.iloc[0], cal.likely_high_pct.iloc[0]
fig, ax = plt.subplots(1, 2, figsize=(11, 4.8), gridspec_kw={"width_ratios": [1, 1.3]})
ax[0].scatter(lo.n_b, lo.p, s=10, color=VIR(0.6), alpha=0.45, label="leave-one-year-out 2012-2022")
ax[0].scatter(e1.n_b, e1.p, s=22, color=VIR(0.05), label="held out 2020-2022 (fit 2012-2019)")
g = np.array([1e3, 2e5])
ax[0].plot(g, g, color="#333", lw=0.9, label="1:1")
ax[0].fill_between(g, g / (1 + h_pct / 100), g / (1 + l_pct / 100), color="#999", alpha=0.18, lw=0,
                   label=f"likely range ({l_pct:.0f}% / +{h_pct:.0f}%)")
ax[0].set_xscale("log"); ax[0].set_yscale("log")
ax[0].set_xlabel("measured VIIRS (Suomi NPP) detections, month")
ax[0].set_ylabel("predicted from MODIS Aqua x month factor")
ax[0].set_title("Converted MODIS vs measured VIIRS, Argentina", loc="left")
ax[0].legend(fontsize=7.5, loc="upper left")
ax[1].plot(e1.t, e1.n_b, color=VIR(0.6), lw=1.6, label="measured VIIRS")
ax[1].plot(e1.t, e1.p, color=VIR(0.05), lw=1.2, ls="--", label="converted MODIS")
ax[1].fill_between(e1.t, e1.p * (1 + l_pct / 100), e1.p * (1 + h_pct / 100), color=VIR(0.05), alpha=0.15, lw=0, label="likely range")
ax[1].set_yscale("log")
ax[1].set_title("Unseen years 2020-22: median error 9%, likely range held 86%", loc="left")
ax[1].legend(fontsize=7.5)
fig.tight_layout()
fig.savefig(PLOTS / "pitch_3_validation.png")

# ---------- figure 4: uncertainty vs area size ----------
rel = con.sql(f"SELECT * FROM read_parquet('{(GOLD / 'gold_reliability.parquet').as_posix()}')").df()
FC = {"reliable": VIR(0.85), "good": VIR(0.6), "caution": VIR(0.33), "indicative_only": VIR(0.05)}
fig, ax = plt.subplots(figsize=(8.5, 4.4))
from matplotlib.patches import Patch
xx = np.arange(len(rel))
for i, r in rel.iterrows():
    lo_, hi_ = 1 + r.likely_low_pct / 100, 1 + r.likely_high_pct / 100
    ax.bar(i, hi_ - lo_, bottom=lo_, color=FC[r.reliability], width=0.6)
    for v in (r.range80_low_pct, r.range80_high_pct):
        ax.plot([i - 0.3, i + 0.3], [1 + v / 100] * 2, color="white" if r.reliability in ("indicative_only", "caution") else "#333", lw=1)
ax.axhline(1, color="#333", lw=0.8)
ax.set_yscale("log")
ticks = [0.15, 0.25, 0.5, 0.8, 1, 1.25, 2, 4, 7]
ax.set_yticks(ticks, [f"{100 * (t - 1):+.0f}%" if t != 1 else "0" for t in ticks])
ax.minorticks_off()
ax.grid(axis="x", visible=False)
ax.set_xticks(xx, rel.size_bin)
ax.set_xlabel("MODIS Aqua detections in the selected area and month")
ax.set_ylabel("true value vs converted value")
ax.set_title("Before 2012, small areas cannot be converted reliably (bars = likely range, lines = 80% range)", loc="left", fontsize=9)
ax.legend(handles=[Patch(color=c_, label=f.replace("_", " ")) for f, c_ in FC.items()], fontsize=8, ncol=4, loc="upper right")
fig.tight_layout()
fig.savefig(PLOTS / "pitch_4_uncertainty.png")
print("saved", [p.name for p in sorted(PLOTS.glob("pitch_*.png"))])
