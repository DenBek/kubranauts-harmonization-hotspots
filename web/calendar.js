var banner = document.getElementById("data-banner");
var regionSelect = document.getElementById("region");
var metricSelect = document.getElementById("metric");
var rows = [];
var selected = null;

fillRegionSelect(regionSelect, queryParam("region") || REGIONS[0].id);
paintLegend();

fetchGold("gold_region_monthly")
  .then(function (data) {
    rows = data.rows || [];
    showBanner(banner, data);
    regionSelect.addEventListener("change", function () {
      selected = null;
      render();
    });
    metricSelect.addEventListener("change", render);
    document.getElementById("csv").addEventListener("click", downloadCsv);
    render();
  })
  .catch(function () {
    banner.textContent = "The data API is not running. From the repo root, run npx wrangler pages dev web and open http://localhost:8788.";
  });

function regionRows() {
  return rows.filter(function (row) { return row.region_id === regionSelect.value; });
}

function metricValue(row) {
  if (metricSelect.value === "modis") return row.modis_cell_days;
  if (metricSelect.value === "viirs") return row.viirs_cell_days;
  return row.harmonized_cell_days;
}

function render() {
  var mine = regionRows();
  if (!selected) {
    selected = mine.filter(function (row) { return row.year === 2025; }).slice(-1)[0] || mine[mine.length - 1];
  }
  var body = document.querySelector("#calendar tbody");
  body.innerHTML = "";
  var years = [];
  mine.forEach(function (row) {
    if (years.indexOf(row.year) === -1) years.push(row.year);
  });
  years.sort(function (a, b) { return a - b; });
  years.forEach(function (year) {
    var tr = document.createElement("tr");
    var label = document.createElement("th");
    label.className = "year";
    label.textContent = String(year);
    label.scope = "row";
    tr.appendChild(label);
    for (var month = 1; month <= 12; month++) {
      var point = mine.filter(function (row) { return row.year === year && row.month === month; })[0];
      var td = document.createElement("td");
      if (point) {
        var color = CLASS_COLOR[point.anomaly_class] || "#f3e6c8";
        var button = document.createElement("button");
        button.type = "button";
        button.className = "cell";
        button.style.background = color;
        button.style.color = textOn(color);
        var value = metricValue(point);
        button.textContent = value === null || value === undefined ? "·" : formatNumber(value);
        var pressed = selected && selected.year === point.year && selected.month === point.month;
        button.setAttribute("aria-pressed", String(!!pressed));
        button.setAttribute("aria-label", regionName(point.region_id) + " " + MONTHS[month - 1] + " " + year + ", " + (CLASS_LABEL[point.anomaly_class] || "") + ", " + formatNumber(point.harmonized_cell_days) + " cell-days");
        button.addEventListener("click", function (chosen) {
          return function () {
            selected = chosen;
            render();
          };
        }(point));
        td.appendChild(button);
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });
  renderDetail();
}

function renderDetail() {
  var panel = document.getElementById("detail");
  if (!selected) {
    panel.innerHTML = "<h2>Select a month</h2>";
    return;
  }
  var row = selected;
  var badges = "";
  if (row.is_provisional) badges += "<a class='badge' href='glossary.html#provisional'>Provisional</a>";
  if (!row.is_complete) badges += "<a class='badge' href='glossary.html#month-still-open'>Month still open</a>";
  var shown = metricValue(row);
  var monthName = MONTHS[row.month - 1];
  var shownLabel = metricSelect.value === "modis" ? "MODIS cell-days" : metricSelect.value === "viirs" ? "VIIRS cell-days" : "Harmonized cell-days";
  var shownHelp = metricSelect.value === "modis"
    ? "Activity counted from MODIS only. The long record, but a coarser and less sensitive sensor than VIIRS, so this number is not the one to compare across the whole time series."
    : metricSelect.value === "viirs"
      ? "Activity counted from VIIRS only. Empty before April 2018, because that sensor was not observing yet. It usually runs higher than MODIS for the same fires, which is why a calibration ratio exists."
      : "The comparable figure. A cell-day is one grid cell detected as active on one day, after MODIS and VIIRS are on the same scale. This is the number the calendar uses for history.";
  var ratioText = row.anomaly_ratio === null ? "No ratio, because the usual month is 0." : row.anomaly_ratio + "×";
  panel.innerHTML =
    "<h2>" + regionName(row.region_id) + " · " + monthName + " " + row.year + "</h2>" +
    badges +
    (row.is_complete ? "" : "<p class='muted'>This month does not have every day yet, so the total is unfinished and should not be lined up with a completed month.</p>") +
    "<dl class='metric'>" +
    metricItem(term(metricSelect.value === "modis" ? "modis" : metricSelect.value === "viirs" ? "viirs" : "harmonized-cell-days", shownLabel), shown === null || shown === undefined ? "No value" : formatNumber(shown), shownHelp) +
    metricItem(term("usual-month", "Usual " + monthName), formatNumber(row.baseline_median), "The median of this calendar month across the years on file. Half of past years were busier, half quieter. Comparing against this, rather than against last year alone, is how a manager sees whether the season is unusual.") +
    metricItem(term("normal-range", "Normal range"), formatNumber(row.baseline_p25) + " to " + formatNumber(row.baseline_p75), "The middle half of past years for this month. Inside the band the month looks ordinary. Outside it, the month is quiet or busy relative to its own history.") +
    metricItem(term("anomaly-ratio", "Compared with usual"), ratioText, "This month divided by the usual month. The " + term("anomaly-diff", "difference") + " is how many cell-days that is: " + formatNumber(row.anomaly_diff) + ".") +
    metricItem(term("anomaly-class", "Class"), CLASS_LABEL[row.anomaly_class] || "Unknown", "A fixed bin of that comparison. Much below, below, normal, above, much above. The color uses this bin so a region with huge fires and a region with small fires can share a legend.") +
    metricItem(term("rank", "Rank"), row.rank_in_month + " of " + row.n_years_ranked, "1 is the busiest year for this month. " + term("percentile-rank", "Percentile") + " " + row.percentile_rank + " places it on a 0 to 100 scale among those years. The sample list is shorter than the full record back to the early 2000s.") +
    metricItem(term("source", "Source"), row.source, sourceHelp(row.source)) +
    "</dl>" +
    "<p><a href='map.html?region=" + encodeURIComponent(row.region_id) + "&year=" + row.year + "&month=" + row.month + "'>Show these cells on the map</a>" +
    " · <a href='briefing.html?region=" + encodeURIComponent(row.region_id) + "&year=" + row.year + "&month=" + row.month + "'>Preview the text briefing</a></p>";
}

function paintLegend() {
  var legend = document.getElementById("legend");
  ["much_below", "below", "normal", "above", "much_above"].forEach(function (name) {
    var swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = CLASS_COLOR[name];
    legend.appendChild(swatch);
    var label = document.createElement("a");
    label.href = "glossary.html#anomaly-class";
    label.textContent = CLASS_LABEL[name];
    legend.appendChild(label);
    legend.appendChild(document.createTextNode(" "));
  });
}

function downloadCsv() {
  var lines = ["region,year,month,harmonized_cell_days,modis_cell_days,viirs_cell_days,anomaly_class,anomaly_ratio,baseline_median,rank_in_month,n_years_ranked"];
  regionRows().forEach(function (row) {
    lines.push([
      row.region_id, row.year, row.month, row.harmonized_cell_days,
      row.modis_cell_days, row.viirs_cell_days === null ? "" : row.viirs_cell_days,
      row.anomaly_class, row.anomaly_ratio, row.baseline_median, row.rank_in_month, row.n_years_ranked,
    ].join(","));
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = regionSelect.value + "_cell_days.csv";
  link.click();
  URL.revokeObjectURL(url);
}
