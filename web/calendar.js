// Calendar: one square per month, colored by how that month compares with the
// same month in other years. Selecting a square fills the side panel and the
// two charts below. The selection lives in the URL (?year=&month=&metric=),
// so a link opens the same month.

var banner = document.getElementById("data-banner");
var rows = [];
var state = {
  metric: queryParam("metric") || "harmonized",
  showValues: true,
  explain: false,
  selected: null,
};
var hidden = { harmonized: false, modis: false, viirs: false };

var METRICS = [
  { value: "harmonized", label: "Harmonized" },
  { value: "modis", label: "MODIS" },
  { value: "viirs", label: "VIIRS" },
];
var METRIC_FIELD = { harmonized: "harmonized_cell_days", modis: "modis_cell_days", viirs: "viirs_cell_days" };
var METRIC_LABEL = { harmonized: "Harmonized detections", modis: "MODIS detections", viirs: "VIIRS detections" };
var METRIC_TERM = { harmonized: "harmonized-detections", modis: "modis", viirs: "viirs" };
var METRIC_HELP = {
  harmonized: "The comparable figure. The number of fire detections, after MODIS and VIIRS are put on the same scale (VIIRS-equivalent). This is the number the calendar uses for history.",
  modis: "Activity counted from MODIS only. The long record, but a coarser and less sensitive sensor than VIIRS, so this number is not the one to compare across the whole time series.",
  viirs: "Activity counted from VIIRS only. Empty before April 2018, because that sensor was not observing yet. It usually runs higher than MODIS for the same fires, which is why a calibration ratio exists.",
};

segmented(document.getElementById("metric"), METRICS, state.metric, function (value) {
  state.metric = value;
  setParams({ metric: value === "harmonized" ? null : value });
  render();
});

document.getElementById("show-values").addEventListener("change", function (event) {
  state.showValues = event.target.checked;
  document.getElementById("heatmap").classList.toggle("no-values", !state.showValues);
});
document.getElementById("csv").addEventListener("click", exportCsv);

fetchGold("gold_region_monthly")
  .then(function (data) {
    rows = data.rows || [];
    showBanner(banner, data);
    var y = Number(queryParam("year"));
    var m = Number(queryParam("month"));
    if (y && m) state.selected = { year: y, month: m };
    render();
    // Keep the same month when switching regions, so the two can be compared.
    onRegionChange(function () { render(); });
  })
  .catch(function () { showOffline(banner); });

document.addEventListener("themechange", function () { if (rows.length) render(); });

function regionRows() {
  var region = currentRegion();
  return rows
    .filter(function (row) { return row.region_id === region; })
    .sort(function (a, b) { return a.year - b.year || a.month - b.month; });
}

function find(mine, year, month) {
  return mine.filter(function (row) { return row.year === year && row.month === month; })[0];
}

function value(row, metric) {
  return row ? row[METRIC_FIELD[metric || state.metric]] : null;
}

function selectedRow(mine) {
  if (state.selected) {
    var hit = find(mine, state.selected.year, state.selected.month);
    if (hit) return hit;
  }
  var latest = mine[mine.length - 1];
  if (latest) {
    state.selected = { year: latest.year, month: latest.month };
    if (queryParam("year")) setParams({ year: latest.year, month: latest.month });
  }
  return latest;
}

function select(year, month, focus) {
  state.selected = { year: year, month: month };
  setParams({ year: year, month: month });
  render(focus);
}

// ---------- heatmap ----------

function render(focusSelected) {
  var mine = regionRows();
  var current = selectedRow(mine);
  document.getElementById("eyebrow").textContent = regionName(currentRegion()) + " · region months";
  renderHeatmap(mine, current, focusSelected);
  renderDetail(current);
  renderAcross(mine, current);
  renderSensors(mine, current);
}

