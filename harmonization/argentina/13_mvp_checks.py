"""MVP sanity checks (prespecified in harmonization/docs/new_prompt.md, Deliverable 1).

Check 1, flare-cell sensitivity: refit the M1 month factors (Aqua -> Suomi NPP, 2012-2019) with and
without persistent cells, and compare the factors and the E1 test error (2020-2022).
  persistent = 0.1 deg cells with fire-filtered Suomi NPP detections on >= 200 distinct days (2012-2025)
  vaca_muerta = every cell in the box lat -39.5..-36.5, lon -70.5..-67.5 (Neuquen oil and gas)
Check 2, day-only vs day+night: same M1 test with day detections only, plus Aqua's day share 2003-2011.

Months are compared on local dates valid for both satellites only (same rule as 11_method_test.py).
Run from harmonization/argentina/: ../../venv/Scripts/python.exe -u 13_mvp_checks.py
Output: data/13_mvp_checks.txt (stdout) and data/13_checks.csv.
"""
import numpy as np
import pandas as pd
from common import connect_local, DATA

con = connect_local()
FIT, E1 = range(2012, 2020), range(2020, 2023)
VM_BOX = "lat10 BETWEEN -395 AND -365 AND lon10 BETWEEN -705 AND -675"

con.sql("""CREATE OR REPLACE TEMP TABLE persistent AS
  SELECT lat10, lon10 FROM cellday
  WHERE satellite = 'Suomi NPP' AND n > 0 AND year(local_date) BETWEEN 2012 AND 2025
  GROUP BY ALL HAVING count(DISTINCT local_date) >= 200""")
con.sql(f"CREATE OR REPLACE TEMP TABLE vm AS SELECT DISTINCT lat10, lon10 FROM cellday WHERE {VM_BOX}")
MASKS = {
    "none": "",
    "vaca_muerta box": "ANTI JOIN vm m USING (lat10, lon10)",
    "persistent>=200d + vaca_muerta": "ANTI JOIN (SELECT * FROM persistent UNION SELECT * FROM vm) m USING (lat10, lon10)",
}


def monthly(a="Aqua", b="Suomi NPP", dn=("D", "N"), mask=""):
    dns = ", ".join(f"'{d}'" for d in dn)
    return con.sql(f"""
      WITH both_ AS (SELECT local_date FROM valid WHERE satellite = '{a}'
                     INTERSECT SELECT local_date FROM valid WHERE satellite = '{b}'),
      c AS (SELECT c.* FROM cellday c {mask})
      SELECT date_trunc('month', local_date) t,
             coalesce(sum(n) FILTER (WHERE satellite = '{a}'), 0) a,
             coalesce(sum(n) FILTER (WHERE satellite = '{b}'), 0) v
      FROM c JOIN both_ USING (local_date)
      WHERE daynight IN ({dns}) AND satellite IN ('{a}', '{b}') AND year(local_date) BETWEEN 2012 AND 2022
      GROUP BY 1 ORDER BY 1""").df().assign(yr=lambda d: d.t.dt.year, mo=lambda d: d.t.dt.month)


def m1(z):
    f = z[z.yr.isin(FIT)].groupby("mo")[["v", "a"]].sum()
    k = f.v / f.a
    d = z[z.yr.isin(E1)].assign(p=lambda d: d.a * d.mo.map(k))
    r = d.p / d.v
    yr = d.groupby("yr")[["p", "v"]].sum()
    return k, dict(bias_pct=100 * (np.exp(np.log(r).mean()) - 1), mdape=100 * np.median(np.abs(r - 1)),
                   p90_abs_pct=100 * np.quantile(np.abs(r - 1), 0.9),
                   annual_max_abs_pct=100 * np.max(np.abs(yr.p / yr.v - 1)))


rows, ks, v_all = [], {}, None
for name, mask in MASKS.items():
    z = monthly(mask=mask)
    k, s = m1(z)
    ks[name] = k
    v_all = v_all or z.v.sum()
    ch = 100 * (k / ks["none"] - 1)
    rows.append(dict(check="1 flare mask", variant=name, viirs_removed_pct=100 * (1 - z.v.sum() / v_all),
                     factor_change_mean_abs_pct=ch.abs().mean(), factor_change_max_abs_pct=ch.abs().max(), **s))

kd, sd = m1(monthly(dn=("D",)))
rows.append(rows[0] | {"check": "2 day vs D+N", "variant": "day+night (default)", "viirs_removed_pct": None,
                       "factor_change_mean_abs_pct": None, "factor_change_max_abs_pct": None})
rows.append(dict(check="2 day vs D+N", variant="day only", **sd))
res = pd.DataFrame(rows).set_index(["check", "variant"]).round(2)
pd.set_option("display.width", 200)
print("Reproduces 11_method_test.py E1 (none / D+N): bias -7.2%, median abs 9.5% expected\n")
print(res.to_string(), "\n")
print("Month factors (Aqua -> SNPP, fit 2012-19):")
print(pd.DataFrame(ks | {"day only": kd}).round(3).to_string(), "\n")

ds = con.sql("""SELECT year(local_date) yr, 100 * sum(n) FILTER (WHERE daynight = 'D') / sum(n) day_pct
  FROM cellday WHERE satellite = 'Aqua' AND year(local_date) BETWEEN 2003 AND 2011 GROUP BY 1 ORDER BY 1""").df()
print("Aqua day share of fire detections 2003-2011 (%):", ds.set_index("yr").day_pct.round(1).to_dict())
print(f"  mean {ds.day_pct.mean():.1f}, sd {ds.day_pct.std():.2f}, range {ds.day_pct.min():.1f}-{ds.day_pct.max():.1f}")
n_p = con.sql("SELECT count(*) FROM persistent").fetchall()[0][0]
n_v = con.sql("SELECT count(*) FROM vm").fetchall()[0][0]
print(f"cells: persistent {n_p}, vaca_muerta box {n_v}")
res.to_csv(DATA / "13_checks.csv")
