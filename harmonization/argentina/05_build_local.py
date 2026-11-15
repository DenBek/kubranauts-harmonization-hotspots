"""Build local DuckDB with compact Argentina aggregates (region = REGION['country']).

Tables:
  cellday : satellite x quality x local_date x daynight x 0.1deg cell, counts at 3 filter levels, FRP, view geometry
  gaps    : satellite x utc date flagged missing (no rows globally) or low (<20% of 31-day rolling median)
"""
import duckdb
from common import DATA, LOCAL_DB

con = duckdb.connect(str(LOCAL_DB))
ext = (DATA / "extract").as_posix()
con.sql(f"""CREATE OR REPLACE TABLE cellday AS
SELECT satellite, source, quality, local_date, daynight, lat10, lon10,
  count(*) n_all,
  count(*) FILTER (WHERE is_vegetation_fire) n_veg,
  count(*) FILTER (WHERE is_vegetation_fire AND confidence_class <> 'low') n,
  sum(frp) FILTER (WHERE is_vegetation_fire AND confidence_class <> 'low') frp,
  sum(frp) FILTER (WHERE is_vegetation_fire) frp_veg,
  max(frp) FILTER (WHERE is_vegetation_fire AND confidence_class <> 'low') frp_max,
  sum(scan*track) FILTER (WHERE is_vegetation_fire AND confidence_class <> 'low') area_sum,
  count(*) FILTER (WHERE is_vegetation_fire AND confidence_class <> 'low'
                   AND scan > CASE WHEN source='modis' THEN 2.0 ELSE 0.6 END) n_edge
FROM read_parquet('{ext}/*.parquet', union_by_name=true)
WHERE in_country
GROUP BY ALL""")
g = (DATA / "global_daily.parquet").as_posix()
con.sql(f"""CREATE OR REPLACE TABLE gaps AS
WITH d AS (SELECT satellite, acq_date_utc d, sum(n) n FROM read_parquet('{g}') GROUP BY ALL),
span AS (SELECT satellite, min(d) d0, max(d) d1 FROM d GROUP BY 1),
cal AS (SELECT satellite, unnest(generate_series(d0, d1, INTERVAL 1 DAY))::DATE d FROM span),
j AS (SELECT c.satellite, c.d, coalesce(n,0) n FROM cal c LEFT JOIN d USING (satellite, d)),
r AS (SELECT *, median(n) OVER (PARTITION BY satellite ORDER BY d ROWS BETWEEN 15 PRECEDING AND 15 FOLLOWING) m FROM j)
SELECT satellite, d, n, m, CASE WHEN n=0 THEN 'missing' ELSE 'low' END status FROM r WHERE n=0 OR n<0.2*m""")
for t in ["cellday", "gaps"]:
    print(t, con.sql(f"SELECT count(*) FROM {t}").fetchall()[0][0])
print(con.sql("SELECT satellite, sum(n_all), sum(n) FROM cellday GROUP BY 1 ORDER BY 1").df())
