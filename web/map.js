// Map: the grid cells of a region, month by month.
//
// - The timeline plays through the months; the color scale is fixed across
//   all months of the region so the animation compares like with like.
// - A box (drawn, the current view, or typed corners) sums the cells inside
//   it and exports them as CSV.
// - State lives in the URL: ?region=&year=&month=&metric=&cell=

var banner = document.getElementById("data-banner");
var rows = [];
var months = [];
var state = {
  metric: queryParam("metric") || "harmonized",
  index: 0,
  cell: queryParam("cell") ? Number(queryParam("cell")) : null,
  area: null,
};
var map = null;
var circles = null;
var areaRect = null;
var timer = null;
var drawing = { on: false, start: null };

var METRICS = [
  { value: "harmonized", label: "Harmonized" },
  { value: "modis", label: "MODIS" },
  { value: "viirs", label: "VIIRS" },
];
var FIELD = { harmonized: "harmonized_cell_days", modis: "modis_cell_days", viirs: "viirs_cell_days" };
var LABEL = { harmonized: "Harmonized detections", modis: "MODIS detections", viirs: "VIIRS detections" };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
  });
}

segmented(document.getElementById("metric"), METRICS, state.metric, function (value) {
  state.metric = value;
  setParams({ metric: value === "harmonized" ? null : value });
  drawAll(false);
});

if (typeof L === "undefined") {
  banner.dataset.source = "offline";
  banner.textContent = "The map library did not load. The page needs a network connection for Leaflet and the map tiles.";
} else {
  map = L.map("map", { zoomControl: false, worldCopyJump: true });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
  }).addTo(map);
  circles = L.layerGroup().addTo(map);
  map.setView([-20, -55], 4);
  setupDrawing();
}

fetchGold("gold_cell_monthly")
  .then(function (data) {
    rows = data.rows || [];
    showBanner(banner, data);
    loadRegion(true);
    // A new region keeps the month on the timeline when that month exists there.
    onRegionChange(function () {
      stop();
      state.cell = null;
      clearArea();
      var m = months[state.index];
      setParams({ cell: null, year: m ? m.year : null, month: m ? m.month : null });
      loadRegion(false);
    });
  })
  .catch(function () { showOffline(banner); });

document.addEventListener("themechange", function () { if (rows.length) drawAll(false); });
document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); });

// ---------- data access ----------

function stratum() {
  var region = regionById(currentRegion());
  return region ? region.stratum : "";
}

function regionCells() {
  var s = stratum();
  return rows.filter(function (row) { return row.stratum_id === s; });
}

function monthRows(i) {
  var m = months[i];
  if (!m) return [];
  return regionCells().filter(function (row) { return row.year === m.year && row.month === m.month; });
}

function metricValue(row) {
  return row ? row[FIELD[state.metric]] : null;
}

function scaleMax() {
  var values = regionCells().map(metricValue).filter(function (v) { return !isMissing(v); });
  return values.length ? Math.max.apply(null, values) : 1;
}

function loadRegion(first) {
  var seen = {};
  months = [];
  regionCells().forEach(function (row) {
    var key = row.year * 100 + row.month;
    if (!seen[key]) {
      seen[key] = true;
      months.push({ year: row.year, month: row.month, key: key });
    }
  });
  months.sort(function (a, b) { return a.key - b.key; });

  var y = Number(queryParam("year"));
  var m = Number(queryParam("month"));
  var wanted = months.findIndex(function (item) { return item.year === y && item.month === m; });
  state.index = wanted >= 0 ? wanted : Math.max(0, months.length - 1);
  if (first && y && m && wanted < 0) {
    banner.dataset.source = "sample";
    banner.textContent = "No grid cells for " + monthLabel(y, m) + " in this dataset. Showing the latest month instead.";
  }

  document.getElementById("eyebrow").textContent = "Argentina · grid cells";
  var slider = document.getElementById("slider");
  slider.max = Math.max(0, months.length - 1);
  slider.value = state.index;
  drawAll(true);
}

// ---------- drawing ----------

function drawAll(fit) {
  drawCircles(fit);
  drawTimeline();
  drawLegend();
  drawMonthTotal();
  drawList();
  drawDetail();
  drawArea();
}