function renderHeatmap(mine, current, focusSelected) {
  var grid = document.getElementById("heatmap");
  grid.innerHTML = "";
  grid.classList.toggle("no-values", !state.showValues);

  grid.appendChild(el("div", { class: "hm-head", "aria-hidden": "true" }));
  MONTHS_SHORT.forEach(function (name, i) {
    grid.appendChild(el("div", { class: "hm-head", "data-month": i + 1, text: name }));
  });

  var years = [];
  mine.forEach(function (row) { if (years.indexOf(row.year) === -1) years.push(row.year); });
  years.sort(function (a, b) { return a - b; });

  var firstViirs = mine.filter(function (row) { return !isMissing(row.viirs_cell_days); })[0];
  var cells = [];

  years.forEach(function (year, index) {
    if (index > 0 && year - years[index - 1] > 1) {
      var from = years[index - 1] + 1;
      var to = year - 1;
      grid.appendChild(el("div", { class: "hm-gap", text: (from === to ? from : from + "–" + to) + " not in this dataset" }));
    }
    grid.appendChild(el("div", { class: "hm-year", "data-year": year, text: String(year) }));
    for (var month = 1; month <= 12; month++) {
      var row = find(mine, year, month);
      if (!row) {
        grid.appendChild(el("div", { class: "hm-empty", title: monthLabel(year, month) + ": no data" }));
        continue;
      }
      var cell = heatCell(row, current, firstViirs);
      cells.push(cell);
      grid.appendChild(cell);
    }
  });

  var selectedCell = grid.querySelector(".hm-cell[aria-pressed='true']") || cells[cells.length - 1];
  if (selectedCell) {
    selectedCell.setAttribute("tabindex", "0");
    if (focusSelected) selectedCell.focus();
  }

  legend(document.getElementById("legend"), CLASS_ORDER.map(function (name) {
    return { kind: "box", label: CLASS_LABEL[name], color: classColor(name) };
  }));
}

function heatCell(row, current, firstViirs) {
  var fill = classColor(row.anomaly_class);
  var v = value(row);
  var selected = current && current.year === row.year && current.month === row.month;
  var classes = "hm-cell";
  if (row.is_provisional || !row.is_complete) classes += " provisional";
  if (firstViirs && firstViirs.year === row.year && firstViirs.month === row.month) classes += " seam-start";
  var cell = el("button", {
    type: "button",
    class: classes,
    tabindex: "-1",
    "data-year": row.year,
    "data-month": row.month,
    "aria-pressed": String(!!selected),
    "aria-label": monthLabel(row.year, row.month) + ", " + (CLASS_LABEL[row.anomaly_class] ? CLASS_LABEL[row.anomaly_class] + " usual" : "provisional, not compared yet") + ", " +
      (isMissing(v) ? "no " + METRIC_LABEL[state.metric] : formatNumber(v) + " " + METRIC_LABEL[state.metric]),
    style: "background:" + fill + ";color:" + textOn(fill),
  }, [el("span", { text: isMissing(v) ? "·" : formatCompact(v) })]);

  var content = function () {
    var rowsOut = [
      { label: METRIC_LABEL[state.metric], value: isMissing(v) ? "no value" : formatNumber(v), color: fill, kind: "box" },
      { label: "Usual " + MONTHS[row.month - 1], value: formatNumber(row.baseline_median) },
      { label: "Compared with usual", value: formatRatio(row.anomaly_ratio) },
      { label: "Rank", value: (isMissing(row.rank_in_month) ? "not ranked yet" : row.rank_in_month + " of " + row.n_years_ranked) },
    ];
    var note = CLASS_LABEL[row.anomaly_class] ? CLASS_LABEL[row.anomaly_class] + " usual" : "Provisional, not compared yet";
    if (row.is_provisional) note += " · provisional";
    if (!row.is_complete) note += " · month still open";
    return { title: monthLabel(row.year, row.month), rows: rowsOut, note: note };
  };

  cell.addEventListener("pointerenter", function () { crosshair(row.year, row.month, true); });
  cell.addEventListener("pointermove", function (event) { Tip.show(content(), event.clientX, event.clientY); });
  cell.addEventListener("pointerleave", function () { crosshair(row.year, row.month, false); Tip.hide(); });
  cell.addEventListener("focus", function () { crosshair(row.year, row.month, true); Tip.showAt(content(), cell); });
  cell.addEventListener("blur", function () { crosshair(row.year, row.month, false); Tip.hide(); });
  cell.addEventListener("click", function () { Tip.hide(); select(row.year, row.month, true); });
  cell.addEventListener("keydown", function (event) { moveFocus(event, row); });
  return cell;
}

