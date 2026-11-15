// Year: annual totals, when the season arrived, the closest earlier years,
// and the monthly calibration ratios. ?year= selects a year.

var banner = document.getElementById("data-banner");
var store = { annual: [], analogs: [], calibration: [], monthly: [] };
var selectedYear = Number(queryParam("year")) || null;
var hiddenSeries = {};
var ANALOG_COLORS = ["--s-modis", "--s-viirs", "--s-4"];

Promise.all([
  fetchGold("gold_region_annual"),
  fetchGold("gold_region_analogs"),
  fetchGold("gold_calibration"),
  fetchGold("gold_region_monthly"),
]).then(function (results) {
  store.annual = results[0].rows || [];
  store.analogs = results[1].rows || [];
  store.calibration = results[2].rows || [];
  store.monthly = results[3].rows || [];
  var sample = results.filter(function (data) { return data.source !== "r2"; });
  showBanner(banner, sample.length ? sample[0] : results[0]);
  render();
  onRegionChange(function () {
    selectedYear = null;
    hiddenSeries = {};
    render();
  });
}).catch(function () { showOffline(banner); });

document.addEventListener("themechange", function () { if (store.annual.length) render(); });

function mineAnnual() {
  return store.annual.filter(function (row) { return row.region_id === currentRegion(); }).sort(function (a, b) { return a.year - b.year; });
}

function monthsOf(year) {
  var out = [];
  for (var m = 1; m <= 12; m++) {
    var r = store.monthly.filter(function (x) { return x.region_id === currentRegion() && x.year === year && x.month === m; })[0];
    out.push(r ? r.harmonized_cell_days : null);
  }
  return out;
}

function pickYear(year) {
  selectedYear = year;
  setParams({ year: year });
  render();
}

function render() {
  var mine = mineAnnual();
  if (!mine.length) return;
  if (!selectedYear || !mine.some(function (r) { return r.year === selectedYear; })) {
    selectedYear = mine[mine.length - 1].year;
  }
  var current = mine.filter(function (r) { return r.year === selectedYear; })[0];
  document.getElementById("eyebrow").textContent = regionName(currentRegion()) + " · year, season, analogs";
  renderChips(mine);
  renderBars(mine, current);
  renderDetail(current);
  renderSeason(current);
  renderAnalogs();
  renderCalibration();
}

function renderChips(mine) {
  var host = document.getElementById("year-chips");
  host.innerHTML = "";
  mine.forEach(function (row) {
    var chip = el("button", { type: "button", class: "chip", "aria-pressed": String(row.year === selectedYear), text: String(row.year) + (row.is_complete ? "" : " ·") });
    if (!row.is_complete) chip.title = "Not all 12 months on file";
    chip.addEventListener("click", function () { pickYear(row.year); });
    host.appendChild(chip);
  });
}