function drawCircles(fit) {
  if (!map) return;
  circles.clearLayers();
  var visible = monthRows(state.index);
  var max = scaleMax();
  var ink = cssVar("--ink");
  var surface = cssVar("--surface");
  var bounds = [];
  visible.forEach(function (row) {
    var v = metricValue(row);
    var missing = isMissing(v);
    var t = missing ? 0 : v / max;
    var selected = row.cell_id === state.cell;
    var marker = L.circleMarker([row.lat_center, row.lon_center], {
      radius: missing ? 6 : 6 + 16 * Math.sqrt(t),
      color: selected ? ink : surface,
      weight: selected ? 3 : 1.5,
      fillColor: missing ? cssVar("--muted") : rampColor(t),
      fillOpacity: missing ? 0.25 : 0.88,
    });
    marker.bindTooltip(
      "<strong>Cell " + escapeHtml(row.cell_id) + "</strong><br>" +
      escapeHtml(LABEL[state.metric]) + ": <strong>" + (missing ? "no value" : escapeHtml(formatNumber(v))) + "</strong><br>" +
      "<span style='color:var(--muted)'>" + escapeHtml(row.lat_center) + "°, " + escapeHtml(row.lon_center) + "°</span>",
      { className: "cell-tip", direction: "top", offset: [0, -6] }
    );
    marker.on("click", function () { selectCell(row.cell_id); });
    marker.addTo(circles);
    if (selected) marker.bringToFront();
    bounds.push([row.lat_center, row.lon_center]);
  });
  if (fit && bounds.length) startView(bounds);
}

// Open at continent scale, centered on the region, so the cells read in the
// context of the whole subcontinent. Zoom in with the buttons or the wheel.
var START_ZOOM = 5;
var START_ZOOM_SMALL = 4;

function startView(points) {
  var lat = 0;
  var lon = 0;
  points.forEach(function (p) { lat += p[0]; lon += p[1]; });
  map.setView([lat / points.length, lon / points.length], window.innerWidth < 760 ? START_ZOOM_SMALL : START_ZOOM, { animate: false });
}

function drawTimeline() {
  var bars = document.getElementById("timeline-bars");
  bars.innerHTML = "";
  var totals = months.map(function (m, i) {
    return monthRows(i).reduce(function (sum, row) { return sum + (metricValue(row) || 0); }, 0);
  });
  var max = Math.max.apply(null, totals.concat([1]));
  months.forEach(function (m, i) {
    var bar = el("button", {
      type: "button",
      tabindex: "-1",
      "aria-current": String(i === state.index),
      "aria-label": monthLabel(m.year, m.month),
      style: "height:" + Math.max(3, (34 * totals[i]) / max) + "px",
    });
    bar.addEventListener("pointermove", function (event) {
      Tip.show({ title: monthLabel(m.year, m.month), rows: [{ label: "Region total", value: formatNumber(totals[i]), color: cssVar("--r2"), kind: "box" }], note: "Click to show this month" }, event.clientX, event.clientY);
    });
    bar.addEventListener("pointerleave", Tip.hide);
    bar.addEventListener("click", function () { goTo(i); });
    bars.appendChild(bar);
  });
  var m = months[state.index];
  var label = document.getElementById("timeline-label");
  label.innerHTML = "";
  label.appendChild(el("strong", { text: m ? monthLabel(m.year, m.month) : "No months" }));
  label.appendChild(el("span", { text: m ? formatNumber(totals[state.index]) + " " + LABEL[state.metric].toLowerCase() : "" }));
  var slider = document.getElementById("slider");
  slider.value = state.index;
  slider.setAttribute("aria-valuetext", m ? monthLabel(m.year, m.month) : "");
}

function drawLegend() {
  var host = document.getElementById("map-legend");
  host.innerHTML = "";
  var max = scaleMax();
  host.appendChild(el("div", { class: "small", style: "font-weight:650;margin-bottom:0.35rem", text: LABEL[state.metric] + " per cell" }));
  var ramp = el("div", { class: "ramp" });
  ["--r1", "--r2", "--r3", "--r4", "--r5"].forEach(function (v) { ramp.appendChild(el("span", { style: "background:" + cssVar(v) })); });
  host.appendChild(el("div", { class: "ramp-legend" }, [ramp, el("div", { class: "ends" }, [el("span", { text: "0" }), el("span", { text: formatCompact(max) })])]));
  host.appendChild(el("p", { class: "small muted", style: "margin:0.4rem 0 0", text: "Size grows with the value. The scale is fixed across all months, so the timeline compares like with like." }));
}

