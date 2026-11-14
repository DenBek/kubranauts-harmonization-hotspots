"""Write illustrative gold-table JSON for the website.

The numbers are not FIRMS detections. Cells for 2024 and 2025 sum to the
matching gold_region_monthly row. Annual totals sum those months. The
headline quotes the same November 2025 ratio.

Run from the repo root: python scripts/build_sample_gold.py
This does not upload to R2.
"""

import json
import statistics
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "sample"
NOTE = (
    "Sample data for layout only. These figures are not FIRMS detections. "
    "Live tables replace a file when scripts/export_calendar.py writes "
    "publish/<table>.json. See WEB_DEPLOYMENT.md."
)
AS_OF = date(2025, 9, 1)
HEADLINE_MONTH = 9
THROUGH = 11

REGIONS = [
    {
        "id": "argentina_chaco",
        "name": "Argentine Chaco",
        "stratum": "chaco",
        "base": 8200,
        "weights": [0.40, 0.35, 0.32, 0.38, 0.55, 0.80, 1.15, 1.70, 1.95, 1.50, 0.85, 0.50],
        "lats": [-23.25, -24.25, -25.25, -26.25],
        "lons": [-63.25, -62.25, -61.25, -60.25],
        "skip": {(0, 0), (0, 3), (3, 0), (3, 3)},
    },
    {
        "id": "brazil_cerrado",
        "name": "Brazilian Cerrado",
        "stratum": "cerrado",
        "base": 14600,
        "weights": [0.35, 0.30, 0.35, 0.50, 0.75, 1.05, 1.55, 2.00, 1.65, 1.05, 0.55, 0.38],
        "lats": [-13.25, -14.25, -15.25],
        "lons": [-48.75, -47.75, -46.75],
        "skip": {(0, 2)},
    },
]
RATIOS = {
    "chaco": [1.15, 1.12, 1.08, 1.10, 1.18, 1.25, 1.32, 1.40, 1.38, 1.28, 1.20, 1.16],
    "cerrado": [1.22, 1.18, 1.14, 1.16, 1.24, 1.36, 1.48, 1.55, 1.46, 1.34, 1.26, 1.20],
}
YEARS = [2000] + list(range(2016, 2026))
CELL_YEARS = [2024, 2025]
YEAR_FACTOR = {
    2000: 0.70, 2016: 0.84, 2017: 0.90, 2018: 0.95, 2019: 0.88,
    2020: 1.02, 2021: 0.98, 2022: 1.10, 2023: 1.42, 2024: 1.08, 2025: 0.96,
}


def wobble(year, month, salt):
    return 1 + 0.06 * (((year + month * 3 + salt) % 5) - 2)


def classify(ratio):
    if ratio is None:
        return None
    if ratio < 0.5:
        return "much_below"
    if ratio < 0.8:
        return "below"
    if ratio <= 1.2:
        return "normal"
    if ratio <= 1.8:
        return "above"
    return "much_above"


def months_for(year):
    if year == 2000:
        return list(range(7, 13))
    if year == 2025:
        return list(range(1, THROUGH + 1))
    return list(range(1, 13))


def viirs_exists(year, month):
    return year > 2018 or (year == 2018 and month >= 4)


def source_for(year, month):
    if not viirs_exists(year, month):
        return "modis_calibrated"
    if year == 2025 and month == 11:
        return "viirs_nrt"
    return "viirs_archive"


def cells_for(region):
    found = []
    n = 0
    for iy, lat in enumerate(region["lats"]):
        for ix, lon in enumerate(region["lons"]):
            if (iy, ix) in region["skip"]:
                continue
            weight = 0.65 + 0.12 * n
            found.append({
                "cell_id": 1000 + n if region["stratum"] == "chaco" else 2000 + n,
                "cell_x": ix,
                "cell_y": iy,
                "lon_center": lon,
                "lat_center": lat,
                "weight": weight,
            })
            n += 1
    return found