function crosshair(year, month, on) {
  var grid = document.getElementById("heatmap");
  var head = grid.querySelector(".hm-head[data-month='" + month + "']");
  var label = grid.querySelector(".hm-year[data-year='" + year + "']");
  if (head) head.classList.toggle("hot", on);
  if (label) label.classList.toggle("hot", on);
}

function moveFocus(event, row) {
  var mine = regionRows();
  var years = [];
  mine.forEach(function (r) { if (years.indexOf(r.year) === -1) years.push(r.year); });
  years.sort(function (a, b) { return a - b; });
  var target = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    var step = event.key === "ArrowLeft" ? -1 : 1;
    var index = mine.indexOf(row) + step;
    target = mine[index];
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    var yi = years.indexOf(row.year) + (event.key === "ArrowUp" ? -1 : 1);
    while (yi >= 0 && yi < years.length && !target) {
      target = find(mine, years[yi], row.month);
      yi += event.key === "ArrowUp" ? -1 : 1;
    }
  } else if (event.key === "Home") {
    target = mine[0];
  } else if (event.key === "End") {
    target = mine[mine.length - 1];
  }
  if (!target) return;
  event.preventDefault();
  select(target.year, target.month, true);
}

// ---------- side panel ----------

function renderDetail(row) {
  var panel = document.getElementById("detail");
  panel.innerHTML = "";
  if (!row) {
    panel.appendChild(el("h2", { text: "No months for this region yet." }));
    return;
  }
  var v = value(row);
  var monthName = MONTHS[row.month - 1];

  panel.appendChild(el("p", { class: "eyebrow", text: regionName(row.region_id) }));
  panel.appendChild(el("div", { class: "card-head", style: "margin-bottom:0.2rem" }, [
    el("h2", { style: "font-size:1.5rem", text: monthLabel(row.year, row.month) }),
    statusChip(row.anomaly_class),
  ]));
  var badges = el("div");
  if (row.is_provisional) badges.appendChild(el("a", { class: "badge", href: "glossary.html#provisional", text: "Provisional" }));
  if (!row.is_complete) badges.appendChild(el("a", { class: "badge", href: "glossary.html#month-still-open", text: "Month still open" }));
  panel.appendChild(badges);

  var big = el("div", { class: "kpi-value", style: "margin-top:0.6rem", text: isMissing(v) ? "No value" : formatNumber(v) });
  big.appendChild(el("span", { class: "unit", text: METRIC_LABEL[state.metric].replace(" detections", "") + " detections" }));
  panel.appendChild(big);
  if (isMissing(v) && state.metric === "viirs") panel.appendChild(el("p", { class: "small muted", text: "VIIRS was not observing yet in this month." }));

  var bulletHost = el("div");
  panel.appendChild(bulletHost);
  bullet(bulletHost, { lo: row.baseline_p25, hi: row.baseline_p75, median: row.baseline_median, value: row.harmonized_cell_days, color: classColor(row.anomaly_class) });
  panel.appendChild(el("p", { class: "small muted", text: "Dot: harmonized detections. Band: the middle half of past " + monthName + "s. Line: the usual " + monthName + "." }));

  var toggle = el("label", { class: "switch", style: "margin-top:0.5rem" }, [
    el("input", { type: "checkbox" }),
    el("span", { class: "track" }),
    "Explain each number",
  ]);
  var checkbox = toggle.querySelector("input");
  checkbox.checked = state.explain;
  panel.appendChild(toggle);

  var ratioText = isMissing(row.anomaly_ratio) ? "Not compared yet" : formatRatio(row.anomaly_ratio);
  var dl = el("dl", { class: "metric" + (state.explain ? "" : " compact") });
  dl.innerHTML =
    metricItem(term(METRIC_TERM[state.metric], METRIC_LABEL[state.metric]), isMissing(v) ? "No value" : formatNumber(v), METRIC_HELP[state.metric]) +
    metricItem(term("usual-month", "Usual " + monthName), formatNumber(row.baseline_median), "The median of this calendar month across the years on file. Half of past years were busier, half quieter. Comparing against this, rather than against last year alone, is how a manager sees whether the season is unusual.") +
    metricItem(term("normal-range", "Normal range"), formatCompact(row.baseline_p25) + " – " + formatCompact(row.baseline_p75), "The middle half of past years for this month. Inside the band the month looks ordinary. Outside it, the month is quiet or busy relative to its own history.") +
    metricItem(term("anomaly-ratio", "Compared with usual"), ratioText, "This month divided by the usual month. The " + term("anomaly-diff", "difference") + " is " + (row.anomaly_diff > 0 ? "+" : "") + formatNumber(row.anomaly_diff) + " detections.") +
    metricItem(term("rank", "Rank"), (isMissing(row.rank_in_month) ? "not ranked yet" : row.rank_in_month + " of " + row.n_years_ranked), "1 is the busiest year for this month. " + term("percentile-rank", "Percentile") + " " + row.percentile_rank + " places it on a 0 to 100 scale among those years.") +
    metricItem(term("source", "Source"), sourceLabel(row.source), sourceHelp(row.source)) +
    metricItem(term("modis", "MODIS"), formatNumber(row.modis_cell_days), "Raw MODIS detections, before harmonization.") +
    metricItem(term("viirs", "VIIRS"), formatNumber(row.viirs_cell_days), "Raw VIIRS detections. Empty before April 2018.");
  panel.appendChild(dl);
  checkbox.addEventListener("change", function () {
    state.explain = checkbox.checked;
    dl.classList.toggle("compact", !state.explain);
  });

  var q = "?region=" + encodeURIComponent(row.region_id) + "&year=" + row.year + "&month=" + row.month;
  panel.appendChild(el("div", { class: "hero-actions" }, [
    el("a", { class: "btn small secondary", href: "index.html" + q, html: icon("map", 16) + "Show on the map" }),
    el("a", { class: "btn small secondary", href: "briefing.html" + q, html: icon("send", 16) + "Text briefing" }),
  ]));
}