function drawMonthTotal() {
  var host = document.getElementById("month-total");
  host.innerHTML = "";
  var visible = monthRows(state.index);
  var total = visible.reduce(function (sum, row) { return sum + (metricValue(row) || 0); }, 0);
  var m = months[state.index];
  host.appendChild(el("div", { class: "kpi-label", text: m ? "Argentina total, " + monthLabel(m.year, m.month) : "Argentina total" }));
  var value = el("div", { class: "kpi-value", style: "font-size:1.6rem", text: formatNumber(total) });
  value.appendChild(el("span", { class: "unit", text: "detections · " + visible.length + " cells" }));
  host.appendChild(value);
  if (m) {
    host.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:0.3rem 1rem" }, [
      el("a", { class: "small", href: "regions.html?region=argentina&year=" + m.year + "&month=" + m.month, text: "This month in the calendar →" }),
    ]));
  }
}

function drawList() {
  var list = document.getElementById("cell-list");
  list.innerHTML = "";
  var visible = monthRows(state.index).slice().sort(function (a, b) { return (metricValue(b) || 0) - (metricValue(a) || 0); });
  var max = Math.max.apply(null, visible.map(function (row) { return metricValue(row) || 0; }).concat([1]));
  visible.forEach(function (row) {
    var v = metricValue(row);
    var button = el("button", { type: "button", "aria-pressed": String(row.cell_id === state.cell) }, [
      el("span", null, ["Cell " + row.cell_id, el("span", { class: "bar-inline", style: "width:" + (100 * (v || 0)) / max + "%" })]),
      el("span", { class: "num", text: isMissing(v) ? "–" : formatNumber(v) }),
    ]);
    button.addEventListener("click", function () { selectCell(row.cell_id, true); });
    list.appendChild(el("li", null, [button]));
  });
  if (!visible.length) list.appendChild(el("li", { class: "small muted", text: "No cells this month." }));
}

function selectCell(id, pan) {
  state.cell = id;
  setParams({ cell: id });
  drawCircles(false);
  drawList();
  drawDetail();
  if (pan && map) {
    var row = monthRows(state.index).filter(function (r) { return r.cell_id === id; })[0];
    if (row) map.panTo([row.lat_center, row.lon_center]);
  }
}