def main():
    cell_rows = []
    raw = {}
    for region in REGIONS:
        cells = cells_for(region)
        weight_sum = sum(cell["weight"] for cell in cells)
        for year in YEARS:
            for month in months_for(year):
                ratio = RATIOS[region["stratum"]][month - 1]
                if year in CELL_YEARS:
                    total_h = 0
                    total_m = 0
                    total_v = 0
                    for cell in cells:
                        harmonized = max(1, round(
                            region["base"] * (cell["weight"] / weight_sum)
                            * region["weights"][month - 1]
                            * YEAR_FACTOR[year]
                            * wobble(year, month, cell["cell_id"])
                        ))
                        if year == 2025 and month == HEADLINE_MONTH:
                            harmonized = round(harmonized * 2.2)
                        viirs_days = harmonized
                        modis_days = max(1, round(harmonized / ratio))
                        src = source_for(year, month)
                        cell_rows.append({
                            "cell_id": cell["cell_id"],
                            "cell_x": cell["cell_x"],
                            "cell_y": cell["cell_y"],
                            "lon_center": cell["lon_center"],
                            "lat_center": cell["lat_center"],
                            "year": year,
                            "month": month,
                            "month_start": date(year, month, 1).isoformat(),
                            "modis_hotspots": round(modis_days * 0.42),
                            "modis_cell_days": modis_days,
                            "viirs_hotspots": round(viirs_days * 0.55),
                            "viirs_cell_days": viirs_days,
                            "stratum_id": region["stratum"],
                            "calibration_ratio": None if src != "modis_calibrated" else round(ratio, 3),
                            "harmonized_cell_days": harmonized,
                            "source": src,
                            "is_provisional": year == 2025 and month == 11,
                        })
                        total_h += harmonized
                        total_m += modis_days
                        total_v += viirs_days
                    raw[(region["id"], year, month)] = (total_h, total_m, total_v, ratio)
                else:
                    modis_days = max(1, round(
                        region["base"] * region["weights"][month - 1]
                        * YEAR_FACTOR[year] * wobble(year, month, 1)
                    ))
                    if viirs_exists(year, month):
                        viirs_days = max(1, round(modis_days * ratio * wobble(year, month, 2)))
                        harmonized = viirs_days
                    else:
                        viirs_days = None
                        harmonized = round(modis_days * ratio)
                    raw[(region["id"], year, month)] = (harmonized, modis_days, viirs_days, ratio)

    region_rows = []
    for region in REGIONS:
        by_month = {m: [] for m in range(1, 13)}
        for (rid, year, month), (harmonized, _m, _v, _r) in raw.items():
            if rid == region["id"]:
                by_month[month].append(harmonized)
        medians = {m: statistics.median(vals) if vals else 0 for m, vals in by_month.items()}
        for month, vals in by_month.items():
            vals_sorted = sorted(vals)
            by_month[month] = vals_sorted
        for (rid, year, month), (harmonized, modis_days, viirs_days, ratio) in sorted(raw.items()):
            if rid != region["id"]:
                continue
            peers = [value for (other, y, m), (value, _a, _b, _c) in raw.items() if other == rid and m == month]
            higher = sum(1 for value in peers if value > harmonized)
            rank = higher + 1
            percentile = round(100 * sum(1 for value in peers if value <= harmonized) / len(peers), 1)
            median = medians[month]
            ratio_anom = None if median == 0 else round(harmonized / median, 3)
            peers_sorted = sorted(peers)
            def pct(p):
                if not peers_sorted:
                    return None
                k = (len(peers_sorted) - 1) * p
                lo = int(k)
                hi = min(lo + 1, len(peers_sorted) - 1)
                return round(peers_sorted[lo] + (peers_sorted[hi] - peers_sorted[lo]) * (k - lo), 1)
            region_rows.append({
                "region_id": rid,
                "year": year,
                "month": month,
                "month_start": date(year, month, 1).isoformat(),
                "harmonized_cell_days": harmonized,
                "modis_cell_days": modis_days,
                "viirs_cell_days": viirs_days,
                "source": source_for(year, month),
                "is_complete": not (year == 2025 and month == 11),
                "is_provisional": year == 2025 and month == 11,
                "baseline_median": round(median, 1),
                "baseline_mean": round(statistics.fmean(peers), 1),
                "baseline_p25": pct(0.25),
                "baseline_p75": pct(0.75),
                "baseline_min": min(peers),
                "baseline_max": max(peers),
                "anomaly_ratio": ratio_anom,
                "anomaly_diff": round(harmonized - median, 1),
                "anomaly_class": classify(ratio_anom),
                "percentile_rank": percentile,
                "rank_in_month": rank,
                "n_years_ranked": len(peers),
            })

    annual_rows = []
    for region in REGIONS:
        yearly = []
        for year in YEARS:
            points = [row for row in region_rows if row["region_id"] == region["id"] and row["year"] == year]
            points.sort(key=lambda row: row["month"])
            total = sum(row["harmonized_cell_days"] for row in points)
            yearly.append((year, total, points))
        annual_median = statistics.median(total for _y, total, _p in yearly)
        ranked = sorted(yearly, key=lambda item: item[1], reverse=True)
        rank_of = {year: index + 1 for index, (year, _t, _p) in enumerate(ranked)}
        for year, total, points in yearly:
            running = 0
            start = mid = end = points[0]["month"]
            seen_start = seen_mid = seen_end = False
            for row in points:
                running += row["harmonized_cell_days"]
                if not seen_start and running >= 0.10 * total:
                    start = row["month"]
                    seen_start = True
                if not seen_mid and running >= 0.50 * total:
                    mid = row["month"]
                    seen_mid = True
                if not seen_end and running >= 0.90 * total:
                    end = row["month"]
                    seen_end = True
                    break
            peak = max(points, key=lambda row: row["harmonized_cell_days"])
            annual_rows.append({
                "region_id": region["id"],
                "year": year,
                "harmonized_cell_days": total,
                "rank": rank_of[year],
                "n_years_ranked": len(yearly),
                "anomaly_ratio": round(total / annual_median, 3) if annual_median else None,
                "peak_month": peak["month"],
                "peak_month_cell_days": peak["harmonized_cell_days"],
                "season_start_month": start,
                "season_midpoint_month": mid,
                "season_end_month": end,
                "season_length_months": end - start + 1,
                "months_available": len(points),
                "is_complete": year != 2000 and year != 2025,
            })

    analog_rows = []
    for region in REGIONS:
        def series(year, limit):
            rows = [row for row in region_rows if row["region_id"] == region["id"] and row["year"] == year and row["month"] <= limit]
            return {row["month"]: row["harmonized_cell_days"] for row in rows}
        target = series(2025, THROUGH)
        scored = []
        for year in YEARS:
            if year == 2025:
                continue
            other = series(year, THROUGH)
            if len(other) < THROUGH and year != 2000:
                continue
            if len(other) < 6:
                continue
            shared = [m for m in target if m in other]
            if len(shared) < 6:
                continue
            scale = max(target.values()) or 1
            distance = (sum((target[m] - other[m]) ** 2 for m in shared) / len(shared)) ** 0.5 / scale
            scored.append((distance, year))
        scored.sort()
        rest_values = []
        for row in region_rows:
            if row["region_id"] == region["id"] and row["month"] == 12:
                rest_values.append(row["harmonized_cell_days"])
        rest_median = statistics.median(rest_values) if rest_values else 0
        for rank, (distance, year) in enumerate(scored[:3], start=1):
            rest = next(row["harmonized_cell_days"] for row in region_rows if row["region_id"] == region["id"] and row["year"] == year and row["month"] == 12)
            similarity = max(0, round(100 * (1 - min(distance, 1)), 1))
            analog_rows.append({
                "region_id": region["id"],
                "target_year": 2025,
                "through_month": THROUGH,
                "analog_year": year,
                "rank": rank,
                "distance": round(distance, 1),
                "similarity_pct": similarity,
                "analog_rest_of_year_cell_days": rest,
                "analog_rest_vs_median": round(rest / rest_median, 3) if rest_median else None,
                "computed_at": "2025-11-14T12:00:00Z",
            })

    headlines = []
    for region in REGIONS:
        month_row = next(row for row in region_rows if row["region_id"] == region["id"] and row["year"] == 2025 and row["month"] == HEADLINE_MONTH)
        ytd = sum(row["harmonized_cell_days"] for row in region_rows if row["region_id"] == region["id"] and row["year"] == 2025 and row["month"] <= 11)
        other_ytd = []
        for year in YEARS:
            if year == 2025:
                continue
            months = [row["harmonized_cell_days"] for row in region_rows if row["region_id"] == region["id"] and row["year"] == year and row["month"] <= 11]
            if len(months) >= 6:
                other_ytd.append(sum(months))
        ytd_median = statistics.median(other_ytd) if other_ytd else 0
        top = next(row for row in analog_rows if row["region_id"] == region["id"] and row["rank"] == 1)
        ratio = month_row["anomaly_ratio"]
        month_name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][HEADLINE_MONTH - 1]
        headline = (
            f"{month_name} 2025: {ratio}× the usual {month_name}, "
            f"rank {month_row['rank_in_month']} of {month_row['n_years_ranked']}."
        )
        alt = (
            f"{region['name']} in {month_name} 2025 has {month_row['harmonized_cell_days']} harmonized cell-days. "
            f"{headline} Closest earlier year through November is {top['analog_year']}."
        )
        headlines.append({
            "region_id": region["id"],
            "as_of_month": AS_OF.isoformat(),
            "headline": headline,
            "alt_text": alt,
            "month_anomaly_ratio": ratio,
            "month_rank_in_month": month_row["rank_in_month"],
            "ytd_cell_days": ytd,
            "ytd_vs_median": round(ytd / ytd_median, 3) if ytd_median else None,
            "top_analog_year": top["analog_year"],
        })

    calibration = []
    for stratum, ratios in RATIOS.items():
        for month, ratio in enumerate(ratios, start=1):
            calibration.append({
                "stratum_id": stratum,
                "month": month,
                "ratio": ratio,
                "modis_cell_days_fit": 180000 + month * 1000,
                "viirs_cell_days_fit": round((180000 + month * 1000) * ratio),
                "n_months": 69,
                "fit_start": "2018-04-01",
                "fit_end": "2023-12-01",
                "holdout_mape": 12.4 if stratum == "chaco" else 15.8,
                "viirs_sensor": "viirs_noaa20",
                "method_version": "monthly_ratio_v1",
            })

    files = {
        "gold_cell_monthly": cell_rows,
        "gold_region_monthly": region_rows,
        "gold_region_annual": annual_rows,
        "gold_region_analogs": analog_rows,
        "gold_region_headline": headlines,
        "gold_calibration": calibration,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, rows in files.items():
        doc = {"source": "sample", "dataset": "sample", "note": NOTE, "rows": rows}
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"{name}: {len(rows)} rows")

    for region in REGIONS:
        for year in CELL_YEARS:
            for month in months_for(year):
                cell_sum = sum(
                    row["harmonized_cell_days"] for row in cell_rows
                    if row["stratum_id"] == region["stratum"] and row["year"] == year and row["month"] == month
                )
                region_value = next(
                    row["harmonized_cell_days"] for row in region_rows
                    if row["region_id"] == region["id"] and row["year"] == year and row["month"] == month
                )
                if cell_sum != region_value:
                    raise SystemExit(f"Cell sum mismatch {region['id']} {year}-{month}: {cell_sum} != {region_value}")
    print("Cell sums match region months for 2024 and 2025.")


if __name__ == "__main__":
    main()
