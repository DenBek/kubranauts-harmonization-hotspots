var banner = document.getElementById("data-banner");
var regionSelect = document.getElementById("region");
var yearSelect = document.getElementById("year");
var monthSelect = document.getElementById("month");
var monthly = [];
var headlines = [];
var source = "sample";

fillRegionSelect(regionSelect, queryParam("region") || REGIONS[0].id);

Promise.all([fetchGold("gold_region_monthly"), fetchGold("gold_region_headline")])
  .then(function (results) {
    monthly = results[0].rows || [];
    headlines = results[1].rows || [];
    source = results[0].source || "sample";
    showBanner(banner, results[0]);
    fillYears();
    if (queryParam("year")) yearSelect.value = queryParam("year");
    fillMonths();
    if (queryParam("month")) monthSelect.value = queryParam("month");
    regionSelect.addEventListener("change", function () {
      fillYears();
      preview();
    });
    yearSelect.addEventListener("change", function () {
      fillMonths();
      preview();
    });
    monthSelect.addEventListener("change", preview);
    document.getElementById("briefing-form").addEventListener("submit", function (event) {
      event.preventDefault();
      preview();
    });
    preview();
  })
  .catch(function () {
    banner.textContent = "The data API is not running. From the repo root, run npx wrangler pages dev web and open http://localhost:8788.";
  });

function fillYears() {
  var years = [];
  monthly.forEach(function (row) {
    if (row.region_id === regionSelect.value && years.indexOf(row.year) === -1) years.push(row.year);
  });
  years.sort(function (a, b) { return a - b; });
  var previous = yearSelect.value;
  yearSelect.innerHTML = "";
  years.forEach(function (year) {
    var option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  });
  if (previous && years.indexOf(Number(previous)) !== -1) yearSelect.value = previous;
}

function fillMonths() {
  var year = Number(yearSelect.value);
  var months = monthly.filter(function (row) {
    return row.region_id === regionSelect.value && row.year === year;
  }).map(function (row) { return row.month; });
  months.sort(function (a, b) { return a - b; });
  var previous = monthSelect.value;
  monthSelect.innerHTML = "";
  months.forEach(function (month) {
    var option = document.createElement("option");
    option.value = String(month);
    option.textContent = MONTHS[month - 1];
    monthSelect.appendChild(option);
  });
  if (previous && months.indexOf(Number(previous)) !== -1) monthSelect.value = previous;
}

function preview() {
  var year = Number(yearSelect.value);
  var month = Number(monthSelect.value);
  var row = monthly.filter(function (item) {
    return item.region_id === regionSelect.value && item.year === year && item.month === month;
  })[0];
  var headline = headlines.filter(function (item) { return item.region_id === regionSelect.value; })[0];
  var useHeadline = headline && Number(headline.as_of_month.slice(0, 4)) === year && Number(headline.as_of_month.slice(5, 7)) === month;
  var body = {
    region: regionName(regionSelect.value),
    year: year,
    month: month,
    count: row ? row.harmonized_cell_days : null,
    ratio: row ? row.anomaly_ratio : null,
    rank: row ? row.rank_in_month : null,
    n: row ? row.n_years_ranked : null,
    headline: useHeadline ? headline.headline : "",
    source: source,
  };
  fetch("/api/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(function (response) { return response.json(); })
    .then(function (result) {
      document.getElementById("sms").textContent = result.sms;
      document.getElementById("twilio-status").textContent = result.twilio || "";
    })
    .catch(function () {
      document.getElementById("sms").textContent = "The preview API did not respond.";
    });
}