function drawDetail() {
  var host = document.getElementById("cell-detail");
  host.innerHTML = "";
  var row = monthRows(state.index).filter(function (r) { return r.cell_id === state.cell; })[0];
  if (!row) {
    host.appendChild(el("h2", { text: state.cell ? "Cell " + state.cell + " is quiet this month" : "Select a cell" }));
    host.appendChild(el("p", { class: "small muted", text: state.cell ? "It has no record in this month. Move the timeline, or pick another cell." : "Click a circle on the map or a row in the list below." }));
    return;
  }
  var head = el("div", { class: "card-head", style: "margin-bottom:0.2rem" }, [
    el("h2", { text: "Cell " + row.cell_id }),
    el("button", { type: "button", class: "btn small ghost icon", "aria-label": "Close cell details", html: icon("close", 16), onclick: function () { state.cell = null; setParams({ cell: null }); drawCircles(false); drawList(); drawDetail(); } }),
  ]);
  host.appendChild(head);
  host.appendChild(el("p", { class: "small muted", text: row.lat_center + "°, " + row.lon_center + "° · the center of the cell, not one fire" }));

  var history = months.map(function (m) {
    var r = regionCells().filter(function (x) { return x.cell_id === row.cell_id && x.year === m.year && x.month === m.month; })[0];
    return r ? metricValue(r) : null;
  });
  var spark = el("div", { class: "chart", style: "min-height:44px" });
  host.appendChild(el("div", { class: "small muted", style: "margin-top:0.4rem", text: LABEL[state.metric] + ", every month on the timeline" }));
  host.appendChild(spark);
  sparkline(spark, {
    values: history,
    markIndex: state.index,
    height: 44,
    titles: months.map(function (m) { return monthLabel(m.year, m.month); }),
    label: LABEL[state.metric],
  });

  var ratioText = row.calibration_ratio === null ? "Not applied" : String(row.calibration_ratio);
  var dl = el("dl", { class: "metric compact" });
  dl.innerHTML =
    metricItem(term("harmonized-detections", "Harmonized"), formatNumber(row.harmonized_cell_days)) +
    metricItem(term("source", "Source"), escapeHtml(sourceLabel(row.source)) + (row.is_provisional ? ", provisional" : "")) +
    metricItem(term("modis", "MODIS"), formatNumber(row.modis_cell_days) + " <span class='small muted'>detections · " + formatNumber(row.modis_hotspots) + " " + term("hotspot", "hotspots") + "</span>") +
    metricItem(term("viirs", "VIIRS"), formatNumber(row.viirs_cell_days) + " <span class='small muted'>detections · " + formatNumber(row.viirs_hotspots) + " hotspots</span>") +
    metricItem(term("calibration-ratio", "Calibration ratio"), ratioText) +
    metricItem(term("stratum", "Stratum"), escapeHtml(row.stratum_id));
  host.appendChild(dl);
  host.appendChild(el("p", { class: "small muted", text: row.calibration_ratio === null
    ? "VIIRS is the source for this cell, so the month is already on the common scale; the ratio is only used when a cell has to be filled from MODIS."
    : "VIIRS detections divided by MODIS Aqua detections for this calendar month, measured over Argentina in 2012 to 2019. It lifts the MODIS count onto the VIIRS scale." }));
}

// ---------- timeline controls ----------

function goTo(i) {
  if (!months.length) return;
  state.index = (i + months.length) % months.length;
  var m = months[state.index];
  setParams({ year: m.year, month: m.month });
  drawCircles(false);
  drawTimeline();
  drawMonthTotal();
  drawList();
  drawDetail();
  drawArea();
}

function play() {
  if (timer) return stop();
  var button = document.getElementById("play");
  button.innerHTML = icon("pause", 16);
  button.setAttribute("aria-label", "Pause");
  timer = setInterval(function () { goTo(state.index + 1); }, 1100);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  var button = document.getElementById("play");
  button.innerHTML = icon("play", 16);
  button.setAttribute("aria-label", "Play through the months");
}

document.getElementById("play").addEventListener("click", play);
document.getElementById("prev").addEventListener("click", function () { stop(); goTo(state.index - 1); });
document.getElementById("next").addEventListener("click", function () { stop(); goTo(state.index + 1); });
document.getElementById("slider").addEventListener("input", function (event) { stop(); goTo(Number(event.target.value)); });

// ---------- area of interest ----------

function setupDrawing() {
  var button = document.getElementById("draw-area");
  button.addEventListener("click", function () {
    drawing.on = !drawing.on;
    button.setAttribute("aria-pressed", String(drawing.on));
    document.body.classList.toggle("drawing", drawing.on);
    if (drawing.on) { map.dragging.disable(); map.boxZoom.disable(); }
    else { map.dragging.enable(); map.boxZoom.enable(); }
  });
  map.on("mousedown", function (event) {
    if (!drawing.on) return;
    drawing.start = event.latlng;
    if (areaRect) areaRect.remove();
    areaRect = L.rectangle([event.latlng, event.latlng], areaStyle()).addTo(map);
  });
  map.on("mousemove", function (event) {
    if (!drawing.on || !drawing.start) return;
    areaRect.setBounds(L.latLngBounds(drawing.start, event.latlng));
  });
  map.on("mouseup", function (event) {
    if (!drawing.on || !drawing.start) return;
    var bounds = L.latLngBounds(drawing.start, event.latlng);
    drawing.start = null;
    drawing.on = false;
    button.setAttribute("aria-pressed", "false");
    document.body.classList.remove("drawing");
    map.dragging.enable();
    map.boxZoom.enable();
    setArea(bounds);
  });

  document.getElementById("view-area").addEventListener("click", function () { setArea(map.getBounds()); });
  document.getElementById("clear-area").addEventListener("click", clearArea);
  document.getElementById("coords-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var f = event.target;
    var south = Number(f.south.value);
    var north = Number(f.north.value);
    var west = Number(f.west.value);
    var east = Number(f.east.value);
    if (south >= north || west >= east) {
      document.getElementById("area-summary").textContent = "South must be below north, and west must be left of east.";
      return;
    }
    setArea(L.latLngBounds([south, west], [north, east]));
    map.fitBounds(areaRect.getBounds(), { padding: [40, 40] });
  });
}

