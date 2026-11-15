"""Step 5 (part): global per-satellite daily detection totals (to find missing days), plus
version-by-year and local overpass hour by year from the Argentina extract."""
import duckdb
from common import connect_r2, SILVER, DATA

out = DATA / "global_daily.parquet"
if not out.exists():
    con = connect_r2()
    con.sql(f"""COPY (SELECT satellite, quality, acq_date_utc, count(*) n
      FROM {SILVER} GROUP BY ALL) TO '{out.as_posix()}' (FORMAT parquet)""")
con = duckdb.connect()
con.sql(f"CREATE VIEW x AS SELECT * FROM read_parquet('{(DATA/'extract').as_posix()}/*.parquet', union_by_name=true) WHERE in_country")
q = lambda s: print(con.sql(s).df().to_string(), "\n", flush=True)
print("== MODIS version by year (Argentina) ==")
q("SELECT year, version, count(*) n FROM x WHERE source='modis' GROUP BY ALL ORDER BY ALL")
print("== median local solar overpass hour by satellite x daynight x year ==")
q("""SELECT satellite, daynight, year,
   round(median((hour(acq_datetime_utc) + minute(acq_datetime_utc)/60 + longitude/15 + 24) % 24),2) med_hr,
   round(quantile_cont((hour(acq_datetime_utc) + minute(acq_datetime_utc)/60 + longitude/15 + 24) % 24, 0.1),2) p10,
   round(quantile_cont((hour(acq_datetime_utc) + minute(acq_datetime_utc)/60 + longitude/15 + 24) % 24, 0.9),2) p90
   FROM x GROUP BY ALL ORDER BY ALL""")
g = f"read_parquet('{out.as_posix()}')"
print("== global days per satellite/year: present, missing (no rows), low (<20% of 31-day rolling median) ==")
q(f"""WITH d AS (SELECT satellite, acq_date_utc d, sum(n) n FROM {g} GROUP BY ALL),
  span AS (SELECT satellite, min(d) d0, max(d) d1 FROM d GROUP BY 1),
  cal AS (SELECT s.satellite, unnest(generate_series(s.d0, s.d1, INTERVAL 1 DAY))::DATE d FROM span s),
  j AS (SELECT c.satellite, c.d, coalesce(n,0) n FROM cal c LEFT JOIN d USING (satellite, d)),
  r AS (SELECT *, median(n) OVER (PARTITION BY satellite ORDER BY d ROWS BETWEEN 15 PRECEDING AND 15 FOLLOWING) m FROM j)
  SELECT satellite, year(d) yr, count(*) ndays, sum((n=0)::INT) missing, sum((n>0 AND n<0.2*m)::INT) low
  FROM r GROUP BY ALL HAVING missing>0 OR low>0 ORDER BY ALL""")