function median(values) {
  var v = values.slice().sort(function (a, b) { return a - b; });
  if (!v.length) return null;
  var mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function renderBars(mine, current) {
  var usual = median(mine.filter(function (r) { return r.is_complete; }).map(function (r) { return r.harmonized_cell_days; }));
  barChart(document.getElementById("years-chart"), {
    data: mine.map(function (r) {
      return { key: r.year, label: String(r.year), title: String(r.year) + (r.is_complete ? "" : " (incomplete)"), value: r.harmonized_cell_days, partial: !r.is_complete, row: r };
    }),
    selectedKey: current ? current.year : null,
    median: usual,
    medianLabel: "Median year",
    height: 260,
    color: "--s-harm",
    ariaLabel: "Harmonized detections by year",
    tooltip: function (d) {
      return {
        title: d.title,
        rows: [
          { label: "Detections", value: formatNumber(d.value), color: cssVar("--s-harm"), kind: "box" },
          { label: "Rank", value: d.row.rank + " of " + d.row.n_years_ranked },
          { label: "Peak", value: MONTHS[d.row.peak_month - 1] },
        ],
        note: d.partial ? d.row.months_available + " of 12 months on file" : "Click to select",
      };
    },
    onSelect: function (d) { pickYear(d.row.year); },
  });
  var button = document.getElementById("years-table-btn");
  var fresh = button.cloneNode(false);
  button.replaceWith(fresh);
  document.getElementById("years-chart").hidden = false;
  document.getElementById("years-table").hidden = true;
  tableToggle(fresh, document.getElementById("years-chart"), document.getElementById("years-table"), function () {
    return buildTable(["Year", "Detections", "Rank", "Vs usual", "Peak month", "Months"], mine.map(function (r) {
      return [r.year, formatNumber(r.harmonized_cell_days), r.rank + " of " + r.n_years_ranked, formatRatio(r.anomaly_ratio), MONTHS[r.peak_month - 1], r.months_available];
    }));
  });
}

function renderDetail(current) {
  var host = document.getElementById("year-detail");
  host.innerHTML = "";
  if (!current) return;
  host.appendChild(el("p", { class: "eyebrow", text: regionName(current.region_id) }));
  var head = el("div", { class: "card-head" }, [el("h2", { style: "font-size:1.6rem", text: String(current.year) })]);
  if (!current.is_complete) head.appendChild(el("a", { class: "badge", href: "glossary.html#month-still-open", text: current.months_available + " of 12 months" }));
  host.appendChild(head);
  var big = el("div", { class: "kpi-value", text: formatNumber(current.harmonized_cell_days) });
  big.appendChild(el("span", { class: "unit", text: "detections" }));
  host.appendChild(big);
  var dl = el("dl", { class: "metric" });
  dl.innerHTML =
    metricItem(term("rank", "Rank"), current.rank + " of " + current.n_years_ranked, "1 is the most active year in the file. An incomplete year can rank low simply because months are still missing.") +
    metricItem(term("anomaly-ratio", "Compared with a usual year"), formatRatio(current.anomaly_ratio), "This year divided by the median year. Near 1, the year as a whole looks ordinary even if one month inside it was extreme.") +
    metricItem(term("peak-month", "Peak month"), MONTHS[current.peak_month - 1] + " · " + formatCompact(current.peak_month_cell_days), "The month that contributed the most. The burning calendar is about when the season peaks, not only whether the year was high.") +
    metricItem(term("season", "Season length"), current.season_length_months + " months", MONTHS[current.season_start_month - 1] + " to " + MONTHS[current.season_end_month - 1] + ".");
  host.appendChild(dl);
  host.appendChild(el("div", { class: "hero-actions" }, [
    el("a", { class: "btn small secondary", href: "calendar.html?region=" + encodeURIComponent(current.region_id) + "&year=" + current.year + "&month=" + current.peak_month, html: icon("calendar", 16) + "Peak month in the calendar" }),
  ]));
}

function renderSeason(current) {
  var host = document.getElementById("ribbon");
  var note = document.getElementById("season-note");
  host.innerHTML = "";
  if (!current) { note.textContent = ""; return; }
  note.textContent = "The shaded months run from " + MONTHS[current.season_start_month - 1] + " to " + MONTHS[current.season_end_month - 1] +
    " (" + current.season_length_months + " months). Start is when 10% of the year's detections had arrived, the midpoint is 50%, and the end is 90%. The tallest bar is the peak. A season that starts early or runs long is a different kind of change than one hot month.";
  var values = monthsOf(current.year);
  var max = Math.max.apply(null, values.filter(function (v) { return !isMissing(v); }).concat([1]));
  var total = values.reduce(function (sum, v) { return sum + (v || 0); }, 0);
  for (var m = 1; m <= 12; m++) {
    var v = values[m - 1];
    var inside = m >= current.season_start_month && m <= current.season_end_month;
    var cls = "month" + (inside ? " in" : "") + (m === current.peak_month ? " peak" : "");
    var cell = el("div", { class: cls, tabindex: "0", "aria-label": MONTHS[m - 1] + ": " + (isMissing(v) ? "no data" : formatNumber(v) + " detections") + (inside ? ", inside the season" : "") });
    cell.appendChild(el("span", { class: "lbl", text: MONTHS_SHORT[m - 1] }));
    if (!isMissing(v)) cell.appendChild(el("div", { class: "fill", style: "height:" + Math.max(3, (52 * v) / max) + "px" }));
    var marker = m === current.season_start_month ? "Start" : m === current.season_midpoint_month ? "Mid" : m === current.season_end_month ? "End" : null;
    if (marker) cell.appendChild(el("span", { class: "marker", text: marker }));
    (function (month, value) {
      var content = function () {
        return {
          title: MONTHS[month - 1] + " " + current.year,
          rows: [
            { label: "Detections", value: isMissing(value) ? "no data" : formatNumber(value), color: cssVar("--s-harm"), kind: "box" },
            { label: "Share of year", value: isMissing(value) || !total ? "–" : Math.round((100 * value) / total) + "%" },
          ],
        };
      };
      cell.addEventListener("pointermove", function (event) { Tip.show(content(), event.clientX, event.clientY); });
      cell.addEventListener("pointerleave", Tip.hide);
      cell.addEventListener("focus", function () { Tip.showAt(content(), cell); });
      cell.addEventListener("blur", Tip.hide);
    })(m, v);
    host.appendChild(cell);
  }
}

function cumulative(values, through) {
  var sum = 0;
  return values.map(function (v, i) {
    if (through && i >= through) return null;
    if (isMissing(v)) return i === 0 ? null : (sum ? sum : null);
    sum += v;
    return sum;
  });
}

function renderAnalogs() {
  var host = document.getElementById("analogs");
  var note = document.getElementById("analog-note");
  host.innerHTML = "";
  var mine = store.analogs.filter(function (row) { return row.region_id === currentRegion(); }).sort(function (a, b) { return a.rank - b.rank; });
  if (!mine.length) {
    note.textContent = "No analog years in this file.";
    document.getElementById("analog-chart").innerHTML = "";
    return;
  }
  var target = mine[0].target_year;
  var through = mine[0].through_month;
  note.innerHTML = "Past years whose pattern from January through " + MONTHS[through - 1] + " " + target + " looks most like " + target + ". " +
    term("similarity", "Similarity") + " is a 0 to 100 reading of that match. It shows how similar seasons played out. It does not predict this year.";

  mine.forEach(function (row, i) {
    var card = el("article", { class: "analog", style: "border-left:3px solid " + cssVar(ANALOG_COLORS[i % ANALOG_COLORS.length]) });
    card.appendChild(el("h3", null, [el("span", { text: row.rank + ". " + row.analog_year }), el("span", { class: "num", text: Math.round(row.similarity_pct) + "%" })]));
    card.appendChild(el("div", { class: "sim", "aria-hidden": "true" }, [el("i", { style: "width:" + Math.round(row.similarity_pct) + "%" })]));
    card.appendChild(el("p", { class: "small", html: term("rest-of-year", "What happened next") + ": " + formatNumber(row.analog_rest_of_year_cell_days) + " more detections after " + MONTHS[row.through_month - 1] + ", " + formatRatio(row.analog_rest_vs_median) + " the usual rest of the year." }));
    var link = el("button", { type: "button", class: "btn small ghost", text: "Open " + row.analog_year });
    link.addEventListener("click", function () { pickYear(row.analog_year); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }); });
    card.appendChild(link);
    host.appendChild(card);
  });

  var series = [{ key: "t" + target, name: target + " so far", values: cumulative(monthsOf(target), through), color: "--s-harm", width: 2.5 }];
  mine.forEach(function (row, i) {
    series.push({ key: "a" + row.analog_year, name: String(row.analog_year), values: cumulative(monthsOf(row.analog_year)), color: ANALOG_COLORS[i % ANALOG_COLORS.length], dashed: i > 0 });
  });
  series.forEach(function (s) { s.hidden = !!hiddenSeries[s.key]; });

  lineBandChart(document.getElementById("analog-chart"), {
    labels: MONTHS_SHORT,
    titles: MONTHS,
    band: null,
    median: null,
    series: series,
    selectedIndex: through - 1,
    height: 260,
    ariaLabel: "Running total of detections for " + target + " and its closest years",
  });
  legend(document.getElementById("analog-legend"), series.map(function (s) {
    return {
      kind: s.dashed ? "dash" : "line",
      label: s.name,
      color: cssVar(s.color),
      hidden: s.hidden,
      onToggle: function (on) { hiddenSeries[s.key] = !on; renderAnalogs(); },
    };
  }));
  var button = document.getElementById("analog-table-btn");
  var fresh = button.cloneNode(false);
  button.replaceWith(fresh);
  document.getElementById("analog-chart").hidden = false;
  document.getElementById("analog-table").hidden = true;
  tableToggle(fresh, document.getElementById("analog-chart"), document.getElementById("analog-table"), function () {
    return buildTable(["Month"].concat(series.map(function (s) { return s.name; })), MONTHS.map(function (name, i) {
      return [name].concat(series.map(function (s) { return formatNumber(s.values[i]); }));
    }));
  });
}

