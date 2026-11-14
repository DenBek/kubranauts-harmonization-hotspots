var banner = document.getElementById("data-banner");
var regionSelect = document.getElementById("region");
var yearSelect = document.getElementById("year");
var monthSelect = document.getElementById("month");
var metricSelect = document.getElementById("metric");
var rows = [];
var map;
var layer;

fillRegionSelect(regionSelect, queryParam("region") || REGIONS[0].id);

if (typeof L === "undefined") {
  banner.textContent = "The map library did not load. The page needs a network connection for Leaflet.";
} else {
  map = L.map("map");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  map.setView([-24.5, -61.5], 6);
}

fetchGold("gold_cell_monthly")
  .then(function (data) {
    rows = data.rows || [];
    showBanner(banner, data);
    regionSelect.addEventListener("change", function () {
      fillYears();
      draw();
    });
    yearSelect.addEventListener("change", function () {
      fillMonths();
      draw();
    });
    monthSelect.addEventListener("change", draw);
    metricSelect.addEventListener("change", draw);
    fillYears();
    if (queryParam("year")) yearSelect.value = queryParam("year");
    else if (yearSelect.querySelector("option[value='2025']")) yearSelect.value = "2025";
    fillMonths();
    if (queryParam("month")) monthSelect.value = queryParam("month");
    else if (monthSelect.querySelector("option[value='9']")) monthSelect.value = "9";
    draw();
  })
  .catch(function () {
    banner.textContent = "The data API is not running. From the repo root, run npx wrangler pages dev web and open http://localhost:8788.";
  });

function stratum() {
  var region = regionById(regionSelect.value);
  return region ? region.stratum : "";
}

function fillYears() {
  var years = [];
  rows.forEach(function (row) {
    if (row.stratum_id === stratum() && years.indexOf(row.year) === -1) years.push(row.year);
  });
  years.sort();
  var previous = yearSelect.value;
  yearSelect.innerHTML = "";
  years.forEach(function (year) {
    var option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  });
  if (previous && years.indexOf(Number(previous)) !== -1) yearSelect.value = previous;
  fillMonths();
}

function fillMonths() {
  var year = Number(yearSelect.value);
  var months = [];
  rows.forEach(function (row) {
    if (row.stratum_id === stratum() && row.year === year && months.indexOf(row.month) === -1) months.push(row.month);
  });
  months.sort(function (a, b) { return a - b; });
  var previous = monthSelect.value;
  monthSelect.innerHTML = "";
  months.forEach(function (month) {
    var option = document.createElement("option");
    option.value = String(month);
    option.textContent = MONTHS[month - 1];
    monthSelect.appendChild(option);
  });
  if (previous && months.indexOf(Number(previous)) !== -1) monthSelect.value = previous;
}

function metricValue(row) {
  if (metricSelect.value === "modis") return row.modis_cell_days;
  if (metricSelect.value === "viirs") return row.viirs_cell_days;
  return row.harmonized_cell_days;
}

function draw() {
  if (!layer) return;
  layer.clearLayers();
  var visible = rows.filter(function (row) {
    return row.stratum_id === stratum() && row.year === Number(yearSelect.value) && row.month === Number(monthSelect.value);
  });
  var values = visible.map(metricValue).filter(function (value) { return value !== null && value !== undefined; });
  var max = values.length ? Math.max.apply(null, values) : 1;
  var bounds = [];
  visible.forEach(function (row) {
    var value = metricValue(row);
    var missing = value === null || value === undefined;
    var color = missing ? "#8d8276" : ramp(value / max);
    var marker = L.circleMarker([row.lat_center, row.lon_center], {
      radius: missing ? 6 : 6 + 12 * (value / max),
      color: "#1c1612",
      weight: 1,
      fillColor: color,
      fillOpacity: missing ? 0.15 : 0.85,
    });
    marker.on("click", function () { showCell(row, value); });
    marker.addTo(layer);
    bounds.push([row.lat_center, row.lon_center]);
  });
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
  if (visible[0]) showCell(visible[0], metricValue(visible[0]));
}

function ramp(t) {
  var stops = ["#f8f1e4", "#f3d7a1", "#e8a04a", "#d4652a", "#8f2d12"];
  return stops[Math.round(Math.max(0, Math.min(1, t)) * (stops.length - 1))];
}

function showCell(row, value) {
  var panel = document.getElementById("detail");
  var missing = value === null || value === undefined;
  var reason = metricSelect.value === "viirs"
    ? "No VIIRS cell-days for this cell. In the live table, VIIRS is empty before April 2018."
    : "No MODIS cell-days for this cell.";
  var ratioText = row.calibration_ratio === null ? "Not applied" : String(row.calibration_ratio);
  var ratioHelp = row.calibration_ratio === null
    ? "VIIRS is the source for this cell, so the month is already on the scale the calendar uses. The ratio is only applied when the cell has to be filled from MODIS."
    : "VIIRS cell-days divided by MODIS cell-days for this biome and month, learned from the years both sensors overlap. It lifts the MODIS count onto the VIIRS scale.";
  panel.innerHTML =
    "<h2>Cell " + row.cell_id + "</h2>" +
    "<p class='muted'>" + row.lat_center + "°, " + row.lon_center + "°. The center of the grid cell, not a single fire.</p>" +
    "<dl class='metric'>" +
    metricItem(term(metricSelect.value === "modis" ? "modis" : metricSelect.value === "viirs" ? "viirs" : "harmonized-cell-days", "Shown value"), missing ? "No value" : formatNumber(value) + " cell-days", missing ? reason : "Cell-days in this cell for the value selected above. Harmonized is the comparable figure. MODIS and VIIRS are the two sensors before that comparison.") +
    metricItem(term("harmonized-cell-days", "Harmonized"), formatNumber(row.harmonized_cell_days), "The cell's contribution to the regional calendar. Summing these across the region gives the month total.") +
    metricItem(term("modis", "MODIS"), formatNumber(row.modis_cell_days) + " cell-days, " + formatNumber(row.modis_hotspots) + " hotspots", term("hotspot", "Hotspots") + " are the raw detections. Cell-days collapse those detections onto the grid so a day with many hits in one cell counts once. MODIS hotspots and VIIRS hotspots are not the same kind of count.") +
    metricItem(term("viirs", "VIIRS"), formatNumber(row.viirs_cell_days) + " cell-days, " + formatNumber(row.viirs_hotspots) + " hotspots", "The newer sensor, with a finer view of active fire. Empty before April 2018. A higher VIIRS count than MODIS for the same cell is expected.") +
    metricItem(term("source", "Source"), row.source + (row.is_provisional ? ", provisional" : ""), sourceHelp(row.source) + (row.is_provisional ? " Provisional means the number can still change." : "")) +
    metricItem(term("calibration-ratio", "Calibration ratio"), ratioText, ratioHelp + " " + term("stratum", "Stratum") + " " + row.stratum_id + " is the biome this ratio belongs to. One global ratio would mis-scale regions that burn differently.") +
    "</dl>";
}
