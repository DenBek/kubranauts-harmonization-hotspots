// Draw an area: sum the 1-degree gold_cell_monthly cells whose centres fall inside the shape, and show the same
// calendar, series, reliability flag and provisional rule as the Regions page.
// Reliability comes from gold_reliability, looked up with the area's MODIS Aqua count in each converted month.

(function () {
  var banner = document.getElementById("data-banner");
  document.getElementById("doc-approach").innerHTML = MVP.docLink("HARMONIZATION_APPROACH.md", "How the conversion works");
  document.getElementById("doc-scope").innerHTML = MVP.docLink("SCOPE_AND_GAPS.md", "Known gaps");

  var CELL = 1;                       // degrees, matches gold_cell_monthly
  var EXAMPLES = [
    { label: "Paraná Delta", rect: [-34.5, -32.1, -61, -58.4] },
    { label: "Córdoba and the Pampas", rect: [-35, -29.5, -66, -61] },
    { label: "Corrientes", rect: [-30.5, -27, -59, -55.5] },
    { label: "A small area (under 1 cell)", rect: [-32.9, -32.5, -60.9, -60.5] },
  ];

  var T = null, map = null, layer = null, cellLayer = null, mode = null, polyPts = [], polyLayer = null;
  var shape = null;                   // { type: "rect"|"poly", bounds, pts }
  var cellIndex = {};                 // cell_id -> { lat, lon, rows: [] }
  var monthMeta = {};                 // key -> { year, month, method }
  var grid = null, selectedKey = null, areaRows = [], areaInfo = null;
  var yearFrom = 2003, yearTo = 2026;

  // ---------- data ----------
  function index(rows) {
    rows.forEach(function (r) {
      var c = cellIndex[r.cell_id] || (cellIndex[r.cell_id] = { lat: r.lat_center, lon: r.lon_center, rows: [] });
      c.rows.push(r);
      var key = r.year * 100 + r.month;
      if (!monthMeta[key]) monthMeta[key] = { year: r.year, month: r.month, method: r.method };
    });
  }

  function inPoly(lat, lon, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var yi = pts[i][0], xi = pts[i][1], yj = pts[j][0], xj = pts[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function selectCells() {
    var ids = Object.keys(cellIndex).filter(function (id) {
      var c = cellIndex[id];
      if (shape.type === "rect") return c.lat >= shape.bounds[0] && c.lat <= shape.bounds[1] && c.lon >= shape.bounds[2] && c.lon <= shape.bounds[3];
      return inPoly(c.lat, c.lon, shape.pts);
    });
    var small = false;
    if (!ids.length) {   // shape smaller than a cell: use the cell(s) that contain the shape's centre
      var cy, cx;
      if (shape.type === "rect") { cy = (shape.bounds[0] + shape.bounds[1]) / 2; cx = (shape.bounds[2] + shape.bounds[3]) / 2; }
      else { cy = shape.pts.reduce(function (s, p) { return s + p[0]; }, 0) / shape.pts.length; cx = shape.pts.reduce(function (s, p) { return s + p[1]; }, 0) / shape.pts.length; }
      ids = Object.keys(cellIndex).filter(function (id) { var c = cellIndex[id]; return Math.abs(c.lat - cy) <= CELL / 2 && Math.abs(c.lon - cx) <= CELL / 2; });
      small = true;
    }
    return { ids: ids, small: small };
  }

  // ---------- aggregate ----------
  function aggregate() {
    var sel = selectCells();
    var acc = {};
    sel.ids.forEach(function (id) {
      cellIndex[id].rows.forEach(function (r) {
        var key = r.year * 100 + r.month;
        var a = acc[key] || (acc[key] = { harm: 0, aqua: 0 });
        a.harm += r.harmonized_cell_days || 0;
        a.aqua += r.modis_cell_days || 0;
      });
    });
    var keys = Object.keys(monthMeta).map(Number).sort(function (a, b) { return a - b; });
    var rel = T.reliability;
    var rows = keys.map(function (key) {
      var meta = monthMeta[key], a = acc[key] || { harm: 0, aqua: 0 };
      var o = { year: meta.year, month: meta.month, key: key, method: meta.method, aqua: a.aqua, value: a.harm, low: null, high: null,
        flag: "reliable", status: "ok", ratio: null, cls: null, median: null, rank: null, nRanked: null, percentile: null, stable: null, coverage: null };
      if (meta.method === "provisional_nrt") { o.status = "provisional"; return o; }
      if (meta.method === "modelled_aqua") {
        if (a.aqua === 0) { o.status = "insufficient_data"; o.value = null; o.method = "insufficient_data"; o.flag = "indicative_only"; return o; }
        var b = MVP.reliabilityFor(rel, a.aqua);
        o.flag = b.reliability;
        o.low = o.value * (1 + b.likely_low_pct / 100);
        o.high = o.value * (1 + b.likely_high_pct / 100);
      }
      return o;
    });
    // baseline: median of the same calendar month, 2003-2022, converted or measured months with an estimate
    var base = {};
    rows.forEach(function (r) {
      if (r.year <= 2022 && r.value !== null && r.status === "ok") (base[r.month] = base[r.month] || []).push(r.value);
    });
    var med = {};
    Object.keys(base).forEach(function (m) {
      var v = base[m].slice().sort(function (p, q) { return p - q; });
      med[m] = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    });
    rows.forEach(function (r) {
      if (r.status !== "ok" || r.value === null) return;
      r.median = med[r.month];
      if (r.median > 0) {
        r.ratio = r.value / r.median;
        r.cls = MVP.classify(r.ratio);
        if (r.low !== null) r.stable = MVP.classify(r.low / r.median) === MVP.classify(r.high / r.median);
      }
    });
    // rank and percentile within each calendar month, among every month with an estimate (complete years only)
    var byMonth = {};
    rows.forEach(function (r) { if (r.status === "ok" && r.value !== null) (byMonth[r.month] = byMonth[r.month] || []).push(r.value); });
    rows.forEach(function (r) {
      if (r.status !== "ok" || r.value === null) return;
      var all = byMonth[r.month];
      r.rank = all.filter(function (v) { return v > r.value; }).length + 1;
      r.nRanked = all.length;
      r.percentile = 100 * all.filter(function (v) { return v <= r.value; }).length / all.length;
    });
    return { rows: rows, cells: sel.ids, small: sel.small };
  }

  // ---------- painting ----------
  function ctx() { return { name: "Your area", baselineLabel: "median of the same month, 2003–2022, in your area", relRows: T.reliability }; }

  function paintStats(info) {
    var host = document.getElementById("area-stats");
    host.innerHTML = "";
    var modelled = info.rows.filter(function (r) { return r.method === "modelled_aqua" || r.method === "insufficient_data"; });
    var counts = { reliable: 0, good: 0, caution: 0, indicative_only: 0 };
    modelled.forEach(function (r) { counts[r.flag] = (counts[r.flag] || 0) + 1; });
    var worst = counts.indicative_only ? "indicative_only" : counts.caution ? "caution" : counts.good ? "good" : "reliable";
    var typical = MVP.reliabilityFor(T.reliability, median(modelled.filter(function (r) { return r.aqua > 0; }).map(function (r) { return r.aqua; })) || 0);
    var tile = function (label, value, sub, node) {
      var d = el("div", { class: "stat" }, [el("div", { class: "stat-label", text: label }), el("div", { class: "stat-value", text: value }), el("p", { class: "stat-sub", text: sub })]);
      if (node) d.appendChild(node);
      host.appendChild(d);
    };
    tile("Map cells inside", String(info.cells.length), info.small ? "Your shape is smaller than one cell, so the whole cell (about 100 km) is used." : "Each cell is about 1 degree, roughly 100 km wide.");
    var tot = info.rows.filter(function (r) { return r.year === 2025 && r.value !== null; }).reduce(function (s, r) { return s + r.value; }, 0);
    tile("Detections in 2025", formatNumber(tot), "VIIRS-equivalent, measured by VIIRS.");
    var f = el("div", null, [MVP.flagBadge(typical ? typical.reliability : "indicative_only")]);
    tile("Typical reliability before 2012", FLAG_TEXT(typical), "Typical converted month has about " + formatNumber(median(modelled.filter(function (r) { return r.aqua > 0; }).map(function (r) { return r.aqua; })) || 0) + " MODIS detections.", f);
    tile("Converted months by flag", counts.reliable + counts.good + " ok · " + counts.caution + " caution · " + counts.indicative_only + " indicative", "Worst: " + (MVP.FLAG_LABEL[worst] || worst) + ". " + MVP.suggestionFor(T.reliability, worst));
  }

  function FLAG_TEXT(b) { return b ? (MVP.FLAG_LABEL[b.reliability] || b.reliability) : "Indicative only"; }

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (p, q) { return p - q; });
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }

  function visibleRows() { return areaRows.filter(function (r) { return r.year >= yearFrom && r.year <= yearTo; }); }

  function paintAll() {
    var vis = visibleRows();
    document.getElementById("result").hidden = false;
    document.getElementById("cal-sub").textContent = areaInfo.cells.length + " cells · " + yearFrom + " to " + yearTo;
    if (!selectedKey || !vis.some(function (r) { return r.key === selectedKey; })) {
      var ok = vis.filter(function (r) { return r.status === "ok" && r.value !== null; });
      selectedKey = (ok.length ? ok[ok.length - 1] : vis[vis.length - 1]).key;
    }
    grid = MVP.calendarGrid(document.getElementById("calendar"), vis, { selected: selectedKey, label: "Months by year for your area",
      onSelect: function (r) { selectedKey = r.key; MVP.detailPanel(document.getElementById("detail"), r, ctx()); } });
    MVP.calendarKey(document.getElementById("cal-key"));
    MVP.detailPanel(document.getElementById("detail"), vis.filter(function (r) { return r.key === selectedKey; })[0], ctx());
    paintStats(Object.assign({}, areaInfo, { rows: vis }));
    var pts = vis.map(function (r) {
      return { x: r.year + (r.month - 1) / 12, y: r.value, low: r.low, high: r.high,
        kind: r.method === "provisional_nrt" ? "provisional" : r.method === "modelled_aqua" ? "modelled" : "observed",
        title: monthLabel(r.year, r.month), note: MVP.statusText(r) || (MVP.METHOD[r.method] || {}).label };
    });
    MVP.seriesChart(document.getElementById("series"), { height: 300, label: "Monthly series for your area",
      lines: [{ name: "Harmonized", color: cssVar("--s-harm"), points: pts }], vlines: yearFrom < 2012 && yearTo >= 2012 ? [{ x: 2012 + 1 / 12, label: "VIIRS measured from here" }] : [] });
    document.getElementById("csv").onclick = function () {
      downloadCsv("fire_drawn_area_monthly.csv",
        ["month", "detections_viirs_equivalent", "likely_low", "likely_high", "method", "reliability", "status", "comparison_with_usual", "class", "cells", "shape"],
        vis.map(function (r) {
          return [r.year + "-" + (r.month < 10 ? "0" : "") + r.month, r.value === null ? "" : Math.round(r.value * 10) / 10,
            r.low === null ? "" : Math.round(r.low * 10) / 10, r.high === null ? "" : Math.round(r.high * 10) / 10, r.method,
            r.method === "modelled_aqua" || r.method === "insufficient_data" ? r.flag : "reliable", r.status, r.ratio === null ? "" : Math.round(r.ratio * 1000) / 1000, r.cls || "",
            areaInfo.cells.length, describeShape()];
        }));
    };
  }

  function describeShape() {
    if (!shape) return "";
    if (shape.type === "rect") return "rectangle S" + shape.bounds[0].toFixed(2) + " N" + shape.bounds[1].toFixed(2) + " W" + shape.bounds[2].toFixed(2) + " E" + shape.bounds[3].toFixed(2);
    return "polygon " + shape.pts.map(function (p) { return p[0].toFixed(2) + "/" + p[1].toFixed(2); }).join(";");
  }

  function run() {
    if (!shape) return;
    areaInfo = aggregate();
    areaRows = areaInfo.rows;
    // highlight selected cells
    if (cellLayer) cellLayer.remove();
    cellLayer = L.layerGroup(areaInfo.cells.map(function (id) {
      var c = cellIndex[id];
      return L.rectangle([[c.lat - CELL / 2, c.lon - CELL / 2], [c.lat + CELL / 2, c.lon + CELL / 2]], { color: cssVar("--accent"), weight: 1, fillOpacity: 0.12, interactive: false });
    })).addTo(map);
    paintAll();
  }

  // ---------- map and drawing ----------
  function setShape(s) {
    shape = s;
    if (layer) layer.remove();
    layer = s.type === "rect"
      ? L.rectangle([[s.bounds[0], s.bounds[2]], [s.bounds[1], s.bounds[3]]], { color: cssVar("--accent"), weight: 2, dashArray: "6 4", fillOpacity: 0.05 })
      : L.polygon(s.pts, { color: cssVar("--accent"), weight: 2, dashArray: "6 4", fillOpacity: 0.05 });
    layer.addTo(map);
    if (s.type === "rect") {
      var f = document.getElementById("coords");
      f.south.value = s.bounds[0].toFixed(2); f.north.value = s.bounds[1].toFixed(2); f.west.value = s.bounds[2].toFixed(2); f.east.value = s.bounds[3].toFixed(2);
    }
    run();
  }

  function rectShape(south, north, west, east) {
    return { type: "rect", bounds: [Math.min(south, north), Math.max(south, north), Math.min(west, east), Math.max(west, east)] };
  }

  function setTool(t) {
    mode = mode === t ? null : t;
    document.getElementById("tool-rect").setAttribute("aria-pressed", String(mode === "rect"));
    document.getElementById("tool-poly").setAttribute("aria-pressed", String(mode === "poly"));
    document.getElementById("tool-finish").hidden = mode !== "poly";
    map.getContainer().style.cursor = mode ? "crosshair" : "";
    if (mode !== "poly") resetPoly();
    document.getElementById("tool-help").textContent = mode === "rect" ? "Press on the map and drag to draw a rectangle."
      : mode === "poly" ? "Click each corner on the map, then press Finish polygon (or double-click)." : "Choose a tool, then drag on the map (rectangle) or click corners and press Finish (polygon).";
  }

  function resetPoly() { polyPts = []; if (polyLayer) { polyLayer.remove(); polyLayer = null; } }

  function initMap() {
    map = L.map("draw-map", { center: [-38, -65], zoom: 4, minZoom: 3 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    var start = null, ghost = null;
    map.on("mousedown", function (e) {
      if (mode !== "rect") return;
      start = e.latlng;
      map.dragging.disable();
      ghost = L.rectangle([start, start], { color: cssVar("--accent"), weight: 2, dashArray: "6 4", fillOpacity: 0.05 }).addTo(map);
    });
    map.on("mousemove", function (e) { if (ghost && start) ghost.setBounds([start, e.latlng]); });
    map.on("mouseup", function (e) {
      if (!ghost || !start) return;
      ghost.remove(); ghost = null;
      var s = start; start = null;
      map.dragging.enable();
      if (Math.abs(s.lat - e.latlng.lat) < 0.02 && Math.abs(s.lng - e.latlng.lng) < 0.02) return;
      setShape(rectShape(s.lat, e.latlng.lat, s.lng, e.latlng.lng));
      setTool(null);
    });
    map.on("click", function (e) {
      if (mode !== "poly") return;
      polyPts.push([e.latlng.lat, e.latlng.lng]);
      if (polyLayer) polyLayer.remove();
      polyLayer = L.polyline(polyPts.concat(polyPts.length > 2 ? [polyPts[0]] : []), { color: cssVar("--accent"), weight: 2, dashArray: "6 4" }).addTo(map);
    });
    function finish() {
      if (polyPts.length < 3) return;
      var pts = polyPts.slice();
      resetPoly();
      setShape({ type: "poly", pts: pts });
      setTool(null);
    }
    map.on("dblclick", function (e) { if (mode === "poly") { L.DomEvent.stop(e); polyPts.pop(); finish(); } });
    map.doubleClickZoom.disable();
    document.getElementById("tool-finish").addEventListener("click", finish);
  }

  function initControls() {
    document.getElementById("tool-rect").addEventListener("click", function () { setTool("rect"); });
    document.getElementById("tool-poly").addEventListener("click", function () { setTool("poly"); });
    document.getElementById("tool-clear").addEventListener("click", function () {
      shape = null; if (layer) layer.remove(); if (cellLayer) cellLayer.remove(); resetPoly(); setTool(null);
      document.getElementById("result").hidden = true;
    });
    var ex = document.getElementById("examples");
    EXAMPLES.forEach(function (e) {
      var b = el("button", { type: "button", class: "chip", text: e.label });
      b.addEventListener("click", function () {
        setShape(rectShape(e.rect[0], e.rect[1], e.rect[2], e.rect[3]));
        map.fitBounds([[e.rect[0], e.rect[2]], [e.rect[1], e.rect[3]]], { padding: [40, 40], maxZoom: 7 });
      });
      ex.appendChild(b);
    });
    document.getElementById("coords").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var s = Number(f.south.value), n = Number(f.north.value), w = Number(f.west.value), e = Number(f.east.value);
      if (s >= n || w >= e) { document.getElementById("tool-help").textContent = "South must be below north, and west must be left of east."; return; }
      setShape(rectShape(s, n, w, e));
      map.fitBounds([[s, w], [n, e]], { padding: [40, 40], maxZoom: 7 });
    });
    var from = document.getElementById("year-from"), to = document.getElementById("year-to");
    for (var y = 2003; y <= 2026; y++) {
      from.appendChild(el("option", { value: y, text: y }));
      to.appendChild(el("option", { value: y, text: y }));
    }
    from.value = yearFrom; to.value = yearTo;
    var onYears = function () {
      yearFrom = Math.min(Number(from.value), Number(to.value));
      yearTo = Math.max(Number(from.value), Number(to.value));
      if (areaInfo) paintAll();
    };
    from.addEventListener("change", onYears);
    to.addEventListener("change", onYears);
  }

  if (typeof L === "undefined") {
    document.getElementById("draw-map").textContent = "The map library could not be loaded. Check the network connection.";
  } else {
    initMap();
    initControls();
  }

  MVP.loadTables(["gold_cell_monthly", "gold_reliability"], banner).then(function (t) {
    T = { reliability: t.gold_reliability.rows };
    index(t.gold_cell_monthly.rows);
    var q = (queryParam("rect") || "").split(",").map(Number);
    if (q.length === 4 && q.every(isFinite)) setShape(rectShape(q[0], q[1], q[2], q[3]));
    document.addEventListener("themechange", function () { if (areaInfo) paintAll(); });
  }).catch(function (err) { document.getElementById("tool-help").textContent = "The data could not be loaded. " + err.message; });
})();
