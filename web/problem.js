// The Problem: raw (joined end to end) against harmonized, for Argentina.
// Reads gold_region_monthly (raw_count, harmonized_cell_days, modis_cell_days, viirs_cell_days) and gold_region_annual.

(function () {
  var banner = document.getElementById("data-banner");
  document.getElementById("doc-approach").innerHTML = MVP.docLink("HARMONIZATION_APPROACH.md", "How the conversion works");
  document.getElementById("doc-scope").innerHTML = MVP.docLink("SCOPE_AND_GAPS.md", "What is and is not covered");

  var state = { view: queryParam("view") === "harm" ? "harm" : "raw", mode: ["years", "series", "sats"].indexOf(queryParam("mode")) > -1 ? queryParam("mode") : "years" };
  var rows = [];
  var annual = [];
  var chartHost = document.getElementById("chart");

  function x(r) { return r.year + (r.month - 1) / 12; }
  function kindOf(r) {
    if (r.method === "provisional_nrt") return "provisional";
    if (r.method === "modelled_aqua") return "modelled";
    return "observed";
  }

  // ---- monthly line specs ----
  function monthlySpec() {
    if (state.mode === "sats") {
      var plain = function (r) { return r.method === "provisional_nrt" ? "provisional" : "observed"; };
      return {
        log: true, shade: false,
        lines: [
          { name: "MODIS Aqua", color: cssVar("--s-modis"), points: rows.map(function (r) { return { x: x(r), y: r.modis_cell_days, kind: plain(r), title: monthLabel(r.year, r.month), note: "Raw count, as received" }; }) },
          { name: "VIIRS (Suomi NPP, then NOAA-20)", color: cssVar("--s-viirs"), points: rows.map(function (r) { return { x: x(r), y: r.viirs_cell_days, kind: plain(r), title: monthLabel(r.year, r.month), note: "Raw count, as received" }; }) },
        ],
        vlines: [{ x: 2012 + 1 / 12, label: "VIIRS data starts (Jan 2012)" }],
      };
    }
    if (state.view === "raw") {
      return {
        shade: false,
        lines: [{
          name: "Raw count, joined end to end", color: cssVar("--s-modis"),
          points: rows.map(function (r) {
            return { x: x(r), y: r.raw_count, kind: r.method === "provisional_nrt" ? "provisional" : "observed",
              color: r.raw_satellite === "Aqua" ? cssVar("--s-modis") : cssVar("--s-viirs"), title: monthLabel(r.year, r.month),
              note: "Counted by " + r.raw_satellite + (r.method === "provisional_nrt" ? " (provisional)" : "") };
          }),
        }],
        vlines: [{ x: 2012 + 1 / 12, label: "Switch to VIIRS (2012)" }],
      };
    }
    return {
      lines: [{
        name: "Harmonized (VIIRS-equivalent)", color: cssVar("--s-harm"),
        points: rows.map(function (r) {
          return { x: x(r), y: r.harmonized_cell_days, low: r.harmonized_low, high: r.harmonized_high, kind: kindOf(r),
            title: monthLabel(r.year, r.month), note: (MVP.METHOD[r.method] || {}).label };
        }),
      }],
      vlines: [{ x: 2012 + 1 / 12, label: "VIIRS measured from here" }],
    };
  }

  // ---- yearly bar spec ----
  function yearlySpec() {
    var by = {};
    rows.forEach(function (r) {
      var y = by[r.year] = by[r.year] || { raw: 0, months: 0 };
      y.raw += r.raw_count || 0;
      y.months++;
    });
    var a = {};
    annual.forEach(function (r) { a[r.year] = r; });
    var years = Object.keys(by).map(Number).sort(function (p, q) { return p - q; });
    var last = years[years.length - 1];
    var bars = years.map(function (y) {
      var ar = a[y] || {};
      var inProgress = by[y].months < 12 || y === last;
      if (state.view === "raw") {
        return { label: String(y), value: by[y].raw, kind: inProgress ? "partial" : "observed",
          color: y >= 2012 ? cssVar("--s-viirs") : cssVar("--s-modis"),
          title: y + (inProgress ? " so far" : ""),
          note: y < 2012 ? "Counted by MODIS Aqua" : y === 2012 ? "MODIS Aqua in January, VIIRS from February" : "Counted by VIIRS" };
      }
      var kind = inProgress ? "partial" : ar.method === "modelled_aqua" ? "modelled" : ar.method === "mixed" ? "mixed" : "observed";
      return { label: String(y), value: ar.harmonized_cell_days, low: ar.harmonized_low, high: ar.harmonized_high, kind: kind,
        color: cssVar("--s-harm"), title: y + (inProgress ? " so far" : ""),
        note: ar.method === "mixed" ? "Converted in January, measured from February" : ((MVP.METHOD[ar.method] || {}).label || "") };
    });
    return { bars: bars, height: 340, label: "Fire detections per year, Argentina",
      vline: { before: "2012", text: state.view === "raw" ? "Switch to VIIRS" : "VIIRS measured from here" } };
  }

  function paintKey() {
    var key = document.getElementById("chart-key");
    var sw = function (c) { return "<svg width='22' height='10' aria-hidden='true'><line x1='0' x2='22' y1='5' y2='5' stroke='" + c + "' stroke-width='2.5'/></svg>"; };
    var hatch = function (fill) {
      return "<svg width='22' height='12' aria-hidden='true'><defs><pattern id='kh' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><line x1='0' y1='0' x2='0' y2='6' class='hatch-line'/></pattern></defs>" +
        (fill ? "<rect width='22' height='12' fill='" + fill + "'/>" : "") + "<rect width='22' height='12' fill='url(#kh)'/></svg>";
    };
    var parts = [];
    if (state.mode === "sats") {
      parts.push("<span class='k'>" + sw(cssVar("--s-modis")) + "MODIS Aqua, raw</span>", "<span class='k'>" + sw(cssVar("--s-viirs")) + "VIIRS, raw</span>");
    } else if (state.view === "raw") {
      parts.push("<span class='k'>" + sw(cssVar("--s-modis")) + "Counted by MODIS Aqua</span>", "<span class='k'>" + sw(cssVar("--s-viirs")) + "Counted by VIIRS</span>");
    } else if (state.mode === "years") {
      parts.push("<span class='k'>" + hatch(cssVar("--s-harm")) + "Hatched: converted from MODIS (whiskers = likely range)</span>", "<span class='k'>Solid: measured by VIIRS</span>");
    } else {
      parts.push("<span class='k'>" + sw(cssVar("--s-harm")) + "Harmonized</span>", "<span class='k'>" + hatch() + "Hatched background: converted from MODIS (band = likely range)</span>", "<span class='k'>Plain background: measured by VIIRS</span>");
    }
    parts.push("<span class='k'>" + (state.mode === "years" ? "Dashed outline: year in progress" : "Dotted line: provisional months") + "</span>");
    key.innerHTML = parts.join("");
  }

  function paintText() {
    var sub = document.getElementById("chart-sub");
    var cap = document.getElementById("caption");
    document.getElementById("chart-title").textContent = "Fire detections per " + (state.mode === "years" ? "year" : "month") + ", Argentina";
    if (state.mode === "sats") {
      sub.textContent = "Raw monthly counts for each camera, log scale. Nothing has been converted.";
      cap.innerHTML = "<strong>What to notice:</strong> the two lines have the same seasons and the same big fire years, but VIIRS sits about 4 to 7 times higher. The newer camera is not seeing more fire. It sees smaller fires.";
    } else if (state.mode === "years") {
      sub.textContent = state.view === "raw" ? "Yearly totals of the raw counts, joined end to end." : "Yearly totals in one unit for every year: the detections one VIIRS satellite would have counted.";
      cap.innerHTML = state.view === "raw"
        ? "<strong>What to notice:</strong> the bars jump by a factor of about 3.7 between 2011 and 2012, when the count switches from MODIS Aqua to VIIRS. That is a new camera counting, not more fire."
        : "<strong>What to notice:</strong> no jump at 2012. Hatched bars (2003 to 2011) are converted from MODIS and carry a likely range. Plain bars are measured. The dashed bar is the year in progress.";
    } else if (state.view === "raw") {
      sub.textContent = "Raw counts as each satellite reported them, joined end to end.";
      cap.innerHTML = "<strong>What to notice:</strong> the monthly series steps up in 2012, when the count switches from MODIS Aqua to VIIRS. The seasons stay the same. Only the scale changes.";
    } else {
      sub.textContent = "Every month in the same unit: the fire detections one VIIRS satellite would have counted.";
      cap.innerHTML = "<strong>What to notice:</strong> the scale no longer changes at 2012. The hatched stretch before 2012 is converted from MODIS, with a likely range. Months from 2012 are measured. The latest months are provisional (dotted).";
    }
  }

  function sum(year) {
    return rows.filter(function (r) { return r.year === year; }).reduce(function (s, r) { return s + (r.raw_count || 0); }, 0);
  }

  function paintStats() {
    var host = document.getElementById("stats");
    host.innerHTML = "";
    var raw11 = sum(2011), raw12 = sum(2012);
    var a11 = annual.filter(function (a) { return a.year === 2011; })[0];
    var a12 = annual.filter(function (a) { return a.year === 2012; })[0];
    function tile(label, value, sub, bad) {
      host.appendChild(el("div", { class: "stat" + (bad ? " bad" : "") }, [
        el("div", { class: "stat-label", text: label }), el("div", { class: "stat-value", text: value }), el("p", { class: "stat-sub", text: sub }),
      ]));
    }
    if (raw11 && raw12) tile("Raw record, 2011 → 2012", "×" + (raw12 / raw11).toFixed(1), formatNumber(raw11) + " → " + formatNumber(raw12) + " detections. A new camera started counting.", true);
    if (a11 && a12) tile("Harmonized, 2011 → 2012", "×" + (a12.harmonized_cell_days / a11.harmonized_cell_days).toFixed(2), formatNumber(a11.harmonized_cell_days) + " → " + formatNumber(a12.harmonized_cell_days) + " VIIRS-equivalent detections. No artificial jump.");
    var big = annual.filter(function (a) { return a.is_complete; }).sort(function (a, b) { return a.rank - b.rank; })[0];
    if (big) tile("Busiest complete year", String(big.year), formatNumber(big.harmonized_cell_days) + " VIIRS-equivalent detections (complete years only).");
  }

  function draw() {
    paintText();
    paintKey();
    if (state.mode === "years") MVP.yearBars(chartHost, yearlySpec());
    else MVP.seriesChart(chartHost, Object.assign({ height: 340, label: "Monthly fire detections for Argentina" }, monthlySpec()));
  }

  function paintView() {
    segmented(document.getElementById("view"), [
      { value: "raw", label: "Raw, joined end to end" }, { value: "harm", label: "Harmonized" }], state.view,
      function (v) { state.view = v; if (state.mode === "sats") { state.mode = "years"; paintMode(); } draw(); });
  }

  function paintMode() {
    segmented(document.getElementById("mode"), [
      { value: "years", label: "Year totals" }, { value: "series", label: "Months" }, { value: "sats", label: "Cameras side by side" }], state.mode,
      function (v) { state.mode = v; draw(); });
  }

  MVP.loadTables(["gold_region_monthly", "gold_region_annual"], banner).then(function (t) {
    rows = t.gold_region_monthly.rows.filter(function (r) { return r.region_id === "argentina"; })
      .sort(function (a, b) { return a.year - b.year || a.month - b.month; });
    annual = t.gold_region_annual.rows.filter(function (r) { return r.region_id === "argentina"; });
    paintView();
    paintMode();
    paintStats();
    draw();
    document.addEventListener("themechange", function () { paintKey(); });
  }).catch(function (err) { chartHost.textContent = "The data could not be loaded. " + err.message; });
})();
