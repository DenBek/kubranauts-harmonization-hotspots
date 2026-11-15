// Home page: the burning-activity map of Argentina, with the calendar always beside it.
//
// Layout: a one-sentence answer on top (for the selection and the month on the timeline), the map with the timeline
// under it, and a side column that always shows the calendar for the current selection: Argentina, a region, or
// the area you drew.
//
//   Explore months  - each 1-degree cell is a circle. Its AREA grows with the detections (radius with the square root,
//                     one scale for every month). Its colour compares the month with that place's usual same month
//                     (median 2003-2022), in the calendar's colours. Provisional months are hollow and not compared.
//                     Play, step, scrub; click a circle for its history; Harmonized / MODIS / VIIRS switch.
//   Regions         - Argentina and the five tested boxes, plus known events.
//   Draw an area    - rectangle, polygon, examples, typed corners and a year range; reliability flags from
//                     gold_reliability (the area logic is draw.js's, unchanged).
//
// The calendar, the timeline and the headline are linked: picking a month in one moves the others.
// State lives in the URL: ?mode=explore|region|draw&region=&rect=s,n,w,e&year=&month=&metric=&cell=
// Load after gold.js, charts.js, nav.js and mvp.js.

(function () {
  var banner = document.getElementById("data-banner");
  document.getElementById("doc-approach").innerHTML = MVP.docLink("HARMONIZATION_APPROACH.md", "How the conversion works");
  document.getElementById("doc-scope").innerHTML = MVP.docLink("SCOPE_AND_GAPS.md", "Known gaps");

  var CELL = 1;                     // degrees, matches gold_cell_monthly
  var ARGENTINA = [[-55.1, -73.6], [-21.8, -53.6]];   // the map opens fitted to the whole country
  var PLAY_MS = 700;

  var MODES = [
    { value: "explore", label: "Explore months" },
    { value: "region", label: "Regions" },
    { value: "draw", label: "Draw an area" },
  ];
  var METRICS = [
    { value: "harmonized", label: "Harmonized" },
    { value: "modis", label: "MODIS Aqua" },
    { value: "viirs", label: "VIIRS" },
  ];
  var FIELD = { harmonized: "harmonized_cell_days", modis: "modis_cell_days", viirs: "viirs_cell_days" };
  var LABEL = { harmonized: "Harmonized detections", modis: "MODIS Aqua detections", viirs: "VIIRS detections" };
  var UNIT = { harmonized: "harmonized detections", modis: "MODIS Aqua detections", viirs: "VIIRS detections" };
  var SENSOR_VAR = { modis: "--s-modis", viirs: "--s-viirs" };

  var SHORT = { argentina: "Argentina", ar_ne: "North-east", ar_nw: "North-west", ar_c: "Centre", ar_s: "Patagonia", ar_delta: "Paraná Delta" };
  // Which 1-degree cells belong to each region (by cell centre), from harmonization/argentina/gold/README.md.
  // Only used to outline the region on the map; the numbers come from gold_region_monthly.
  var IN_REGION = {
    argentina: function () { return true; },
    ar_ne: function (lat, lon) { return lat > -35 && lon > -60.5; },
    ar_nw: function (lat, lon) { return lat > -30 && lon <= -60.5; },
    ar_c: function (lat, lon) { return lat > -39 && lat <= -30 && !(lat > -35 && lon > -60.5); },
    ar_s: function (lat) { return lat <= -39; },
    ar_delta: function (lat, lon) { return lat >= -34.5 && lat <= -32.1 && lon >= -61 && lon <= -58.4; },
  };
  var EVENTS = [
    { label: "Paraná Delta, April 2008", region: "ar_delta", year: 2008, month: 4 },
    { label: "Paraná Delta, August 2020", region: "ar_delta", year: 2020, month: 8 },
    { label: "Corrientes, January 2022", region: "ar_ne", year: 2022, month: 1 },
    { label: "Corrientes, February 2022", region: "ar_ne", year: 2022, month: 2 },
  ];
  var EXAMPLES = [
    { label: "Paraná Delta", rect: [-34.5, -32.1, -61, -58.4] },
    { label: "Córdoba and the Pampas", rect: [-35, -29.5, -66, -61] },
    { label: "Corrientes", rect: [-30.5, -27, -59, -55.5] },
    { label: "A small area (under 1 cell)", rect: [-32.9, -32.5, -60.9, -60.5] },
  ];
  var BASE_LABEL = { default: "median of the harmonized record 2003–2022", viirs: "median of measured VIIRS months 2012–2025" };

  var mode = queryParam("mode");
  var state = {
    mode: mode === "region" || mode === "draw" ? mode : "explore",
    metric: FIELD[queryParam("metric")] ? queryParam("metric") : "harmonized",
    index: 0,
    cell: queryParam("cell") ? Number(queryParam("cell")) : null,
    region: IN_REGION[queryParam("region")] ? queryParam("region") : "argentina",
    base: queryParam("base") === "viirs" ? "viirs" : "default",
    tool: null,
    shape: null,
    yearFrom: 2003,
    yearTo: 2026,
  };

  var T = null;                     // tables
  var cellIndex = {};               // cell_id -> { id, lat, lon, rows, byKey, usual[12] }
  var cellIds = [];
  var months = [];                  // [{ year, month, key, method }]
  var monthAt = {};                 // key -> index in months
  var totals = {};                  // metric -> [total per month]
  var maxOf = {};                   // metric -> largest cell value in any month (fixed size scale)
  var inProgress = {};              // key -> true for months Argentina marks as not complete

  var map = null;
  var dots = {};                    // cell id -> L.circleMarker
  var selectionIds = null;          // { id: true } of the region or drawn area, or null
  var selectionLayer = null;
  var shapeLayer = null;
  var fadeLayer = null;
  var outlineLayer = null;
  var polyPts = [];
  var polyLayer = null;
  var timer = null;

  // The side column. kind: "region" (Argentina or a region) or "area". rows: the calendar's rows (an area's are cut
  // to the year range); all: every row, for the headline.
  var drawer = { kind: null, rows: [], all: [], grid: null, selected: null, info: null };

  // ---------- small helpers ----------

  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (p, q) { return p - q; });
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }

  function cellValue(row) {
    if (!row) return null;
    var v = row[FIELD[state.metric]];
    return isMissing(v) ? null : Number(v);
  }

  function currentMonth() { return months[state.index]; }

  function methodLabel(method) { return (MVP.METHOD[method] || { label: method || "" }).label; }

  function ordinal(n) {
    var v = n % 100;
    return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th");
  }

  function classWords(cls) { return cls === "normal" ? "About usual" : (CLASS_LABEL[cls] || "") + " usual"; }

  function setText(id, text) { document.getElementById(id).textContent = text; }

  function drawerRegion() { return state.mode === "region" ? state.region : "argentina"; }

  // ---------- data ----------

  function index(rows) {
    var seen = {};
    rows.forEach(function (r) {
      var c = cellIndex[r.cell_id];
      if (!c) {
        c = cellIndex[r.cell_id] = { id: r.cell_id, lat: r.lat_center, lon: r.lon_center, rows: [], byKey: {} };
        cellIds.push(r.cell_id);
      }
      var key = r.year * 100 + r.month;
      c.rows.push(r);
      c.byKey[key] = r;
      if (!seen[key]) {
        seen[key] = true;
        months.push({ year: r.year, month: r.month, key: key, method: r.method });
      }
    });
    months.sort(function (a, b) { return a.key - b.key; });
    months.forEach(function (m, i) { monthAt[m.key] = i; });
    Object.keys(FIELD).forEach(function (metric) {
      var t = months.map(function () { return 0; });
      var max = 0;
      rows.forEach(function (r) {
        var v = r[FIELD[metric]];
        if (isMissing(v)) return;
        t[monthAt[r.year * 100 + r.month]] += Number(v);
        if (v > max) max = Number(v);
      });
      totals[metric] = t;
      maxOf[metric] = max || 1;
    });
    // Each place's usual month: median of the same calendar month over 2003-2022 (a month with no row counts as 0),
    // the same baseline years as the region calendars.
    cellIds.forEach(function (id) {
      var c = cellIndex[id];
      c.usual = [];
      for (var mo = 1; mo <= 12; mo++) {
        var vals = [];
        for (var y = 2003; y <= 2022; y++) {
          var r = c.byKey[y * 100 + mo];
          vals.push(r && !isMissing(r.harmonized_cell_days) ? Number(r.harmonized_cell_days) : 0);
        }
        c.usual.push(median(vals));
      }
    });
  }

  function startIndex() {
    var y = Number(queryParam("year"));
    var m = Number(queryParam("month"));
    if (y && m && monthAt[y * 100 + m] !== undefined) return monthAt[y * 100 + m];
    // Latest measured (not provisional, not in progress) month for Argentina, so the map opens on a settled month.
    var done = T.monthly.filter(function (r) { return r.region_id === "argentina" && r.is_complete !== false && r.method !== "provisional_nrt"; })
      .map(function (r) { return r.year * 100 + r.month; }).sort(function (a, b) { return a - b; });
    var last = done[done.length - 1];
    return last && monthAt[last] !== undefined ? monthAt[last] : months.length - 1;
  }

  // Provisional or in-progress months show the amount but no comparison (SCOPE_AND_GAPS.md, A2).
  function notCompared(m) { return m.method === "provisional_nrt" || !!inProgress[m.key]; }

  function cellClass(c, m) {
    var row = c.byKey[m.key];
    var v = row ? row.harmonized_cell_days : null;
    if (isMissing(v) || v <= 0 || notCompared(m)) return null;
    return MVP.classify(Number(v) / Math.max(c.usual[m.month - 1], 1));
  }

  // ---------- map ----------

  function initMap() {
    map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 3, zoomSnap: 0.5 });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
    }).addTo(map);
    // Pane for the faded neighbours and the country outline: above the tiles, below the circles, never clickable.
    map.createPane("fade");
    map.getPane("fade").style.zIndex = 350;
    map.getPane("fade").style.pointerEvents = "none";
    map.fitBounds(ARGENTINA, { padding: [12, 12], animate: false });

    // Rectangle tool: drag on the map. Dragging is switched off before the press (setTool), or Leaflet pans.
    var start = null;
    var ghost = null;
    map.on("mousedown", function (e) {
      if (state.tool !== "rect") return;
      start = e.latlng;
      ghost = L.rectangle([start, start], shapeStyle()).addTo(map);
    });
    map.on("mousemove", function (e) { if (ghost && start) ghost.setBounds([start, e.latlng]); });
    map.on("mouseup", function (e) {
      if (!ghost || !start) return;
      ghost.remove();
      ghost = null;
      var s = start;
      start = null;
      if (Math.abs(s.lat - e.latlng.lat) < 0.02 && Math.abs(s.lng - e.latlng.lng) < 0.02) return;
      setShape(rectShape(s.lat, e.latlng.lat, s.lng, e.latlng.lng));
      setTool(null);
    });
    // Polygon tool: click the corners, then Finish or double-click.
    map.on("click", function (e) {
      if (state.tool !== "poly") return;
      polyPts.push([e.latlng.lat, e.latlng.lng]);
      if (polyLayer) polyLayer.remove();
      polyLayer = L.polyline(polyPts.concat(polyPts.length > 2 ? [polyPts[0]] : []), { color: cssVar("--ink"), weight: 2, dashArray: "6 4" }).addTo(map);
      document.getElementById("tool-help").textContent = polyPts.length + " corner" + (polyPts.length === 1 ? "" : "s") + ". Keep clicking, then press Finish polygon (or double-click).";
    });
    map.on("dblclick", function (e) {
      if (state.tool !== "poly") return;
      L.DomEvent.stop(e);
      polyPts.pop();
      finishPolygon();
    });
  }

  // A calm basemap: the tiles are grey (styles.css), everything outside Argentina is washed out, and the country
  // gets a thin outline. Outline: Natural Earth 1:50m in web/argentina.json. If it fails to load, the map still works.
  function fadeStyle() { return { pane: "fade", stroke: false, fill: true, fillColor: cssVar("--bg"), fillOpacity: 0.62, interactive: false }; }
  function outlineStyle() { return { pane: "fade", color: cssVar("--ink-2"), weight: 1.1, opacity: 0.5, fill: false, interactive: false }; }

  function addBasemap() {
    fetch("argentina.json").then(function (r) {
      if (!r.ok) throw new Error("argentina.json " + r.status);
      return r.json();
    }).then(function (f) {
      var rings = f.geometry.coordinates.map(function (poly) { return poly[0].map(function (p) { return [p[1], p[0]]; }); });
      fadeLayer = L.polygon([[[85, -180], [85, 180], [-85, 180], [-85, -180]]].concat(rings), fadeStyle()).addTo(map);
      outlineLayer = L.polygon(rings.map(function (r) { return [r]; }), outlineStyle()).addTo(map);
    }).catch(function () { /* the outline is decoration only */ });
  }

  // Circle size: AREA proportional to the detections (radius with the square root), on a scale fixed across all
  // months so the timeline compares like with like. A few pixels minimum so a single detection stays visible.
  var DOT_MIN = 2;
  var DOT_MAX = 18;                 // px radius for the largest cell-month on record for this value

  function dotRadius(v) {
    if (v === null || v <= 0) return 0;
    return Math.max(DOT_MIN, DOT_MAX * Math.sqrt(Math.min(1, v / (maxOf[state.metric] || 1))));
  }

  function dotFill(cls) {
    if (state.metric !== "harmonized") return cssVar(SENSOR_VAR[state.metric]);
    return cls ? classColor(cls) : cssVar("--muted");
  }

  function paintCells() {
    var m = currentMonth();
    var hollow = notCompared(m);
    var order = [];
    cellIds.forEach(function (id) {
      var c = cellIndex[id];
      var r = dotRadius(cellValue(c.byKey[m.key]));
      var dot = dots[id];
      if (!r) {
        if (dot && map.hasLayer(dot)) dot.remove();
        return;
      }
      var fill = dotFill(cellClass(c, m));
      var dim = selectionIds && !selectionIds[id];
      var selected = id === state.cell;
      var style = {
        color: selected ? cssVar("--ink") : hollow ? (state.metric === "harmonized" ? cssVar("--ink-2") : fill) : cssVar("--surface"),
        weight: selected ? 2.4 : hollow ? 1.4 : 0.8,
        opacity: dim ? 0.35 : 1,
        dashArray: hollow ? "3 2" : null,
        fill: true,
        fillColor: fill,
        fillOpacity: hollow ? 0.06 : dim ? 0.2 : 0.9,
      };
      if (!dot) {
        dot = dots[id] = L.circleMarker([c.lat, c.lon], Object.assign({ radius: r, className: "fire-dot" }, style));
        bindDot(dot, id);
      } else {
        dot.setStyle(style);
        dot.setRadius(r);
      }
      if (!map.hasLayer(dot)) dot.addTo(map);
      order.push({ dot: dot, r: r, selected: selected });
    });
    // Smaller circles on top, so a big neighbour never hides them; the selected one above all.
    order.sort(function (a, b) { return b.r - a.r; });
    order.forEach(function (o) { o.dot.bringToFront(); });
    order.forEach(function (o) { if (o.selected) o.dot.bringToFront(); });
  }

  function bindDot(dot, id) {
    dot.on("mousemove", function (e) { Tip.show(cellTip(id), e.originalEvent.clientX, e.originalEvent.clientY); });
    dot.on("mouseout", function () { Tip.hide(); });
    dot.on("click", function () { onCellClick(id); });
  }

  function cellTip(id) {
    var c = cellIndex[id];
    var m = currentMonth();
    var row = c.byKey[m.key];
    var v = cellValue(row);
    var cls = cellClass(c, m);
    var rows = [{ label: LABEL[state.metric], value: v === null ? "none this month" : formatNumber(v), color: v ? dotFill(cls) : null, kind: "box" }];
    if (cls) rows.push({ label: "Compared with a usual " + MONTHS[m.month - 1] + " here", value: classWords(cls) + " (usual " + formatNumber(c.usual[m.month - 1]) + ")" });
    else if (notCompared(m)) rows.push({ label: "Compared with usual", value: "not yet, month is provisional" });
    if (row && state.metric === "harmonized") rows.push({ label: "How", value: methodLabel(row.method).replace("Converted from MODIS Aqua", "Converted from MODIS") });
    var note = state.mode === "region" ? "Click to open this cell's region" : state.mode === "draw" ? "Use the tools to draw an area" : "Click for this cell's history";
    return { title: Math.abs(c.lat) + "°S, " + Math.abs(c.lon) + "°W · " + monthLabel(m.year, m.month), rows: rows, note: "1° cell, about 100 km wide. " + note };
  }

  function onCellClick(id) {
    if (state.tool) return;
    if (state.mode === "region") {
      var c = cellIndex[id];
      var pick = ["ar_delta", "ar_ne", "ar_nw", "ar_c", "ar_s"].filter(function (r) { return IN_REGION[r](c.lat, c.lon); })[0] || "argentina";
      selectRegion(pick);
      return;
    }
    if (state.mode === "draw") return;
    selectCell(id);
  }

  // Selections are neutral ink, never the data colours.
  function shapeStyle() {
    return { color: cssVar("--ink"), weight: 2, dashArray: "6 4", fillColor: cssVar("--ink"), fillOpacity: 0.04 };
  }

  // The outer border of a set of cells: every cell edge that has no selected neighbour on the other side.
  function outlineOf(ids) {
    var has = {};
    ids.forEach(function (id) { var c = cellIndex[id]; has[c.lat + "," + c.lon] = true; });
    var segs = [];
    var h = CELL / 2;
    ids.forEach(function (id) {
      var c = cellIndex[id];
      var s = c.lat - h, n = c.lat + h, w = c.lon - h, e = c.lon + h;
      if (!has[(c.lat + CELL) + "," + c.lon]) segs.push([[n, w], [n, e]]);
      if (!has[(c.lat - CELL) + "," + c.lon]) segs.push([[s, w], [s, e]]);
      if (!has[c.lat + "," + (c.lon - CELL)]) segs.push([[s, w], [n, w]]);
      if (!has[c.lat + "," + (c.lon + CELL)]) segs.push([[s, e], [n, e]]);
    });
    return segs;
  }

  function showSelection(ids) {
    if (selectionLayer) { selectionLayer.remove(); selectionLayer = null; }
    selectionIds = null;
    if (ids && ids.length) {
      selectionIds = {};
      ids.forEach(function (id) { selectionIds[id] = true; });
      selectionLayer = L.polyline(outlineOf(ids), { color: cssVar("--ink"), weight: 1.6, opacity: 0.75, interactive: false }).addTo(map);
    }
    paintCells();
  }

  function fitTo(latlngs) {
    if (!latlngs.length) return;
    map.fitBounds(latlngs, { maxZoom: 7, animate: !prefersReducedMotion(), padding: [28, 28] });
  }

  // ---------- legend ----------

  function paintLegend() {
    var host = document.getElementById("map-legend");
    host.innerHTML = "";
    host.appendChild(el("div", { class: "legend-title", text: LABEL[state.metric] + " per cell, in a month" }));
    var max = maxOf[state.metric] || 1;
    var refs = [100, 1000, 5000].filter(function (v) { return v <= max; });
    if (!refs.length) refs = [Math.round(max)];
    var row = el("div", { class: "dot-legend" });
    refs.forEach(function (v) {
      var r = dotRadius(v);
      var d = Math.ceil(2 * r + 2);
      row.appendChild(el("div", { class: "dot-ref" }, [
        el("span", { html: "<svg width='" + d + "' height='" + d + "' aria-hidden='true'><circle cx='" + d / 2 + "' cy='" + d / 2 + "' r='" + r + "' fill='none' stroke='" + cssVar("--ink-2") + "' stroke-width='1'/></svg>" }),
        el("span", { text: formatCompact(v) }),
      ]));
    });
    host.appendChild(row);
    if (state.metric === "harmonized") {
      var sw = el("div", { class: "class-strip", "aria-hidden": "true" });
      CLASS_ORDER.forEach(function (c) { sw.appendChild(el("i", { style: "background:" + classColor(c) })); });
      host.appendChild(sw);
      host.appendChild(el("div", { class: "class-strip-labels" }, [el("span", { text: "Much less" }), el("span", { text: "Usual" }), el("span", { text: "Much more" })]));
      host.appendChild(el("div", { class: "legend-hollow" }, [
        el("span", { html: "<svg width='14' height='14' aria-hidden='true'><circle cx='7' cy='7' r='5.5' fill='none' stroke='" + cssVar("--ink-2") + "' stroke-width='1.3' stroke-dasharray='3 2'/></svg>" }),
        el("span", { text: "Provisional, not compared yet" }),
      ]));
      host.appendChild(el("p", { class: "legend-note", text: "Size = how many. Colour = this month against a usual same month at that place (2003–2022)." }));
    } else {
      host.appendChild(el("p", { class: "legend-note", text: "Raw counts from one sensor, one colour. The two sensors are not on one scale, so there is no comparison here. Switch to Harmonized for colours." }));
    }
  }

  // ---------- headline: the answer for the selection and month ----------

  function paintHeadline() {
    var m = currentMonth();
    if (!m) return;
    var r = drawer.all.filter(function (x) { return x.key === m.key; })[0] || null;
    var name = drawer.kind === "area" ? "Your area" : SHORT[drawerRegion()] || regionName(drawerRegion());
    var mn = MONTHS[m.month - 1];
    setText("head-eyebrow", name + " · " + monthLabel(m.year, m.month));
    var title, sub;
    if (!r) {
      title = "No data for this month";
      sub = "";
    } else if (r.status === "provisional" || r.status === "incomplete") {
      title = formatNumber(r.value) + " detections so far";
      sub = (r.status === "incomplete" ? "Month in progress" : "Provisional near-real-time data") + " · compared with other years once the month is final";
    } else if (r.status === "insufficient_data") {
      title = "Too few MODIS detections to estimate this month";
      sub = "VIIRS would usually have seen a few fires here, so this is not zero.";
    } else {
      if (!r.cls || isMissing(r.ratio)) title = formatNumber(r.value) + " detections";
      else if (r.cls === "normal") title = "About the usual " + mn;
      else if (r.ratio >= 10) title = "Far above the usual " + mn;
      else if (r.ratio > 1) title = r.ratio.toFixed(1) + "× the usual " + mn;
      else if (r.value === 0) title = "No detections, against a usual " + mn + " of " + formatNumber(r.median);
      else title = Math.round((1 - r.ratio) * 100) + "% below the usual " + mn;
      var rank = "";
      if (r.rank && r.nRanked) {
        rank = r.rank === 1 ? "Busiest " + mn + " in " + r.nRanked + " years"
          : r.rank === r.nRanked ? "Quietest " + mn + " in " + r.nRanked + " years"
            : ordinal(r.rank) + " busiest of " + r.nRanked + " " + mn + "s";
        rank += " · ";
      }
      sub = rank + formatNumber(r.value) + " VIIRS-equivalent detections" +
        (r.method === "modelled_aqua" && !isMissing(r.low) ? " · converted from MODIS, likely " + formatNumber(r.low) + "–" + formatNumber(r.high) : "");
    }
    setText("head-title", title);
    setText("head-sub", sub);
  }

  // ---------- timeline ----------

  function paintTimeline() {
    var bars = document.getElementById("timeline-bars");
    bars.innerHTML = "";
    var t = totals[state.metric];
    var max = Math.max.apply(null, t.concat([1]));
    months.forEach(function (m, i) {
      var b = el("button", {
        type: "button", tabindex: "-1", "aria-current": String(i === state.index), "aria-label": monthLabel(m.year, m.month),
        class: m.method === "modelled_aqua" ? "converted" : m.method === "provisional_nrt" ? "provisional" : "",
        style: "height:" + Math.max(2, (34 * t[i]) / max) + "px",
      });
      b.addEventListener("pointermove", function (ev) {
        Tip.show({ title: monthLabel(m.year, m.month), rows: [{ label: "Argentina total", value: formatNumber(t[i]), color: cssVar("--ink-2"), kind: "box" }], note: methodLabel(m.method) + ". Click to show this month." }, ev.clientX, ev.clientY);
      });
      b.addEventListener("pointerleave", Tip.hide);
      b.addEventListener("click", function () { stop(); goTo(i); });
      bars.appendChild(b);
    });
    var slider = document.getElementById("slider");
    slider.max = Math.max(0, months.length - 1);
    paintTimelineLabel();
  }

  function paintTimelineLabel() {
    var m = currentMonth();
    var label = document.getElementById("timeline-label");
    label.innerHTML = "";
    label.appendChild(el("strong", { text: monthLabel(m.year, m.month) }));
    label.appendChild(el("span", { text: formatNumber(totals[state.metric][state.index]) + " " + UNIT[state.metric] }));
    var slider = document.getElementById("slider");
    slider.value = state.index;
    slider.setAttribute("aria-valuetext", monthLabel(m.year, m.month));
    var bars = document.getElementById("timeline-bars").children;
    for (var i = 0; i < bars.length; i++) bars[i].setAttribute("aria-current", String(i === state.index));
  }

  function goTo(i, fromCalendar) {
    if (!months.length) return;
    state.index = (i + months.length) % months.length;
    var m = currentMonth();
    setParams({ year: m.year, month: m.month });
    paintCells();
    paintTimelineLabel();
    if (state.mode === "explore") { paintCellList(); paintCellDetail(); }
    if (!fromCalendar) syncDrawer(m.key);
    paintHeadline();
  }

  function play() {
    if (timer) { stop(); return; }
    var button = document.getElementById("play");
    button.innerHTML = icon("pause", 16);
    button.setAttribute("aria-label", "Pause");
    timer = setInterval(function () { goTo(state.index + 1); }, PLAY_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    var button = document.getElementById("play");
    button.innerHTML = icon("play", 16);
    button.setAttribute("aria-label", "Play through the months");
  }

  // ---------- explore: the cell list and one cell's history ----------

  function paintCellList() {
    var list = document.getElementById("cell-list");
    list.innerHTML = "";
    var m = currentMonth();
    var withFire = cellIds.map(function (id) { return { id: id, v: cellValue(cellIndex[id].byKey[m.key]) }; })
      .filter(function (x) { return x.v !== null && x.v > 0; })
      .sort(function (a, b) { return b.v - a.v; });
    setText("list-title", "Busiest cells, " + monthLabel(m.year, m.month) + " (" + withFire.length + " with detections)");
    var visible = withFire.slice(0, 12);
    var max = visible.length ? visible[0].v : 1;
    visible.forEach(function (x) {
      var c = cellIndex[x.id];
      var b = el("button", { type: "button", "aria-pressed": String(x.id === state.cell) }, [
        el("span", null, [c.lat + "°, " + c.lon + "°", el("span", { class: "bar-inline", style: "width:" + (100 * x.v) / max + "%" })]),
        el("span", { class: "num", text: formatNumber(x.v) }),
      ]);
      b.addEventListener("click", function () { selectCell(x.id, true); });
      list.appendChild(el("li", null, [b]));
    });
    if (!visible.length) list.appendChild(el("li", { class: "small muted", text: "No detections this month." }));
  }

  function selectCell(id, pan) {
    state.cell = id;
    setParams({ cell: id });
    paintCells();
    paintCellList();
    paintCellDetail();
    if (pan && map) {
      var c = cellIndex[id];
      map.panTo([c.lat, c.lon], { animate: !prefersReducedMotion() });
    }
  }

  function paintCellDetail() {
    var host = document.getElementById("cell-detail");
    host.innerHTML = "";
    if (!state.cell || !cellIndex[state.cell]) {
      host.appendChild(el("h3", { text: "One place" }));
      host.appendChild(el("p", { class: "small muted", text: "Click a circle on the map, or a row in the list below, to see that cell's whole history." }));
      return;
    }
    var c = cellIndex[state.cell];
    var m = currentMonth();
    var row = c.byKey[m.key];
    host.appendChild(el("div", { class: "card-head", style: "margin-bottom:0.2rem" }, [
      el("h3", { text: "Cell " + c.lat + "°, " + c.lon + "°" }),
      el("button", { type: "button", class: "btn small ghost icon", "aria-label": "Close cell details", html: icon("close", 16), onclick: function () { state.cell = null; setParams({ cell: null }); paintCells(); paintCellList(); paintCellDetail(); } }),
    ]));
    host.appendChild(el("p", { class: "small muted", text: "About 100 km wide, centred on " + c.lat + "°, " + c.lon + "°. " + monthLabel(m.year, m.month) + ":" }));
    var v = cellValue(row);
    var big = el("div", { class: "kpi-value", style: "font-size:1.5rem", text: v === null ? "No detections" : formatNumber(v) });
    if (v !== null) big.appendChild(el("span", { class: "unit", text: UNIT[state.metric] }));
    host.appendChild(big);
    var cls = cellClass(c, m);
    var line = el("div", { style: "display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;margin-top:0.3rem" });
    if (row) line.appendChild(MVP.methodBadge(row.method));
    if (cls) line.appendChild(el("span", { class: "small muted", text: classWords(cls) + " for " + MONTHS[m.month - 1] + " here (usual " + formatNumber(c.usual[m.month - 1]) + ")" }));
    host.appendChild(line);

    var history = months.map(function (mm) { var r = c.byKey[mm.key]; return r ? (cellValue(r) || 0) : 0; });
    host.appendChild(el("div", { class: "small muted", style: "margin-top:0.6rem", text: LABEL[state.metric] + ", every month 2003 to today" }));
    var spark = el("div", { class: "chart", style: "min-height:48px" });
    host.appendChild(spark);
    sparkline(spark, { values: history, markIndex: state.index, height: 48, titles: months.map(function (mm) { return monthLabel(mm.year, mm.month); }), label: LABEL[state.metric] });

    if (row) {
      var dl = el("dl", { class: "metric compact" });
      dl.innerHTML =
        metricItem(term("harmonized-detections", "Harmonized"), formatNumber(row.harmonized_cell_days)) +
        metricItem(term("modis", "MODIS Aqua"), formatNumber(row.modis_cell_days)) +
        metricItem(term("viirs", "VIIRS"), formatNumber(row.viirs_cell_days)) +
        metricItem(term("calibration-ratio", "Month factor"), row.calibration_ratio === null || row.calibration_ratio === undefined ? "Not applied" : Number(row.calibration_ratio).toFixed(2));
      host.appendChild(dl);
    }
    host.appendChild(el("button", {
      type: "button", class: "btn small secondary", style: "margin-top:0.6rem", html: icon("calendar", 16) + "Open this cell's calendar",
      onclick: function () {
        setMode("draw");
        setShape(rectShape(c.lat - CELL / 2 + 0.05, c.lat + CELL / 2 - 0.05, c.lon - CELL / 2 + 0.05, c.lon + CELL / 2 - 0.05));
      },
    }));
  }

  // ---------- regions ----------

  function paintRegionChips() {
    var host = document.getElementById("region-chips");
    host.innerHTML = "";
    REGIONS.forEach(function (r) {
      var b = el("button", { type: "button", class: "chip", "aria-pressed": String(r.id === state.region), text: SHORT[r.id] || r.name, title: r.name });
      b.addEventListener("click", function () { selectRegion(r.id, true); });
      host.appendChild(b);
    });
    var ev = document.getElementById("event-chips");
    ev.innerHTML = "";
    EVENTS.forEach(function (e) {
      var b = el("button", { type: "button", class: "chip", text: e.label });
      b.addEventListener("click", function () {
        selectRegion(e.region, true);
        var key = e.year * 100 + e.month;
        if (drawer.grid) drawer.grid.select(key);
      });
      ev.appendChild(b);
    });
  }

  function regionRows(id) {
    return T.monthly.filter(function (r) { return r.region_id === id; })
      .sort(function (a, b) { return a.year - b.year || a.month - b.month; })
      .map(function (r) { return MVP.norm(r, state.base); });
  }

  function selectRegion(id, fit) {
    state.region = id;
    setParams({ region: id });
    if (state.mode !== "region") setMode("region", true);
    paintRegionChips();
    var ids = cellIds.filter(function (cid) { var c = cellIndex[cid]; return IN_REGION[id](c.lat, c.lon); });
    showSelection(id === "argentina" ? null : ids);
    if (fit) {
      if (id === "argentina") map.fitBounds(ARGENTINA, { padding: [12, 12], animate: !prefersReducedMotion() });
      else fitTo(ids.map(function (cid) { return [cellIndex[cid].lat, cellIndex[cid].lon]; }));
    }
    openDrawer("region");
  }

  // ---------- draw an area (logic from draw.js) ----------

  function rectShape(south, north, west, east) {
    return { type: "rect", bounds: [Math.min(south, north), Math.max(south, north), Math.min(west, east), Math.max(west, east)] };
  }

  function inPoly(lat, lon, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var yi = pts[i][0], xi = pts[i][1], yj = pts[j][0], xj = pts[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function selectAreaCells(shape) {
    var ids = cellIds.filter(function (id) {
      var c = cellIndex[id];
      if (shape.type === "rect") return c.lat >= shape.bounds[0] && c.lat <= shape.bounds[1] && c.lon >= shape.bounds[2] && c.lon <= shape.bounds[3];
      return inPoly(c.lat, c.lon, shape.pts);
    });
    var small = false;
    if (!ids.length) {   // shape smaller than a cell: use the cell(s) that contain the shape's centre
      var cy, cx;
      if (shape.type === "rect") { cy = (shape.bounds[0] + shape.bounds[1]) / 2; cx = (shape.bounds[2] + shape.bounds[3]) / 2; }
      else { cy = shape.pts.reduce(function (s, p) { return s + p[0]; }, 0) / shape.pts.length; cx = shape.pts.reduce(function (s, p) { return s + p[1]; }, 0) / shape.pts.length; }
      ids = cellIds.filter(function (id) { var c = cellIndex[id]; return Math.abs(c.lat - cy) <= CELL / 2 && Math.abs(c.lon - cx) <= CELL / 2; });
      small = true;
    }
    return { ids: ids, small: small };
  }

  function aggregate(shape) {
    var sel = selectAreaCells(shape);
    var acc = {};
    sel.ids.forEach(function (id) {
      cellIndex[id].rows.forEach(function (r) {
        var key = r.year * 100 + r.month;
        var a = acc[key] || (acc[key] = { harm: 0, aqua: 0 });
        a.harm += r.harmonized_cell_days || 0;
        a.aqua += r.modis_cell_days || 0;
      });
    });
    var rel = T.reliability;
    var rows = months.map(function (meta) {
      var key = meta.key;
      var a = acc[key] || { harm: 0, aqua: 0 };
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
    Object.keys(base).forEach(function (m) { med[m] = median(base[m]); });
    rows.forEach(function (r) {
      if (r.status !== "ok" || r.value === null) return;
      r.median = med[r.month];
      if (r.median > 0) {
        r.ratio = r.value / r.median;
        r.cls = MVP.classify(r.ratio);
        if (r.low !== null) r.stable = MVP.classify(r.low / r.median) === MVP.classify(r.high / r.median);
      }
    });
    // rank and percentile within each calendar month, among every month with an estimate
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

  function describeShape() {
    var s = state.shape;
    if (!s) return "";
    if (s.type === "rect") return "rectangle S" + s.bounds[0].toFixed(2) + " N" + s.bounds[1].toFixed(2) + " W" + s.bounds[2].toFixed(2) + " E" + s.bounds[3].toFixed(2);
    return "polygon " + s.pts.map(function (p) { return p[0].toFixed(2) + "/" + p[1].toFixed(2); }).join(";");
  }

  function setShape(s) {
    state.shape = s;
    if (shapeLayer) shapeLayer.remove();
    shapeLayer = s.type === "rect"
      ? L.rectangle([[s.bounds[0], s.bounds[2]], [s.bounds[1], s.bounds[3]]], Object.assign(shapeStyle(), { interactive: false }))
      : L.polygon(s.pts, Object.assign(shapeStyle(), { interactive: false }));
    shapeLayer.addTo(map);
    if (s.type === "rect") {
      var f = document.getElementById("coords");
      f.south.value = s.bounds[0].toFixed(2); f.north.value = s.bounds[1].toFixed(2); f.west.value = s.bounds[2].toFixed(2); f.east.value = s.bounds[3].toFixed(2);
      setParams({ rect: s.bounds.map(function (v) { return v.toFixed(2); }).join(",") });
    } else {
      setParams({ rect: null });
    }
    var info = aggregate(s);
    if (!info.cells.length) {
      // Outside the data (the cells cover Argentina only): say so, and keep showing Argentina's calendar.
      drawer.info = null;
      showSelection(null);
      openDrawer("region");
      document.getElementById("tool-help").textContent = "No map cells inside that shape. The data covers Argentina only; draw over Argentina, or pick an example.";
      return;
    }
    drawer.info = info;
    showSelection(drawer.info.cells);
    openDrawer("area");
  }

  function clearShape() {
    state.shape = null;
    drawer.info = null;
    if (shapeLayer) { shapeLayer.remove(); shapeLayer = null; }
    resetPoly();
    setTool(null);
    setParams({ rect: null });
    showSelection(null);
    openDrawer("region");
  }

  function setTool(t) {
    state.tool = state.tool === t ? null : t;
    document.getElementById("tool-rect").setAttribute("aria-pressed", String(state.tool === "rect"));
    document.getElementById("tool-poly").setAttribute("aria-pressed", String(state.tool === "poly"));
    document.getElementById("tool-finish").hidden = state.tool !== "poly";
    document.body.classList.toggle("drawing", !!state.tool);
    if (map) {
      if (state.tool === "rect") map.dragging.disable(); else map.dragging.enable();
      if (state.tool === "poly") map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    }
    if (state.tool !== "poly") resetPoly();
    document.getElementById("tool-help").textContent = state.tool === "rect" ? "Press on the map and drag to draw a rectangle."
      : state.tool === "poly" ? "Click each corner on the map, then press Finish polygon (or double-click)."
        : "Choose a tool, then drag on the map (rectangle) or click the corners and press Finish (polygon). Map cells are about 1 degree (roughly 100 km) wide.";
  }

  function resetPoly() {
    polyPts = [];
    if (polyLayer) { polyLayer.remove(); polyLayer = null; }
  }

  function finishPolygon() {
    if (polyPts.length < 3) {
      document.getElementById("tool-help").textContent = "A polygon needs at least three corners.";
      return;
    }
    var pts = polyPts.slice();
    resetPoly();
    setShape({ type: "poly", pts: pts });
    setTool(null);
  }

  function initDrawControls() {
    document.getElementById("tool-rect").addEventListener("click", function () { setTool("rect"); });
    document.getElementById("tool-poly").addEventListener("click", function () { setTool("poly"); });
    document.getElementById("tool-finish").addEventListener("click", finishPolygon);
    document.getElementById("tool-clear").addEventListener("click", clearShape);
    var ex = document.getElementById("examples");
    EXAMPLES.forEach(function (e) {
      var b = el("button", { type: "button", class: "chip", text: e.label });
      b.addEventListener("click", function () {
        setShape(rectShape(e.rect[0], e.rect[1], e.rect[2], e.rect[3]));
        fitTo([[e.rect[0], e.rect[2]], [e.rect[1], e.rect[3]]]);
      });
      ex.appendChild(b);
    });
    document.getElementById("coords").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var s = Number(f.south.value), n = Number(f.north.value), w = Number(f.west.value), e = Number(f.east.value);
      if (s >= n || w >= e) { document.getElementById("tool-help").textContent = "South must be below north, and west must be left of east."; return; }
      setShape(rectShape(s, n, w, e));
      fitTo([[s, w], [n, e]]);
    });
    var from = document.getElementById("year-from");
    var to = document.getElementById("year-to");
    for (var y = 2003; y <= 2026; y++) {
      from.appendChild(el("option", { value: y, text: y }));
      to.appendChild(el("option", { value: y, text: y }));
    }
    from.value = state.yearFrom;
    to.value = state.yearTo;
    var onYears = function () {
      state.yearFrom = Math.min(Number(from.value), Number(to.value));
      state.yearTo = Math.max(Number(from.value), Number(to.value));
      if (drawer.kind === "area") openDrawer("area");
    };
    from.addEventListener("change", onYears);
    to.addEventListener("change", onYears);
  }

  // ---------- the side column: calendar, detail, stats, series, CSV ----------

  function drawerCtx() {
    if (drawer.kind === "region") return { name: regionName(drawerRegion()), baselineLabel: BASE_LABEL[state.base], relRows: T.reliability };
    return { name: "Your area", baselineLabel: "median of the same month, 2003–2022, in your area", relRows: T.reliability };
  }

  function rowByKey(key) { return drawer.rows.filter(function (r) { return r.key === key; })[0] || null; }

  function tile(host, label, value, sub, node) {
    var d = el("div", { class: "stat" }, [el("div", { class: "stat-label", text: label }), el("div", { class: "stat-value", text: value }), sub ? el("p", { class: "stat-sub", text: sub }) : null]);
    if (node) d.appendChild(node);
    host.appendChild(d);
  }

  function paintRegionStats(rid, rows) {
    var host = document.getElementById("drawer-stats");
    host.innerHTML = "";
    var ok = rows.filter(function (r) { return r.status === "ok" && r.value !== null; });
    var last = ok[ok.length - 1];
    if (last) {
      tile(host, "Latest measured month", formatCompact(last.value), monthLabel(last.year, last.month) + " detections.");
      tile(host, "Compared with usual", formatRatio(last.ratio), classWords(last.cls) + " for " + MONTHS[last.month - 1] + ".");
      tile(host, "Rank in that month", last.rank ? last.rank + " of " + last.nRanked : "–", "1 = busiest " + MONTHS[last.month - 1] + " on file.");
    }
    var best = (T.annual || []).filter(function (a) { return a.region_id === rid && a.is_complete && a.rank === 1; })[0];
    if (best) tile(host, "Busiest complete year", String(best.year), formatNumber(best.harmonized_cell_days) + " detections.");
  }

  function paintAreaStats(info, rows) {
    var host = document.getElementById("drawer-stats");
    host.innerHTML = "";
    var modelled = rows.filter(function (r) { return r.method === "modelled_aqua" || r.method === "insufficient_data"; });
    var counts = { reliable: 0, good: 0, caution: 0, indicative_only: 0 };
    modelled.forEach(function (r) { counts[r.flag] = (counts[r.flag] || 0) + 1; });
    var worst = counts.indicative_only ? "indicative_only" : counts.caution ? "caution" : counts.good ? "good" : "reliable";
    var aquaMed = median(modelled.filter(function (r) { return r.aqua > 0; }).map(function (r) { return r.aqua; })) || 0;
    var typical = MVP.reliabilityFor(T.reliability, aquaMed);
    tile(host, "Map cells inside", String(info.cells.length), info.small ? "Your shape is smaller than one cell, so the whole cell (about 100 km) is used." : "Each cell is about 1 degree, roughly 100 km wide.");
    var tot = rows.filter(function (r) { return r.year === 2025 && r.value !== null; }).reduce(function (s, r) { return s + r.value; }, 0);
    tile(host, "Detections in 2025", formatNumber(tot), "VIIRS-equivalent, measured by VIIRS.");
    tile(host, "Typical reliability before 2012", typical ? (MVP.FLAG_LABEL[typical.reliability] || typical.reliability) : "Indicative only",
      "Typical converted month has about " + formatNumber(aquaMed) + " MODIS detections.", el("div", null, [MVP.flagBadge(typical ? typical.reliability : "indicative_only")]));
    tile(host, "Converted months by flag", (counts.reliable + counts.good) + " ok · " + counts.caution + " caution · " + counts.indicative_only + " indicative",
      "Worst: " + (MVP.FLAG_LABEL[worst] || worst) + ". " + MVP.suggestionFor(T.reliability, worst));
  }

  function openDrawer(kind) {
    drawer.kind = kind;
    var link = document.getElementById("drawer-link");
    var baseline = document.getElementById("baseline");
    var close = document.getElementById("drawer-close");

    if (kind === "region") {
      var rid = drawerRegion();
      drawer.rows = drawer.all = regionRows(rid);
      var prov = drawer.rows.filter(function (r) { return r.status === "provisional" || r.status === "incomplete"; }).length;
      document.getElementById("drawer-eyebrow").textContent = state.mode === "region" ? "Region" : state.mode === "draw" ? "Showing Argentina until you draw an area" : "Fire calendar";
      document.getElementById("drawer-title").textContent = regionName(rid);
      document.getElementById("drawer-sub").textContent = "Each square is one month. Colour = how it compares with the same month in other years." +
        (prov ? " " + prov + " newer month" + (prov === 1 ? " is" : "s are") + " provisional and not compared yet." : "");
      document.getElementById("drawer-caption").innerHTML = "<strong>What to notice:</strong> hatched squares (2003 to 2011) are converted from MODIS and carry a likely range; from 2012 they are measured by VIIRS. Both are on one scale, so a jump at 2012 would show as a change in colour that is not there.";
      close.hidden = rid === "argentina";
      baseline.hidden = false;
      segmented(baseline, [{ value: "default", label: "Usual: harmonized 2003–2022" }, { value: "viirs", label: "Measured VIIRS 2012–2025" }], state.base, function (v) {
        state.base = v;
        setParams({ base: v === "default" ? null : v });
        openDrawer("region");
      });
      link.hidden = false;
      link.href = "regions.html?region=" + encodeURIComponent(rid);
      link.innerHTML = icon("calendar", 16) + "Full page";
      paintRegionStats(rid, drawer.rows);
    } else {
      var info = drawer.info;
      drawer.all = info.rows;
      drawer.rows = info.rows.filter(function (r) { return r.year >= state.yearFrom && r.year <= state.yearTo; });
      document.getElementById("drawer-eyebrow").textContent = "Your area";
      document.getElementById("drawer-title").textContent = info.cells.length + " map cell" + (info.cells.length === 1 ? "" : "s") + ", " + state.yearFrom + " to " + state.yearTo;
      document.getElementById("drawer-sub").textContent = describeShape();
      document.getElementById("drawer-caption").innerHTML = "<strong>What to notice:</strong> the same colours as the regions, computed for your shape. Usual = median of the same calendar month over 2003 to 2022 in your area. Hatched squares before 2012 are converted from MODIS, and their flag depends on how many MODIS detections your area has.";
      close.hidden = false;
      baseline.hidden = true;
      link.hidden = true;
      paintAreaStats(info, drawer.rows);
    }

    // Selected month: the timeline's month if this calendar has it, else the latest compared month.
    var key = currentMonth().key;
    if (!rowByKey(key)) {
      var ok = drawer.rows.filter(function (r) { return r.status === "ok" && r.value !== null; });
      key = (ok.length ? ok[ok.length - 1] : drawer.rows[drawer.rows.length - 1]).key;
    }
    drawer.selected = key;
    drawer.grid = MVP.calendarGrid(document.getElementById("calendar"), drawer.rows, {
      selected: key,
      label: "Months by year for " + drawerCtx().name,
      onSelect: function (r) {
        drawer.selected = r.key;
        MVP.detailPanel(document.getElementById("detail"), r, drawerCtx());
        if (monthAt[r.key] !== undefined) { stop(); goTo(monthAt[r.key], true); }
      },
    });
    MVP.calendarKey(document.getElementById("cal-key"));
    MVP.detailPanel(document.getElementById("detail"), rowByKey(key), drawerCtx());

    var pts = drawer.rows.map(function (r) {
      return { x: r.year + (r.month - 1) / 12, y: r.value, low: r.low, high: r.high,
        kind: r.method === "provisional_nrt" ? "provisional" : r.method === "modelled_aqua" ? "modelled" : "observed",
        title: monthLabel(r.year, r.month), note: MVP.statusText(r) || methodLabel(r.method) };
    });
    var first = drawer.rows[0];
    var lastRow = drawer.rows[drawer.rows.length - 1];
    MVP.seriesChart(document.getElementById("series"), {
      height: 220, label: "Monthly series for " + drawerCtx().name,
      lines: [{ name: "Harmonized", color: cssVar("--s-harm"), points: pts }],
      vlines: first && lastRow && first.year < 2012 && lastRow.year >= 2012 ? [{ x: 2012 + 1 / 12, label: "VIIRS measured from here" }] : [],
    });
    document.getElementById("csv").onclick = downloadDrawerCsv;
    paintHeadline();
  }

  // Timeline moved: mark the same month in the calendar and show its detail.
  function syncDrawer(key) {
    if (!drawer.kind || !drawer.grid) return;
    var r = rowByKey(key);
    if (!r) return;
    drawer.selected = key;
    drawer.grid.mark(key);
    MVP.detailPanel(document.getElementById("detail"), r, drawerCtx());
  }

  function downloadDrawerCsv() {
    var header = ["month", "detections_viirs_equivalent", "likely_low", "likely_high", "method", "reliability", "status", "comparison_with_usual", "class"];
    var area = drawer.kind === "area";
    if (area) header = header.concat(["cells", "shape"]);
    else header = header.concat(["region"]);
    var rid = drawerRegion();
    var rows = drawer.rows.map(function (r) {
      var line = [r.year + "-" + (r.month < 10 ? "0" : "") + r.month, r.value === null ? "" : Math.round(r.value * 10) / 10,
        r.low === null ? "" : Math.round(r.low * 10) / 10, r.high === null ? "" : Math.round(r.high * 10) / 10, r.method,
        r.method === "modelled_aqua" || r.method === "insufficient_data" ? r.flag : "reliable", r.status,
        r.ratio === null || r.ratio === undefined ? "" : Math.round(r.ratio * 1000) / 1000, r.cls || ""];
      return area ? line.concat([drawer.info.cells.length, describeShape()]) : line.concat([rid]);
    });
    downloadCsv(area ? "fire_drawn_area_monthly.csv" : "fire_" + rid + "_monthly.csv", header, rows);
  }

  // ---------- modes ----------

  function paintModeSwitch() {
    segmented(document.getElementById("mode"), MODES, state.mode, function (v) { setMode(v); });
  }

  function showPanes(m) {
    ["explore", "region", "draw"].forEach(function (p) { document.getElementById("pane-" + p).hidden = p !== m; });
    document.getElementById("explore-side").hidden = m !== "explore";
  }

  // fromSelect: called by selectRegion, which paints the region itself.
  function setMode(m, fromSelect) {
    if (!fromSelect && state.mode === m && document.getElementById("pane-" + m).hidden === false && drawer.kind) return;
    state.mode = m;
    setParams({ mode: m === "explore" ? null : m });
    paintModeSwitch();
    showPanes(m);
    setTool(null);
    if (fromSelect) return;
    if (m === "explore") {
      showSelection(null);
      openDrawer("region");
      paintCellList();
      paintCellDetail();
    } else if (m === "region") {
      selectRegion(state.region);
    } else if (state.shape && drawer.info) {
      showSelection(drawer.info.cells);
      openDrawer("area");
    } else {
      showSelection(null);
      openDrawer("region");
    }
  }

  // ---------- start ----------

  segmented(document.getElementById("metric"), METRICS, state.metric, function (v) {
    state.metric = v;
    setParams({ metric: v === "harmonized" ? null : v });
    paintCells();
    paintLegend();
    paintTimeline();
    if (state.mode === "explore") { paintCellList(); paintCellDetail(); }
  });
  document.getElementById("play").addEventListener("click", play);
  document.getElementById("prev").addEventListener("click", function () { stop(); goTo(state.index - 1); });
  document.getElementById("next").addEventListener("click", function () { stop(); goTo(state.index + 1); });
  document.getElementById("slider").addEventListener("input", function (e) { stop(); goTo(Number(e.target.value)); });
  document.getElementById("drawer-close").addEventListener("click", function () {
    if (drawer.kind === "area") clearShape();
    else selectRegion("argentina", true);
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.tool) { setTool(null); return; }
    if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); play(); }
  });
  initDrawControls();
  paintModeSwitch();
  showPanes(state.mode);

  if (typeof L === "undefined") {
    banner.dataset.source = "offline";
    banner.textContent = "The map library did not load. The page needs a network connection for Leaflet and the map tiles.";
    return;
  }
  initMap();
  addBasemap();

  MVP.loadTables(["gold_cell_monthly", "gold_reliability", "gold_region_monthly", "gold_region_annual"], banner).then(function (t) {
    T = { reliability: t.gold_reliability.rows, monthly: t.gold_region_monthly.rows, annual: t.gold_region_annual.rows };
    index(t.gold_cell_monthly.rows);
    if (!months.length) return;
    T.monthly.forEach(function (r) { if (r.region_id === "argentina" && r.is_complete === false) inProgress[r.year * 100 + r.month] = true; });
    state.index = startIndex();
    paintLegend();
    paintTimeline();
    paintRegionChips();
    var q = (queryParam("rect") || "").split(",").map(Number);
    if (q.length === 4 && q.every(isFinite)) {
      state.mode = "draw";
      paintModeSwitch();
      showPanes("draw");
      setShape(rectShape(q[0], q[1], q[2], q[3]));
    } else if (state.mode === "region") {
      selectRegion(state.region);
    } else {
      showSelection(null);
      openDrawer("region");
      if (state.mode === "explore") { paintCellList(); paintCellDetail(); }
    }
    document.addEventListener("themechange", function () {
      paintCells();
      paintLegend();
      if (shapeLayer) shapeLayer.setStyle(shapeStyle());
      if (fadeLayer) fadeLayer.setStyle(fadeStyle());
      if (outlineLayer) outlineLayer.setStyle(outlineStyle());
      if (selectionIds) showSelection(Object.keys(selectionIds).map(Number));
      openDrawer(drawer.kind || "region");
      if (state.mode === "explore") paintCellDetail();
    });
  }).catch(function (err) {
    document.getElementById("timeline-label").innerHTML = "<strong>No data</strong><span></span>";
    setText("head-title", "The data could not be loaded");
    setText("head-sub", err && err.message ? err.message : "");
  });
})();
