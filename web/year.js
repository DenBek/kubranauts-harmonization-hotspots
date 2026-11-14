var banner = document.getElementById("data-banner");
var regionSelect = document.getElementById("region");
var yearSelect = document.getElementById("year");
var annual = [];
var analogs = [];
var calibration = [];
var notes = [];

fillRegionSelect(regionSelect, queryParam("region") || REGIONS[0].id);

Promise.all([
  fetchGold("gold_region_annual"),
  fetchGold("gold_region_analogs"),
  fetchGold("gold_calibration"),
]).then(function (results) {
  annual = results[0].rows || [];
  analogs = results[1].rows || [];
  calibration = results[2].rows || [];
  notes = results.map(function (data) { return (data.source || "sample") + ": " + (data.note || ""); });
  banner.dataset.source = results.some(function (data) { return data.source !== "r2"; }) ? "sample" : "r2";
  banner.textContent = notes[0];
  regionSelect.addEventListener("change", function () {
    fillYears();
    render();
  });
  yearSelect.addEventListener("change", render);
  fillYears();
  if (queryParam("year")) yearSelect.value = queryParam("year");
  render();
}).catch(function () {
  banner.textContent = "The data API is not running. From the repo root, run npx wrangler pages dev web and open http://localhost:8788.";
});

function fillYears() {
  var years = annual.filter(function (row) { return row.region_id === regionSelect.value; }).map(function (row) { return row.year; });
  years.sort(function (a, b) { return a - b; });
  var previous = yearSelect.value || "2025";
  yearSelect.innerHTML = "";
  years.forEach(function (year) {
    var option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  });
  if (years.indexOf(Number(previous)) !== -1) yearSelect.value = previous;
}

function render() {
  var mine = annual.filter(function (row) { return row.region_id === regionSelect.value; });
  var year = Number(yearSelect.value);
  var current = mine.filter(function (row) { return row.year === year; })[0];
  drawBars(mine, year);
  var note = document.getElementById("year-note");
  if (!current) {
    note.textContent = "";
  } else {
    note.innerHTML = "<dl class='metric'>" +
      metricItem(term("harmonized-cell-days", "Harmonized cell-days"), formatNumber(current.harmonized_cell_days), "The year's total on the common scale. Use this, not a raw hotspot total, when asking which years burned more.") +
      metricItem(term("rank", "Rank"), current.rank + " of " + current.n_years_ranked, "1 is the most active year in the file. An incomplete year can rank low simply because months are still missing.") +
      metricItem(term("anomaly-ratio", "Compared with a usual year"), current.anomaly_ratio + "×", "This year divided by the median year. Near 1, the year as a whole looks ordinary even if one month inside it was extreme.") +
      metricItem(term("peak-month", "Peak month"), MONTHS[current.peak_month - 1] + ", " + formatNumber(current.peak_month_cell_days) + " cell-days", "The month that contributed the most. The burning calendar is about when the season peaks, not only whether the year was high.") +
      (current.is_complete ? "" : metricItem(term("month-still-open", "Months on file"), String(current.months_available), "This year does not have all 12 months, so its total is not yet comparable with a finished year. The year 2000 in the sample is short for the same reason.")) +
      "</dl>";
  }
  drawSeason(current);
  drawAnalogs();
  drawCalibration();
}

function drawBars(mine, year) {
  var canvas = document.getElementById("years");
  var ctx = canvas.getContext("2d");
  var ratio = window.devicePixelRatio || 1;
  var width = canvas.clientWidth || 900;
  var height = 220;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  var max = Math.max.apply(null, mine.map(function (row) { return row.harmonized_cell_days; }).concat([1]));
  var pad = 28;
  var gap = 8;
  var barWidth = (width - pad * 2 - gap * (mine.length - 1)) / mine.length;
  mine.forEach(function (row, index) {
    var barHeight = ((height - pad * 2) * row.harmonized_cell_days) / max;
    var x = pad + index * (barWidth + gap);
    var y = height - pad - barHeight;
    ctx.fillStyle = row.year === year ? "#b84314" : "#e0c39a";
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#1c1612";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(row.year), x + barWidth / 2, height - 8);
  });
}

