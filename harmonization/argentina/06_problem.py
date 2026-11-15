"""Step 1: make the problem visible (Argentina, standard fire filter, SP + NRT)."""
import pandas as pd
from common import connect_local, PLOTS, DATA
from plotstyle import plt, COL

con = connect_local()
m = con.sql("""SELECT satellite, date_trunc('month', local_date) mo, daynight, sum(n) n, sum(frp) frp
  FROM cellday GROUP BY ALL ORDER BY ALL""").df()
a = con.sql("""SELECT satellite, year(local_date) yr, sum(n) n, sum(frp) frp, sum(n) FILTER (WHERE daynight='D') n_d
  FROM cellday GROUP BY ALL ORDER BY ALL""").df()
t = a.pivot(index="yr", columns="satellite", values="n").round(0)
print("== annual fire counts (D+N) ==\n", t.to_string())
for c in ["Suomi NPP", "NOAA-20"]:
    t[f"{c}/Aqua"] = (t[c] / t["Aqua"]).round(2)
t["Aqua/Terra"] = (t["Aqua"] / t["Terra"]).round(2)
t["SNPP/N20"] = (t["Suomi NPP"] / t["NOAA-20"]).round(3)
print(t.iloc[:, 4:].to_string())
fr = a.pivot(index="yr", columns="satellite", values="frp")
print("== annual FRP ratios ==\n", pd.DataFrame({"SNPP/Aqua": fr["Suomi NPP"]/fr["Aqua"], "N20/Aqua": fr["NOAA-20"]/fr["Aqua"],
      "Aqua/Terra": fr["Aqua"]/fr["Terra"]}).round(2).to_string())
t.to_csv(DATA / "annual_counts.csv")

mm = m.groupby(["satellite", "mo"], as_index=False)[["n", "frp"]].sum()
fig, ax = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True)
for s in ["Terra", "Aqua", "Suomi NPP", "NOAA-20"]:
    d = mm[mm.satellite == s]
    ax[0].plot(d.mo, d.n, color=COL[s], label=s, lw=1.2)
ax[0].set_yscale("log"); ax[0].set_ylabel("detections / month (log)")
ax[0].set_title("Argentina: monthly fire detections per satellite (vegetation, non-low confidence)", loc="left")
ax[0].legend(ncol=4, loc="upper left")
# naive stitched: Terra to 2002-06, Aqua 2002-07..2011, SNPP 2012..2018-03, N20 after
p = mm.pivot(index="mo", columns="satellite", values="n")
st = pd.concat([p.loc[:"2002-06", "Terra"], p.loc["2002-07":"2011-12", "Aqua"],
                p.loc["2012-01":"2018-03", "Suomi NPP"], p.loc["2018-04":, "NOAA-20"]])
yr = st.groupby(st.index.year).sum()
ax[1].bar(yr.index.astype(str).map(lambda y: pd.Timestamp(f"{y}-07-01")), yr.values, width=300, color=COL["stitched"])
for x, lab in [("2002-07-01", "Terra→Aqua"), ("2012-01-01", "Aqua→Suomi NPP"), ("2018-04-01", "→NOAA-20")]:
    ax[1].axvline(pd.Timestamp(x), color=COL["other"], ls="--", lw=1); ax[1].text(pd.Timestamp(x), yr.max()*0.95, " " + lab, fontsize=8)
ax[1].set_ylabel("detections / year"); ax[1].set_title("Naive stitched series: one satellite at a time, no adjustment (2026 partial)", loc="left")
fig.tight_layout(); fig.savefig(PLOTS / "01_problem_series.png"); print("saved")
st.rename("n").to_csv(DATA / "naive_stitched_monthly.csv")
print("== naive stitched annual ==\n", yr.to_string())
