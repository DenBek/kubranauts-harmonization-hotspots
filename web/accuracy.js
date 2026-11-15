// How accurate is this?: numbers from gold_accuracy and gold_reliability. Nothing here is typed in by hand
// except the plain-language flag help, which comes from the suggestion column of gold_reliability.

(function () {
  var banner = document.getElementById("data-banner");
  document.getElementById("doc-approach").innerHTML = MVP.docLink("HARMONIZATION_APPROACH.md", "How the conversion works and was tested");
  document.getElementById("doc-scope").innerHTML = MVP.docLink("SCOPE_AND_GAPS.md", "Known gaps");

  var ORDER = ["median_monthly_error_pct", "p90_monthly_error_pct", "worst_annual_error_pct", "anomaly_agreement_country_pct", "likely_range_coverage_pct", "mean_bias_pct"];
  var TITLE = {
    median_monthly_error_pct: "Typical monthly error",
    p90_monthly_error_pct: "Error in 9 months out of 10",
    worst_annual_error_pct: "Worst yearly error",
    anomaly_agreement_country_pct: "Same colour as measured",
    likely_range_coverage_pct: "Likely range held",
    mean_bias_pct: "Average bias",
  };

  function fmt(metric, v) {
    if (metric === "mean_bias_pct") return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%";
    if (metric.indexOf("error") > -1) return "within " + v.toFixed(1) + "%";
    return Math.round(v) + "%";
  }

  function paintStats(rows) {
    var host = document.getElementById("stats");
    host.innerHTML = "";
    var by = {};
    rows.forEach(function (r) { by[r.metric] = r; });
    ORDER.forEach(function (m) {
      var r = by[m];
      if (!r) return;
      var inSample = String(r.test_period).toUpperCase().indexOf("IN SAMPLE") > -1;
      host.appendChild(el("div", { class: "stat" }, [
        el("div", { class: "stat-label", text: TITLE[m] }),
        el("div", { class: "stat-value", text: fmt(m, Number(r.value)) }),
        el("p", { class: "stat-sub", text: r.statement }),
        el("span", { class: "stat-scope" + (inSample ? " in-sample" : ""), text: (inSample ? "In sample: " : "Held-out years: ") + r.test_period.replace(/\s*\(.*$/, "") }),
      ]));
    });
    var lo = by.likely_range_low_pct, hi = by.likely_range_high_pct;
    if (lo && hi) {
      host.appendChild(el("div", { class: "stat" }, [
        el("div", { class: "stat-label", text: "Likely range, whole country, one month" }),
        el("div", { class: "stat-value", text: "−" + Math.abs(lo.value).toFixed(0) + "% to +" + Number(hi.value).toFixed(0) + "%" }),
        el("p", { class: "stat-sub", text: "About an 85% chance the true value lies in this range around the converted value." }),
        el("span", { class: "stat-scope", text: "Held-out years: 2020-01 to 2022-12" }),
      ]));
    }
  }

  function paintReliability(rows) {
    var body = document.querySelector("#rel-table tbody");
    body.innerHTML = "";
    var sorted = rows.slice().sort(function (a, b) { return b.aqua_min - a.aqua_min; });
    var lg = function (pct) { return Math.log10(Math.max(1 + pct / 100, 0.05)); };
    var lo = Math.log10(0.1), hi = Math.log10(8);
    var colors = { reliable: "#21918c", good: "#5ec962", caution: "#3b528b", indicative_only: "#440154" };
    sorted.forEach(function (r) {
      var W = 220, H = 16;
      var X = function (p) { return (Math.min(Math.max(lg(p), lo), hi) - lo) / (hi - lo) * W; };
      var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": "Likely range " + MVP.pct(r.likely_low_pct) + " to " + MVP.pct(r.likely_high_pct) });
      svg("line", { x1: X(0), x2: X(0), y1: 0, y2: H, stroke: cssVar("--ink-2"), "stroke-width": 1 }, s);
      svg("rect", { x: X(r.likely_low_pct), y: 3, width: Math.max(X(r.likely_high_pct) - X(r.likely_low_pct), 2), height: 10, rx: 2, fill: colors[r.reliability] || "#888" }, s);
      var tdRange = el("td", { class: "num" }, [el("div", { text: MVP.pct(r.likely_low_pct) + " to " + MVP.pct(r.likely_high_pct) }), s]);
      var size = r.aqua_max_excl === null || r.aqua_max_excl === undefined ? "≥ " + formatNumber(r.aqua_min) : (r.aqua_min === 0 ? "fewer than " + formatNumber(r.aqua_max_excl) : formatNumber(r.aqua_min) + " to " + formatNumber(r.aqua_max_excl - 1));
      body.appendChild(el("tr", null, [el("td", { class: "num", text: size }), tdRange, el("td", null, [MVP.flagBadge(r.reliability)])]));
    });
    var help = document.getElementById("flag-help");
    help.innerHTML = "";
    ["reliable", "good", "caution", "indicative_only"].forEach(function (f) {
      var s = MVP.suggestionFor(rows, f);
      var li = el("li", null, [MVP.flagBadge(f), " " + s]);
      help.appendChild(li);
    });
  }

  MVP.loadTables(["gold_accuracy", "gold_reliability"], banner).then(function (t) {
    paintStats(t.gold_accuracy.rows);
    paintReliability(t.gold_reliability.rows);
  }).catch(function (err) { document.getElementById("stats").textContent = "The data could not be loaded. " + err.message; });
})();