function drawSeason(current) {
  var track = document.getElementById("season");
  var note = document.getElementById("season-note");
  track.innerHTML = "";
  if (!current) {
    note.textContent = "";
    return;
  }
  note.innerHTML = "The highlighted months run from " + MONTHS[current.season_start_month - 1] +
    " to " + MONTHS[current.season_end_month - 1] + " (" + current.season_length_months +
    " months). Start is when 10% of the year's cell-days had arrived, the midpoint is 50%, and the end is 90%. The dark month is the peak. A season that starts early or runs long is a different kind of change than one hot month.";
  for (var month = 1; month <= 12; month++) {
    var cell = document.createElement("span");
    var inside = month >= current.season_start_month && month <= current.season_end_month;
    cell.className = month === current.peak_month ? "peak" : inside ? "in" : "";
    cell.textContent = MONTHS[month - 1].slice(0, 3);
    track.appendChild(cell);
  }
}

function drawAnalogs() {
  var host = document.getElementById("analogs");
  var note = document.getElementById("analog-note");
  host.innerHTML = "";
  var mine = analogs.filter(function (row) { return row.region_id === regionSelect.value; });
  mine.sort(function (a, b) { return a.rank - b.rank; });
  if (!mine.length) {
    note.textContent = "No analog years in this file.";
    return;
  }
  note.innerHTML = "These are the past years whose pattern from January through " + MONTHS[mine[0].through_month - 1] +
    " " + mine[0].target_year + " looks most like this year. " + term("similarity", "Similarity") + " is a 0 to 100 reading of that match. It shows how similar seasons played out. It does not predict this year.";
  mine.forEach(function (row) {
    var card = document.createElement("article");
    card.className = "analog";
    card.innerHTML = "<h3>" + row.rank + ". " + row.analog_year + " · " + row.similarity_pct + "% similar</h3>" +
      "<dl class='metric'>" +
      metricItem(term("rest-of-year", "What happened next"), formatNumber(row.analog_rest_of_year_cell_days) + " cell-days",
        "After " + MONTHS[row.through_month - 1] + ", " + row.analog_year + " recorded this many more cell-days. " +
        row.analog_rest_vs_median + "× the usual rest of the year. A number above 1 means that similar year finished busy.") +
      "</dl>";
    host.appendChild(card);
  });
}

function drawCalibration() {
  var host = document.getElementById("ratios");
  var note = document.getElementById("cal-note");
  var region = regionById(regionSelect.value);
  var mine = calibration.filter(function (row) { return row.stratum_id === region.stratum; });
  mine.sort(function (a, b) { return a.month - b.month; });
  host.innerHTML = "";
  if (!mine.length) {
    note.textContent = "No calibration rows for this stratum.";
    return;
  }
  var first = mine[0];
  note.innerHTML = "Each bar is the " + term("calibration-ratio", "calibration ratio") + " for " + term("stratum", "stratum") + " " + first.stratum_id +
    ": VIIRS cell-days divided by MODIS cell-days in that calendar month. It is the factor used when a month has to be filled from MODIS. " +
    term("holdout-error", "Holdout error") + " " + first.holdout_mape + "% is how far that factor was off on years it was not fit to. Smaller is a more trustworthy adjustment. "
    "Fit on " + first.n_months + " overlap months, " + first.fit_start + " to " + first.fit_end +
    ", using " + first.viirs_sensor + " (" + first.method_version + "). The ratio changes by month because the two sensors do not disagree by the same amount all year.";
  var max = Math.max.apply(null, mine.map(function (row) { return row.ratio; }));
  mine.forEach(function (row) {
    var line = document.createElement("div");
    line.className = "ratio";
    line.innerHTML = "<span>" + MONTHS[row.month - 1].slice(0, 3) + "</span><i style='width:" +
      (100 * row.ratio / max) + "%'></i><span>" + row.ratio + "</span>";
    host.appendChild(line);
  });
}
