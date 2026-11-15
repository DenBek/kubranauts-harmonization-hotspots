"""Daily per-satellite tables (local DB), for pairwise comparisons on common valid days.

daily     : satellite x local_date x dn ('D','N','A'=both) x zone ; n, frp, celldays (0.1deg cells with >=1 det),
            cells25 (0.25deg cells active), n_edge, frp_max
valid     : satellite x local_date, operational and not flagged in gaps (gap UTC date d removes local d and d-1)
Zones are rough lat/lon boxes, NOT ecoregions:
  NE   lon > -60.5 and lat > -35   (Mesopotamia: Corrientes, Entre Rios, Misiones, Parana Delta)
  NW   lon <= -60.5 and lat > -30  (Chaco, Salta, Santiago del Estero, Formosa, Tucuman...)
  C    lat <= -30 and lat > -39 and not NE (Cordoba, San Luis, La Pampa, Buenos Aires)
  S    lat <= -39                  (Patagonia)
"""
import duckdb
from common import LOCAL_DB

con = duckdb.connect(str(LOCAL_DB))
ZONE = """CASE WHEN lat10 <= -390 THEN 'S'
              WHEN lon10 > -605 AND lat10 > -350 THEN 'NE'
              WHEN lat10 > -300 THEN 'NW' ELSE 'C' END"""
con.sql(f"CREATE OR REPLACE VIEW cz AS SELECT *, {ZONE} zone, (floor(lat10/20)*2)::INT blat, (floor(lon10/20)*2)::INT blon FROM cellday")
base = lambda grp, dncol: f"""
  SELECT satellite, local_date, {dncol} dn, {grp}, sum(n) n, sum(frp) frp,
         count(DISTINCT (lat10, lon10)) FILTER (WHERE n > 0) celldays,
         count(DISTINCT (floor(lat10/2.5), floor(lon10/2.5))) FILTER (WHERE n > 0) cells25,
         sum(n_edge) n_edge, max(frp_max) frp_max, sum(area_sum) area_sum
  FROM cz GROUP BY ALL"""
for name, grp in [("daily", "zone"), ("daily_blk", "blat, blon")]:
    con.sql(f"""CREATE OR REPLACE TABLE {name} AS
      {base(grp, 'daynight')} UNION ALL {base(grp, "'A'")}""")
    # country total as zone 'ALL'
con.sql(f"INSERT INTO daily {base(chr(39)+'ALL'+chr(39)+' AS zone', 'daynight')} UNION ALL {base(chr(39)+'ALL'+chr(39)+' AS zone', chr(39)+'A'+chr(39))}")
con.sql("""CREATE OR REPLACE TABLE valid AS
WITH span AS (SELECT satellite, min(local_date) d0, max(local_date) d1 FROM cellday GROUP BY 1),
cal AS (SELECT satellite, unnest(generate_series(d0, d1, INTERVAL 1 DAY))::DATE local_date FROM span),
bad AS (SELECT satellite, d AS local_date FROM gaps UNION SELECT satellite, (d - 1)::DATE FROM gaps)
SELECT c.* FROM cal c ANTI JOIN bad b USING (satellite, local_date)""")
for t in ["daily", "daily_blk", "valid"]:
    print(t, con.sql(f"SELECT count(*) FROM {t}").fetchall()[0][0])
print(con.sql("SELECT satellite, zone, sum(n) FROM daily WHERE dn='A' GROUP BY ALL ORDER BY ALL").df())
