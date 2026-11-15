"""Pairwise matched-day aggregation helper."""
QTY = ["n", "frp", "celldays", "cells25"]


def pair(con, a, b, dn="A", zone="ALL", y0=2000, y1=2026, by="month", table="daily", extra_group=""):
    """Sum quantities for satellites a and b over local dates valid for BOTH.

    by: 'month' | 'year' | 'day'. Returns columns t, <q>_a, <q>_b for q in QTY.
    """
    t = {"month": "date_trunc('month', d.local_date)", "year": "date_trunc('year', d.local_date)",
         "day": "d.local_date"}[by]
    zf = f"AND zone = '{zone}'" if table == "daily" and zone else ""
    eg = f", {extra_group}" if extra_group else ""
    sums = ", ".join(
        f"coalesce(sum({q}) FILTER (WHERE satellite = '{a}'), 0) AS {q}_a, "
        f"coalesce(sum({q}) FILTER (WHERE satellite = '{b}'), 0) AS {q}_b" for q in QTY)
    q = f"""
    WITH both_ AS (SELECT local_date FROM valid WHERE satellite = '{a}'
                   INTERSECT SELECT local_date FROM valid WHERE satellite = '{b}'),
    d AS (SELECT * FROM {table} JOIN both_ USING (local_date)
          WHERE dn = '{dn}' {zf} AND year(local_date) BETWEEN {y0} AND {y1} AND satellite IN ('{a}', '{b}'))
    SELECT {t} AS t{eg}, {sums}
    FROM d GROUP BY ALL ORDER BY ALL"""
    return con.sql(q).df()
