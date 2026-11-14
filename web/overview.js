var banner = document.getElementById("data-banner");
var select = document.getElementById("region");
var headlines = [];

fillRegionSelect(select, queryParam("region") || REGIONS[0].id);

fetchGold("gold_region_headline")
  .then(function (data) {
    headlines = data.rows || [];
    showBanner(banner, data);
    select.addEventListener("change", render);
    render();
  })
  .catch(function () {
    banner.textContent = "The data API is not running. From the repo root, run npx wrangler pages dev web and open http://localhost:8788.";
  });

function render() {
  var row = headlines.filter(function (item) { return item.region_id === select.value; })[0];
  var title = document.getElementById("headline-text");
  var alt = document.getElementById("headline-alt");
  var stats = document.getElementById("headline-stats");
  if (!row) {
    title.textContent = "No headline for this region yet.";
    alt.textContent = "";
    stats.innerHTML = "";
    return;
  }
  title.textContent = row.headline;
  alt.textContent = row.alt_text || "";
  stats.innerHTML = "";
  [
    ["This month vs usual", row.month_anomaly_ratio + "×", "This month's cell-days divided by the usual value for that month. Above 1 means a busier month than the historical middle. This is the comparison an emergency manager uses to see whether the current season is out of line.", "anomaly-ratio"],
    ["Rank in that month", row.month_rank_in_month, "1 is the busiest year on record for that calendar month. The sample has fewer years than the full MODIS record, so a live rank will be out of a longer list.", "rank"],
    ["Year to date", formatNumber(row.ytd_cell_days) + " cell-days", "Harmonized cell-days from January through the latest month. One hot month can sit inside an otherwise ordinary year, so the running total is the check.", "year-to-date"],
    ["Year to date vs usual", row.ytd_vs_median + "×", "The running total divided by the usual total for those same months in past years. This says whether the season so far, not just one month, is high.", "year-to-date"],
    ["Closest earlier year", row.top_analog_year, "The past year whose month-by-month pattern, up to now, looks most like this one. It is a resemblance, not a forecast of how the rest of the season will go.", "analog"],
  ].forEach(function (item) {
    var card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = "<span>" + term(item[3], item[0]) + "</span><strong>" + item[1] + "</strong><p>" + item[2] + "</p>";
    stats.appendChild(card);
  });
  var query = "?region=" + encodeURIComponent(select.value);
  document.getElementById("link-map").href = "map.html" + query;
  document.getElementById("link-calendar").href = "calendar.html" + query;
  document.getElementById("link-year").href = "year.html" + query;
  document.getElementById("link-briefing").href = "briefing.html" + query;
}
