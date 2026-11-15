"""A1: is the very low October 2026 real, or a data-coverage artefact?

For every October 2003-2026 and for Aqua, Terra, NOAA-20 (Suomi NPP ends 2025):
  valid_days   satellite-days that are operational and not flagged in `gaps` (table `valid`)
  n_total      fire-filtered Argentina detections in the month (all days)
  n_per_valid  detections on valid days / valid days   (removes missing-day effects)
Also: SP vs NRT share of the 2026 months, and the last date with data per satellite.
Verdict rule (stated before running): October 2026 is "real" if, for all three satellites, detections per valid day sit
below the minimum of the 2003-2025 Octobers (Terra/Aqua from their start) AND valid days are at least 90% of the month;
"coverage artefact" if valid days < 70% of the month; otherwise "cannot tell".

Run from harmonization/argentina/: ../../venv/Scripts/python.exe -u 16_october_check.py   -> data/16_october_check.txt
"""
import pandas as pd
from common import connect_local, DATA

con = connect_local()
pd.set_option("display.width", 220)
out = []


def P(*x):
    s = " ".join(str(v) for v in x)
    print(s, flush=True)
    out.append(s)


tot = con.sql("""SELECT satellite, year(local_date) yr, sum(n) n_total, count(DISTINCT local_date) FILTER (WHERE n > 0) days_with_det
                 FROM cellday WHERE month(local_date) = 10 GROUP BY ALL""").df()
vd = con.sql("""SELECT satellite, year(local_date) yr, count(*) valid_days FROM valid
                WHERE month(local_date) = 10 GROUP BY ALL""").df()
onv = con.sql("""SELECT c.satellite, year(c.local_date) yr, sum(c.n) n_on_valid
                 FROM cellday c JOIN valid v USING (satellite, local_date)
                 WHERE month(c.local_date) = 10 GROUP BY ALL""").df()
d = tot.merge(vd, on=["satellite", "yr"], how="outer").merge(onv, on=["satellite", "yr"], how="outer")
d = d[d.satellite.isin(["Aqua", "Terra", "NOAA-20"]) & (d.yr >= 2003)].copy()
d["n_per_valid"] = d.n_on_valid / d.valid_days
d["valid_share"] = d.valid_days / 31
for sat in ["Aqua", "Terra", "NOAA-20"]:
    P(f"\n== {sat}: Octobers (31 days) ==")
    P(d[d.satellite == sat].sort_values("yr")[["yr", "valid_days", "valid_share", "n_total", "n_per_valid"]].round(2).to_string(index=False))

P("\n== October 2026 vs the other Octobers ==")
verdicts = []
for sat in ["Aqua", "Terra", "NOAA-20"]:
    s = d[d.satellite == sat]
    cur = s[s.yr == 2026].iloc[0]
    past = s[s.yr < 2026]
    if sat == "NOAA-20":
        past = past[past.yr >= 2018]
    mn, md = past.n_per_valid.min(), past.n_per_valid.median()
    below = cur.n_per_valid < mn
    P(f"{sat}: 2026 valid days {int(cur.valid_days)}/31, detections per valid day {cur.n_per_valid:.1f} "
      f"(past min {mn:.1f}, median {md:.1f}, ratio to median {cur.n_per_valid / md:.2f}); below every earlier October: {below}")
    verdicts.append((sat, below, cur.valid_share))

P("\n== SP vs NRT in 2026 (fire-filtered detections, Argentina) ==")
q = con.sql("""SELECT satellite, month(local_date) mo, quality, sum(n) n FROM cellday
               WHERE year(local_date) = 2026 AND month(local_date) >= 7 AND satellite IN ('Aqua','Terra','NOAA-20')
               GROUP BY ALL ORDER BY ALL""").df()
P(q.pivot_table(index=["satellite", "mo"], columns="quality", values="n", fill_value=0).assign(
    nrt_share=lambda t: t.get("NRT", 0) / t.sum(axis=1)).round(2).to_string())
P("\n== last date with data, per satellite ==")
P(con.sql("SELECT satellite, max(local_date) last_local_date FROM cellday GROUP BY 1 ORDER BY 1").df().to_string(index=False))
P("\n== valid days per month in 2026 (is the NRT feed complete?) ==")
P(con.sql("""SELECT satellite, month(local_date) mo, count(*) valid_days FROM valid
             WHERE year(local_date) = 2026 AND month(local_date) >= 7 AND satellite IN ('Aqua','Terra','NOAA-20')
             GROUP BY ALL ORDER BY ALL""").df().pivot(index="mo", columns="satellite", values="valid_days").to_string())

allbelow = all(b for _, b, _ in verdicts)
mincov = min(c for _, _, c in verdicts)
if allbelow and mincov >= 0.9:
    v = "REAL SIGNAL (low on all three satellites, with full valid-day coverage)"
elif mincov < 0.7:
    v = "COVERAGE ARTEFACT (valid days under 70%)"
else:
    v = "CANNOT TELL"
P(f"\nVERDICT: {v}. Minimum valid-day share {mincov:.2f}. NRT caveat: October 2026 is near-real-time and can still be revised.")
(DATA / "16_october_check.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
