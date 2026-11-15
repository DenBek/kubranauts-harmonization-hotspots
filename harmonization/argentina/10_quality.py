"""Step 4: data quality checks (Argentina). Output data/10_quality.txt + plots/05_quality.png"""
import numpy as np
import pandas as pd
from common import connect_local, PLOTS, DATA
from plotstyle import plt, COL
from pairs import pair
import duckdb

con = connect_local()


def P(*x):
    print(*x, flush=True)


def q(s):
    P(con.sql(s).df().to_string(), "\n")


P("== A. MODIS version step check: SNPP/Aqua and Aqua/Terra annual ratios (D) around the 2018 version label change ==")
d = pair(con, "Aqua", "Suomi NPP", "D", y0=2012, y1=2022, by="year")
r = np.log(d.n_b / d.n_a)
pre, post = r[d.t.dt.year <= 2017], r[d.t.dt.year >= 2018]
P(f"SNPP/Aqua day log-ratio 2012-17 mean {pre.mean():.3f} (sd {pre.std():.3f}), 2018-22 mean {post.mean():.3f} (sd {post.std():.3f}); "
  f"diff {np.exp(post.mean()-pre.mean()):.3f}x")
d = pair(con, "Terra", "Aqua", "D", y0=2003, y1=2022, by="year")
r = np.log(d.n_b / d.n_a)
P(f"Aqua/Terra day: 2003-17 {np.exp(r[d.t.dt.year <= 2017].mean()):.3f}, 2018-22 {np.exp(r[d.t.dt.year >= 2018].mean()):.3f}")
P("(both MODIS satellites change label together, so Aqua/Terra cannot reveal a common MODIS step; SNPP/Aqua can)\n")

P("== B. 2026: SP vs NRT. Monthly N20/Aqua count and FRP ratio vs 2019-2022 same-month ratio ==")
m = pair(con, "Aqua", "NOAA-20", "A", y0=2019, y1=2026)
m["mo"], m["yr"] = m.t.dt.month, m.t.dt.year
base = m[m.yr <= 2022].groupby("mo")[["n_a", "n_b", "frp_a", "frp_b"]].sum()
base = pd.DataFrame({"n_base": base.n_b / base.n_a, "frp_base": base.frp_b / base.frp_a})
c26 = m[m.yr == 2026].set_index("mo")
c26 = pd.DataFrame({"n_2026": c26.n_b / c26.n_a, "frp_2026": c26.frp_b / c26.frp_a, "aqua_n": c26.n_a}).join(base)
qual = con.sql("""SELECT month(local_date) mo, string_agg(DISTINCT satellite || ':' || quality, ' ') q
   FROM cellday WHERE year(local_date)=2026 AND satellite IN ('Aqua','NOAA-20') GROUP BY 1""").df().set_index("mo")
P(c26.join(qual).round(2).to_string(), "\n")

P("== C. persistent cells: 0.1deg cells with fire-filtered detections on many distinct days (possible unflagged static sources) ==")
q("""WITH c AS (SELECT satellite, lat10, lon10, count(DISTINCT local_date) nd, sum(n) n,
       count(DISTINCT year(local_date)) ny FROM cellday WHERE n > 0 AND satellite IN ('Suomi NPP','Aqua') GROUP BY ALL)
     SELECT satellite, lat10/10 lat, lon10/10 lon, nd days_active, ny n_years, n FROM c
     QUALIFY row_number() OVER (PARTITION BY satellite ORDER BY nd DESC) <= 8 ORDER BY satellite, nd DESC""")
q("""WITH c AS (SELECT satellite, lat10, lon10, count(DISTINCT local_date) nd, sum(n) n FROM cellday
       WHERE n > 0 AND satellite='Suomi NPP' GROUP BY ALL),
     tot AS (SELECT sum(n) t FROM c)
     SELECT count(*) FILTER (WHERE nd >= 200) cells_ge200d, round(100*sum(n) FILTER (WHERE nd >= 200)/max(t),2) pct_det_ge200d,
            count(*) FILTER (WHERE nd >= 100) cells_ge100d, round(100*sum(n) FILTER (WHERE nd >= 100)/max(t),2) pct_det_ge100d
     FROM c, tot""")

P("== D. biggest single days per satellite (fire-filtered, Argentina) ==")
q("""SELECT satellite, local_date, n, round(frp) frp, celldays FROM daily WHERE zone='ALL' AND dn='A'
     QUALIFY row_number() OVER (PARTITION BY satellite ORDER BY n DESC) <= 4 ORDER BY satellite, n DESC""")