function renderCalibration() {
  var region = regionById(currentRegion());
  var mine = store.calibration.filter(function (row) { return row.stratum_id === region.stratum; }).sort(function (a, b) { return a.month - b.month; });
  var note = document.getElementById("cal-note");
  if (!mine.length) {
    note.textContent = "No calibration rows for this stratum.";
    document.getElementById("cal-chart").innerHTML = "";
    return;
  }
  var first = mine[0];
  note.innerHTML = "Each bar is the " + term("calibration-ratio", "calibration ratio") + " for " + term("stratum", "stratum") + " " + first.stratum_id +
    ": VIIRS detections divided by MODIS detections in that calendar month. It is the factor used when a month has to be filled from MODIS. " +
    term("holdout-error", "Holdout error") + " " + first.holdout_mape + "% is how far that factor was off on years it was not fit to; smaller is a more trustworthy adjustment. " +
    term("fit-window", "Fit") + " on " + first.n_months + " overlap months, " + first.fit_start + " to " + first.fit_end + ", using " + first.viirs_sensor + " (" + first.method_version + ").";
  barChart(document.getElementById("cal-chart"), {
    data: mine.map(function (row) {
      return { key: row.month, label: MONTHS_SHORT[row.month - 1], title: MONTHS[row.month - 1], value: row.ratio, row: row };
    }),
    color: "--s-viirs",
    height: 210,
    median: 1,
    medianLabel: "Same count",
    format: function (v) { return (Math.round(v * 100) / 100).toString(); },
    ariaLabel: "Calibration ratio by month",
    tooltip: function (d) {
      return {
        title: d.title,
        rows: [
          { label: "Ratio (VIIRS ÷ MODIS)", value: d.row.ratio.toFixed(2), color: cssVar("--s-viirs"), kind: "box" },
          { label: "MODIS detections in fit", value: formatCompact(d.row.modis_cell_days_fit) },
          { label: "VIIRS detections in fit", value: formatCompact(d.row.viirs_cell_days_fit) },
          { label: "Holdout error", value: d.row.holdout_mape + "%" },
        ],
      };
    },
  });
  var button = document.getElementById("cal-table-btn");
  var fresh = button.cloneNode(false);
  button.replaceWith(fresh);
  document.getElementById("cal-chart").hidden = false;
  document.getElementById("cal-table").hidden = true;
  tableToggle(fresh, document.getElementById("cal-chart"), document.getElementById("cal-table"), function () {
    return buildTable(["Month", "Ratio", "MODIS in fit", "VIIRS in fit", "Holdout error"], mine.map(function (row) {
      return [MONTHS[row.month - 1], row.ratio.toFixed(2), formatNumber(row.modis_cell_days_fit), formatNumber(row.viirs_cell_days_fit), row.holdout_mape + "%"];
    }));
  });
}
