// Regions: the month x year calendar for Argentina and its sub-areas, from gold_region_monthly / gold_region_annual.
// Provisional (NRT) months and the month in progress show a value but no anomaly (SCOPE_AND_GAPS.md, A2).

(function () {
  var banner = document.getElementById("data-banner");
  document.getElementById("doc-approach").innerHTML = MVP.docLink("HARMONIZATION_APPROACH.md", "How the conversion works");
  document.getElementById("doc-scope").innerHTML = MVP.docLink("SCOPE_AND_GAPS.md", "What is and is not covered");

  var SHORT = { argentina: "Argentina", ar_ne: "North-east", ar_nw: "North-west", ar_c: "Centre", ar_s: "Patagonia", ar_delta: "Paraná Delta" };
  var EVENTS = [
    { label: "Paraná Delta, April 2008", region: "ar_delta", year: 2008, month: 4 },
    { label: "Paraná Delta, August 2020 (fires Aug–Oct)", region: "ar_delta", year: 2020, month: 8 },
    { label: "Corrientes (north-east), January 2022", region: "ar_ne", year: 2022, month: 1 },
    { label: "Corrientes (north-east), February 2022", region: "ar_ne", year: 2022, month: 2 },
  ];
  var BASE_LABEL = { default: "median of the harmonized record 2003–2022", viirs: "median of measured VIIRS months 2012–2025" };

  var state = { base: queryParam("base") === "viirs" ? "viirs" : "default", selected: null };
  var T = null;          // tables
  var rows = [];         // normalised rows of the current region
  var grid = null;

  function region() { return currentRegion(); }
  function rowsFor(id) {
    return T.monthly.filter(function (r) { return r.region_id === id; })
      .sort(function (a, b) { return a.year - b.year || a.month - b.month; })
      .map(function (r) { return MVP.norm(r, state.base); });
  }

  function paintChips() {
    var host = document.getElementById("region-chips");
    host.innerHTML = "";
    REGIONS.forEach(function (r) {
      var b = el("button", { type: "button", class: "chip", "aria-pressed": String(r.id === region()), title: r.name, text: SHORT[r.id] || r.name });
      b.addEventListener("click", function () { setRegion(r.id); });
      host.appendChild(b);
    });
    var ev = document.getElementById("events");
    ev.innerHTML = "";
    EVENTS.forEach(function (e) {
      var b = el("button", { type: "button", class: "chip", text: e.label });
      b.addEventListener("click", function () {
        state.selected = e.year * 100 + e.month;
        if (region() !== e.region) setRegion(e.region); else render();
      });
      ev.appendChild(b);
    });
  }

  function paintBaseline() {
    segmented(document.getElementById("baseline"), [
      { value: "default", label: "Harmonized 2003–2022 (default)" }, { value: "viirs", label: "Measured VIIRS 2012–2025" }], state.base,
      function (v) { state.base = v; setParams({ base: v === "default" ? "" : v }); render(); });
  }

  function ctx() { return { name: regionName(region()), baselineLabel: BASE_LABEL[state.base], relRows: T.reliability }; }

  function currentRow() {
    return rows.filter(function (r) { return r.key === state.selected; })[0] || null;
  }

  function paintDetail() { MVP.detailPanel(document.getElementById("detail"), currentRow(), ctx()); }

  function paintLatest() {
    var host = document.getElementById("latest");
    host.innerHTML = "";
    var ok = rows.filter(function (r) { return r.status === "ok"; });
    var lastOk = ok[ok.length - 1];
    if (lastOk) {
      host.appendChild(el("p", { class: "eyebrow", text: "Latest measured month compared with usual" }));
      var big = el("div", { class: "big", style: "font-size:1.6rem;font-weight:750" }, [monthLabel(lastOk.year, lastOk.month) + ": " + formatNumber(lastOk.value)]);
      host.appendChild(big);
      host.appendChild(el("p", { class: "small", text: formatRatio(lastOk.ratio) + " the usual " + MONTHS[lastOk.month - 1] + " (" + formatNumber(lastOk.median) + ", " + BASE_LABEL[state.base] + "). " + (CLASS_LABEL[lastOk.cls] || "") + " usual" + (lastOk.rank ? ", rank " + lastOk.rank + " of " + lastOk.nRanked + "." : ".") }));
    }
    var prov = rows.filter(function (r) { return r.status === "provisional" || r.status === "incomplete"; });
    if (prov.length) {
      host.appendChild(el("p", { class: "eyebrow", style: "margin-top:1rem", text: "Provisional months (not compared yet)" }));
      var list = el("ul", { style: "list-style:none;margin:0;padding:0;display:grid;gap:0.3rem" });
      prov.forEach(function (r) {
        var li = el("li", { class: "small" }, [el("strong", { text: monthLabel(r.year, r.month) + ": " }), formatNumber(r.value) + " detections ",
          MVP.methodBadge("provisional_nrt")]);
        if (r.status === "incomplete") li.appendChild(document.createTextNode(" (month in progress)"));
        list.appendChild(li);
      });
      host.appendChild(list);
      host.appendChild(el("p", { class: "small muted", text: "Near-real-time data is replaced by science-quality data some months later. These values can change, so no colour, percentage or rank is shown." }));
    }
  }

  function paintTops() {
    var m = document.getElementById("top-months");
    m.innerHTML = "";
    rows.filter(function (r) { return r.status === "ok" && r.value !== null; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 8).forEach(function (r) {
        var li = el("li", { tabindex: "0" }, [el("span", { class: "nm", text: monthLabel(r.year, r.month) }),
          el("span", { class: "vl", text: formatCompact(r.value) + " · " + (MVP.METHOD[r.method] || {}).short.toLowerCase() })]);
        li.title = (MVP.METHOD[r.method] || {}).label;
        var go = function () { state.selected = r.key; grid.select(r.key); };
        li.addEventListener("click", go);
        li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
        m.appendChild(li);
      });
    var y = document.getElementById("top-years");
    y.innerHTML = "";
    T.annual.filter(function (a) { return a.region_id === region() && a.is_complete && a.rank !== null; })
      .sort(function (a, b) { return a.rank - b.rank; }).slice(0, 6).forEach(function (a) {
        var tag = a.method === "modelled_aqua" ? "converted" : a.method === "mixed" ? "part converted" : "measured";
        y.appendChild(el("li", null, [el("span", { class: "nm", text: a.year + " · rank " + a.rank }), el("span", { class: "vl", text: formatCompact(a.harmonized_cell_days) + " · " + tag })]));
      });
    if (!y.children.length) y.appendChild(el("li", { class: "small muted", text: "No complete years." }));
  }

  function paintSeries() {
    document.getElementById("series-sub").textContent = regionName(region()) + ": harmonized detections per month (VIIRS-equivalent).";
    var pts = rows.map(function (r) {
      return { x: r.year + (r.month - 1) / 12, y: r.value, low: r.low, high: r.high,
        kind: r.method === "provisional_nrt" ? "provisional" : r.method === "modelled_aqua" ? "modelled" : "observed",
        title: monthLabel(r.year, r.month), note: statusNote(r) };
    });
    MVP.seriesChart(document.getElementById("series"), { height: 300, label: "Monthly series for " + regionName(region()),
      lines: [{ name: "Harmonized", color: cssVar("--s-harm"), points: pts }], vlines: [{ x: 2012 + 1 / 12, label: "VIIRS measured from here" }] });
  }

  function statusNote(r) {
    return MVP.statusText(r) || (MVP.METHOD[r.method] || {}).label;
  }

  function paintCsv() {
    var btn = document.getElementById("csv");
    btn.onclick = function () {
      var header = ["region", "month", "detections_viirs_equivalent", "likely_low", "likely_high", "method", "reliability", "status", "comparison_with_usual", "class", "usual_baseline"];
      downloadCsv("fire_" + region() + "_monthly.csv", header, rows.map(function (r) {
        return [region(), r.year + "-" + (r.month < 10 ? "0" : "") + r.month, r.value, r.method === "modelled_aqua" ? r.low : "", r.method === "modelled_aqua" ? r.high : "",
          r.method, r.method === "modelled_aqua" ? r.flag : "reliable", r.status, r.ratio === null ? "" : r.ratio, r.cls || "", BASE_LABEL[state.base]];
      }));
    };
  }

  function render() {
    rows = rowsFor(region());
    paintChips();
    document.getElementById("eyebrow").textContent = regionName(region());
    var dflt = rows.filter(function (r) { return r.status === "ok"; });
    if (!state.selected || !rows.some(function (r) { return r.key === state.selected; })) state.selected = dflt.length ? dflt[dflt.length - 1].key : rows[rows.length - 1].key;
    grid = MVP.calendarGrid(document.getElementById("calendar"), rows, {
      selected: state.selected, label: "Months by year for " + regionName(region()),
      onSelect: function (r) { state.selected = r.key; setParams({ year: r.year, month: r.month }); paintDetail(); },
    });
    MVP.calendarKey(document.getElementById("cal-key"));
    document.getElementById("cal-caption").innerHTML = "<strong>What to notice:</strong> darker ember = busier than usual, blue = quieter. The pattern across 2003 to 2011 (hatched) and 2012 onwards (solid) is on one scale, so a seam at 2012 would show up as a change in colour that is not there. Usual = " + BASE_LABEL[state.base] + ".";
    paintDetail();
    paintLatest();
    paintTops();
    paintSeries();
    paintCsv();
  }

  MVP.loadTables(["gold_region_monthly", "gold_region_annual", "gold_reliability"], banner).then(function (t) {
    T = { monthly: t.gold_region_monthly.rows, annual: t.gold_region_annual.rows, reliability: t.gold_reliability.rows };
    var y = Number(queryParam("year")), m = Number(queryParam("month"));
    if (y && m) state.selected = y * 100 + m;
    paintBaseline();
    render();
    onRegionChange(function () { render(); });
    document.addEventListener("themechange", function () { render(); });
  }).catch(function (err) { document.getElementById("calendar").textContent = "The data could not be loaded. " + err.message; });
})();