function areaStyle() {
  return { color: cssVar("--accent"), weight: 2, dashArray: "6 4", fillColor: cssVar("--accent"), fillOpacity: 0.08 };
}

function setArea(bounds) {
  state.area = bounds;
  if (areaRect) areaRect.remove();
  areaRect = L.rectangle(bounds, areaStyle()).addTo(map);
  var f = document.getElementById("coords-form");
  f.south.value = bounds.getSouth().toFixed(2);
  f.north.value = bounds.getNorth().toFixed(2);
  f.west.value = bounds.getWest().toFixed(2);
  f.east.value = bounds.getEast().toFixed(2);
  document.getElementById("clear-area").hidden = false;
  drawArea();
}

function clearArea() {
  state.area = null;
  if (areaRect) { areaRect.remove(); areaRect = null; }
  var clear = document.getElementById("clear-area");
  if (clear) clear.hidden = true;
  var summary = document.getElementById("area-summary");
  if (summary) summary.innerHTML = "";
}

function inArea(row) {
  return state.area && state.area.contains(L.latLng(row.lat_center, row.lon_center));
}

function drawArea() {
  var host = document.getElementById("area-summary");
  if (!state.area) { host.innerHTML = ""; return; }
  if (areaRect) areaRect.setStyle(areaStyle());
  host.innerHTML = "";
  var inside = regionCells().filter(inArea);
  var ids = {};
  inside.forEach(function (row) { ids[row.cell_id] = true; });
  var nCells = Object.keys(ids).length;
  var now = monthRows(state.index).filter(inArea);
  var nowTotal = now.reduce(function (sum, row) { return sum + (metricValue(row) || 0); }, 0);
  var totals = months.map(function (m, i) {
    return monthRows(i).filter(inArea).reduce(function (sum, row) { return sum + (metricValue(row) || 0); }, 0);
  });
  var m = months[state.index];

  var box = el("div", { class: "area-summary" });
  box.appendChild(el("div", { class: "kpi-label", text: nCells + " cells inside" + (m ? " · " + monthLabel(m.year, m.month) : "") }));
  var value = el("div", { class: "kpi-value", style: "font-size:1.4rem", text: formatNumber(nowTotal) });
  value.appendChild(el("span", { class: "unit", text: LABEL[state.metric].toLowerCase() }));
  box.appendChild(value);
  var spark = el("div", { class: "chart", style: "min-height:40px" });
  box.appendChild(spark);
  host.appendChild(box);
  sparkline(spark, { values: totals, markIndex: state.index, height: 40, titles: months.map(function (x) { return monthLabel(x.year, x.month); }), label: "Area total" });

  var download = el("button", { type: "button", class: "btn small", style: "margin-top:0.5rem", html: icon("download", 16) + "Download CSV (" + inside.length + " rows)" });
  download.disabled = !inside.length;
  download.addEventListener("click", function () {
    var header = ["cell_id", "lat_center", "lon_center", "year", "month", "harmonized_cell_days", "modis_cell_days", "viirs_cell_days", "modis_hotspots", "viirs_hotspots", "source", "calibration_ratio", "is_provisional", "stratum_id"];
    var sorted = inside.slice().sort(function (a, b) { return a.year - b.year || a.month - b.month || a.cell_id - b.cell_id; });
    downloadCsv(currentRegion() + "_area_cells.csv", header, sorted.map(function (row) {
      return header.map(function (key) { return (row[key] === null || row[key] === undefined) && /hotspots$/.test(key) ? "not included" : row[key]; });
    }));
  });
  host.appendChild(download);
}