// ---------- charts ----------

function renderAcross(mine, current) {
  if (!current) return;
  var month = current.month;
  var same = mine.filter(function (row) { return row.month === month; });
  document.getElementById("across-title").textContent = MONTHS[month - 1] + " across the years";
  var data = same.map(function (row) {
    return {
      key: row.year,
      label: String(row.year),
      title: monthLabel(row.year, row.month),
      value: value(row),
      partial: row.is_provisional || !row.is_complete,
      row: row,
    };
  });
  barChart(document.getElementById("across-chart"), {
    data: data,
    color: state.metric === "modis" ? "--s-modis" : state.metric === "viirs" ? "--s-viirs" : "--s-harm",
    selectedKey: current.year,
    median: state.metric === "harmonized" ? current.baseline_median : null,
    medianLabel: "Usual",
    height: 230,
    ariaLabel: MONTHS[month - 1] + " " + METRIC_LABEL[state.metric] + " by year",
    tooltip: function (d) {
      return {
        title: d.title,
        rows: [
          { label: METRIC_LABEL[state.metric], value: isMissing(d.value) ? "no value" : formatNumber(d.value), color: cssVar(state.metric === "modis" ? "--s-modis" : state.metric === "viirs" ? "--s-viirs" : "--s-harm"), kind: "box" },
          { label: "Class", value: CLASS_LABEL[d.row.anomaly_class] || "Provisional, not compared yet" },
          { label: "Rank", value: (isMissing(d.row.rank_in_month) ? "not ranked yet" : d.row.rank_in_month + " of " + d.row.n_years_ranked) },
        ],
        note: d.partial ? "Hatched: provisional or still open" : "Click to select",
      };
    },
    onSelect: function (d) { select(d.row.year, d.row.month, false); },
  });
  resetTable("across-table-btn", "across-chart", "across-table", function () {
    return buildTable(["Year", METRIC_LABEL[state.metric], "Class", "Rank"], same.map(function (row) {
      return [row.year, formatNumber(value(row)), (CLASS_LABEL[row.anomaly_class] || "Provisional, not compared yet"), (isMissing(row.rank_in_month) ? "not ranked yet" : row.rank_in_month + " of " + row.n_years_ranked)];
    }));
  });
}

