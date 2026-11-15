"""Step 0/1: profile the local extract: country vs bbox, nulls, categoricals, filter effects per sensor."""
import duckdb
from common import DATA, REGION
pd_opts = dict()
con = duckdb.connect()
con.sql(f"CREATE VIEW x AS SELECT * FROM read_parquet('{(DATA/'extract').as_posix()}/*.parquet', union_by_name=true)")
q = lambda s: print(con.sql(s).df().to_string(), "\n", flush=True)

print("== country vs bbox, by satellite ==")
q("""SELECT satellite, count(*) n,
  sum((in_country AND in_bbox)::INT) both_, sum((in_country AND NOT in_bbox)::INT) country_only,
  sum((NOT in_country AND in_bbox)::INT) bbox_only FROM x GROUP BY 1 ORDER BY 1""")
print("== Argentina rows outside bbox: where are they ==")
q("""SELECT satellite, round(latitude) lat, round(longitude) lon, count(*) n FROM x
     WHERE in_country AND NOT in_bbox GROUP BY ALL ORDER BY n DESC LIMIT 15""")
print("== country_source for Argentina rows ==")
q("SELECT satellite, quality, country_source, count(*) n FROM x WHERE in_country GROUP BY ALL ORDER BY ALL")
print("== countries inside bbox ==")
q("SELECT country, count(*) n FROM x WHERE in_bbox GROUP BY 1 ORDER BY 2 DESC LIMIT 12")
print("== 0.1deg cells shared between Argentina and another country (border ambiguity) ==")
q("""WITH c AS (SELECT lat10, lon10, count(DISTINCT country) k, sum((country='Argentina')::INT) a, count(*) n
     FROM x WHERE in_bbox GROUP BY 1,2)
     SELECT count(*) FILTER (WHERE a>0) arg_cells, count(*) FILTER (WHERE a>0 AND k>1) mixed_cells,
            sum(n) FILTER (WHERE a>0 AND k>1) det_in_mixed FROM c""")

A = "in_country"
print("== nulls per column (Argentina) ==")
cols = [r[0] for r in con.sql("DESCRIBE x").fetchall()]
q("SELECT satellite, count(*) n, " + ", ".join(f"round(100*avg(({c} IS NULL)::INT),2) AS \"{c}\"" for c in cols if c not in ('satellite',)) + f" FROM x WHERE {A} GROUP BY 1")
print("== categoricals ==")
for c in ["instrument","quality","daynight","confidence_class","type_reported","type_final","type_inferred","version","country_source"]:
    q(f"SELECT satellite, {c}, count(*) n FROM x WHERE {A} GROUP BY ALL ORDER BY ALL")
print("== confidence_raw by class (MODIS numeric) ==")
q(f"SELECT satellite, confidence_class, min(confidence_raw) mn, max(confidence_raw) mx, count(DISTINCT confidence_raw) k FROM x WHERE {A} GROUP BY ALL ORDER BY ALL")
print("== numeric ranges ==")
q(f"""SELECT satellite, min(frp) frp_min, median(frp) frp_med, avg(frp) frp_mean, quantile_cont(frp,0.99) frp_p99, max(frp) frp_max,
  sum((frp<=0)::INT) frp_le0, min(scan) scan_min, median(scan) scan_med, max(scan) scan_max, min(track) tr_min, max(track) tr_max,
  min(bright_main) b_min, max(bright_main) b_max, min(local_date) d0, max(local_date) d1
  FROM x WHERE {A} GROUP BY 1 ORDER BY 1""")
print("== local_date vs utc date offset ==")
q(f"SELECT satellite, local_date - acq_date_utc AS off, count(*) n FROM x WHERE {A} GROUP BY ALL ORDER BY ALL")
print("== filter removal per satellite (Argentina, SP/archive only) ==")
q(f"""SELECT satellite, count(*) n_all,
  round(100*avg((NOT is_vegetation_fire)::INT),2) pct_nonveg,
  round(100*avg((confidence_class='low')::INT),2) pct_low,
  round(100*avg((is_vegetation_fire AND confidence_class<>'low')::INT),2) pct_kept,
  round(100*avg((daynight='N')::INT),2) pct_night_all,
  round(100*avg((daynight='N')::INT) FILTER (WHERE is_vegetation_fire AND confidence_class<>'low'),2) pct_night_kept
  FROM x WHERE {A} AND quality='SP' GROUP BY 1 ORDER BY 1""")
print("== type_final x satellite, Argentina ==")
q(f"SELECT type_final, satellite, count(*) n, round(avg(frp),1) frp FROM x WHERE {A} GROUP BY ALL ORDER BY ALL")
print("== exact duplicates (same sat, time, lat, lon) ==")
q(f"""SELECT satellite, sum(c-1) dup_rows FROM (SELECT satellite, acq_datetime_utc, latitude, longitude, count(*) c
     FROM x WHERE {A} GROUP BY ALL HAVING c>1) GROUP BY 1""")