P("== E. Known events (from task brief: Parana Delta Apr 2008; Delta + Cordoba Aug-Oct 2020; Corrientes Jan-Feb 2022). Monthly counts + rank among same calendar month ==")
mon = con.sql("""SELECT satellite, date_trunc('month', local_date) t, sum(n) n FROM daily WHERE zone='ALL' AND dn='A'
                 GROUP BY ALL""").df()
mon["mo"] = mon.t.dt.month
mon["rank_in_month"] = mon.groupby(["satellite", "mo"]).n.rank(ascending=False).astype(int)
mon["years_in_month"] = mon.groupby(["satellite", "mo"]).n.transform("size")
ev = mon[mon.t.isin(pd.to_datetime(["2008-04-01", "2020-08-01", "2020-09-01", "2020-10-01", "2022-01-01", "2022-02-01"]))]
P(ev.sort_values(["t", "satellite"]).to_string(index=False), "\n")

P("== F. Coverage of the MODIS-only era: valid days per month for Terra/Aqua 2000-2011 with < 90% valid ==")
q("""WITH cal AS (SELECT unnest(generate_series(DATE '2000-11-01', DATE '2011-12-31', INTERVAL 1 DAY))::DATE d),
  s AS (SELECT DISTINCT satellite FROM valid WHERE satellite IN ('Terra','Aqua'))
  SELECT s.satellite, date_trunc('month', d) t, count(v.local_date) valid, count(*) cal,
         round(100*count(v.local_date)/count(*)) pct FROM cal, s
  LEFT JOIN valid v ON v.satellite = s.satellite AND v.local_date = cal.d
  GROUP BY ALL HAVING pct < 90 ORDER BY ALL""")

P("== G. Low-activity months: months per zone with Aqua n < 20 (D+N), 2012-2022 ==")
q("""SELECT zone, count(*) FILTER (WHERE n < 20) lt20, count(*) n_months FROM
     (SELECT zone, date_trunc('month', local_date) t, sum(n) n FROM daily WHERE satellite='Aqua' AND dn='A'
      AND year(local_date) BETWEEN 2012 AND 2022 GROUP BY ALL) GROUP BY 1 ORDER BY 1""")

# plot: map of fire-filtered detections per 0.1deg cell, SNPP vs Aqua, 2012-2019; and active days
g = con.sql("""SELECT satellite, lat10, lon10, sum(n) n, count(DISTINCT local_date) nd FROM cellday
   WHERE n > 0 AND satellite IN ('Aqua','Suomi NPP') AND year(local_date) BETWEEN 2012 AND 2019 GROUP BY ALL""").df()
fig, ax = plt.subplots(1, 3, figsize=(13, 6.5))
for i, s in enumerate(["Aqua", "Suomi NPP"]):
    d = g[g.satellite == s]
    sc = ax[i].scatter(d.lon10 / 10, d.lat10 / 10, c=np.log10(d.n), s=0.6, cmap="Blues", vmin=0, vmax=3.5, marker="s")
    ax[i].set_title(f"{s}: detections per 0.1° cell, 2012–2019 (log10)", loc="left", fontsize=9)
    ax[i].set_aspect("equal"); ax[i].grid(False)
fig.colorbar(sc, ax=ax[:2], shrink=0.6, label="log10 detections")
blk = g.assign(blat=(np.floor(g.lat10 / 20) * 2), blon=(np.floor(g.lon10 / 20) * 2)).groupby(["blat", "blon", "satellite"]).n.sum().unstack()
blk = blk[blk.Aqua >= 200]
r = np.log2(blk["Suomi NPP"] / blk["Aqua"])
sc = ax[2].scatter(blk.index.get_level_values(1) + 1, blk.index.get_level_values(0) + 1, c=r, cmap="RdBu_r",
                   vmin=np.log2(2.5), vmax=np.log2(10), s=70, marker="s")
ax[2].set_title("SNPP/Aqua count ratio per 2° block\n(blocks with ≥200 Aqua detections)", loc="left", fontsize=9)
ax[2].set_aspect("equal"); ax[2].set_xlim(ax[0].get_xlim()); ax[2].set_ylim(ax[0].get_ylim())
cb = fig.colorbar(sc, ax=ax[2], shrink=0.6)
cb.set_ticks(np.log2([2.5, 4, 5, 6.3, 10])); cb.set_ticklabels(["2.5", "4", "5", "6.3", "10"]); cb.set_label("ratio")
for x in [-60.5]:
    pass
fig.savefig(PLOTS / "05_maps.png", bbox_inches="tight")
P("ratio per block: min %.2f, p25 %.2f, median %.2f, p75 %.2f, max %.2f (n=%d)" % (
    *np.exp2(np.percentile(r, [0, 25, 50, 75, 100])), len(r)))
P("plots saved")