function renderSensors(mine, current) {
  if (!current) return;
  var year = current.year;
  document.getElementById("sensors-title").innerHTML = term("harmonization", year + " by sensor");
  var pick = function (field) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var r = find(mine, year, m);
      out.push(r ? r[field] : null);
    }
    return out;
  };
  var band = [];
  var median = [];
  for (var m = 1; m <= 12; m++) {
    var r = find(mine, year, m) || mine.filter(function (x) { return x.month === m; }).slice(-1)[0];
    band.push(r ? { lo: r.baseline_p25, hi: r.baseline_p75 } : null);
    median.push(r ? r.baseline_median : null);
  }
  var series = [
    { key: "harmonized", name: "Harmonized", values: pick("harmonized_cell_days"), color: "--s-harm", width: 2.5, hidden: hidden.harmonized },
    { key: "modis", name: "MODIS", values: pick("modis_cell_days"), color: "--s-modis", hidden: hidden.modis },
    { key: "viirs", name: "VIIRS", values: pick("viirs_cell_days"), color: "--s-viirs", dashed: true, hidden: hidden.viirs },
  ];
  lineBandChart(document.getElementById("sensors-chart"), {
    labels: MONTHS_SHORT,
    titles: MONTHS.map(function (name) { return name + " " + year; }),
    band: band,
    median: median,
    series: series,
    selectedIndex: current.month - 1,
    height: 230,
    ariaLabel: "Detections by sensor in " + year,
    onPick: function (i) {
      if (find(mine, year, i + 1)) select(year, i + 1, false);
    },
  });
  legend(document.getElementById("sensors-legend"), series.map(function (s) {
    return {
      kind: s.dashed ? "dash" : "line",
      label: s.name,
      color: cssVar(s.color),
      hidden: s.hidden,
      onToggle: function (on) {
        hidden[s.key] = !on;
        renderSensors(regionRows(), selectedRow(regionRows()));
      },
    };
  }).concat([{ kind: "band", label: "Normal range" }, { kind: "dash", label: "Usual", color: cssVar("--median") }]));
  resetTable("sensors-table-btn", "sensors-chart", "sensors-table", function () {
    return buildTable(["Month", "Harmonized", "MODIS", "VIIRS", "Usual"], MONTHS.map(function (name, i) {
      return [name, formatNumber(series[0].values[i]), formatNumber(series[1].values[i]), formatNumber(series[2].values[i]), formatNumber(median[i])];
    }));
  });
}

function resetTable(buttonId, chartId, tableId, make) {
  var button = document.getElementById(buttonId);
  var fresh = button.cloneNode(false);
  button.replaceWith(fresh);
  document.getElementById(chartId).hidden = false;
  document.getElementById(tableId).hidden = true;
  tableToggle(fresh, document.getElementById(chartId), document.getElementById(tableId), make);
}

// ---------- CSV ----------

function exportCsv() {
  var header = ["region", "year", "month", "harmonized_cell_days", "modis_cell_days", "viirs_cell_days", "source", "anomaly_class", "anomaly_ratio", "baseline_median", "baseline_p25", "baseline_p75", "rank_in_month", "n_years_ranked", "is_provisional", "is_complete"];
  downloadCsv(currentRegion() + "_cell_days.csv", header, regionRows().map(function (row) {
    return [row.region_id, row.year, row.month, row.harmonized_cell_days, row.modis_cell_days, row.viirs_cell_days, row.source, row.anomaly_class, row.anomaly_ratio, row.baseline_median, row.baseline_p25, row.baseline_p75, row.rank_in_month, row.n_years_ranked, row.is_provisional, row.is_complete];
  }));
}
