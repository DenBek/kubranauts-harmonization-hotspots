"""Step 0: profile the silver layer (cheap: parquet metadata + a few grouped queries)."""
import time
from common import connect_r2, SILVER, BUCKET

con = connect_r2()
t = time.time()
print("== files and rows (parquet metadata) ==")
print(con.sql(f"""
  SELECT regexp_extract(file_name, 'source=([^/]+)', 1) AS source,
         regexp_extract(file_name, 'year=([0-9]+)', 1)::INT AS year,
         regexp_extract(file_name, '([a-z]+)[.]parquet$', 1) AS part,
         sum(row_group_num_rows) AS rows
  FROM (SELECT DISTINCT file_name, row_group_id, row_group_num_rows
        FROM parquet_metadata('{BUCKET}/silver/detections/*/*/*.parquet'))
  GROUP BY ALL ORDER BY source, year, part
""").df().to_string())
print(f"{time.time()-t:.0f}s")
print("== schema ==")
print(con.sql(f"DESCRIBE SELECT * FROM {SILVER}").df()[["column_name","column_type"]].to_string())
