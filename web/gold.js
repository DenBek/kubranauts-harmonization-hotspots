var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var REGIONS = [
  { id: "argentina_chaco", name: "Argentine Chaco", stratum: "chaco" },
  { id: "brazil_cerrado", name: "Brazilian Cerrado", stratum: "cerrado" },
];
var CLASS_COLOR = {
  much_below: "#5c6b7a",
  below: "#8aa0b2",
  normal: "#f3e6c8",
  above: "#e8a04a",
  much_above: "#8f2d12",
};
var CLASS_LABEL = {
  much_below: "Much below",
  below: "Below",
  normal: "Normal",
  above: "Above",
  much_above: "Much above",
};

function regionById(id) {
  return REGIONS.filter(function (region) { return region.id === id; })[0];
}

function regionName(id) {
  var region = regionById(id);
  return region ? region.name : id;
}

function fetchGold(table) {
  return fetch("/api/gold/" + table).then(function (response) {
    if (!response.ok) throw new Error(table);
    return response.json();
  });
}

function showBanner(banner, data) {
  if (!banner || !data) return;
  banner.dataset.source = data.source || "sample";
  banner.textContent = data.note || "";
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "none";
  return Math.round(Number(value)).toLocaleString("en-US");
}

function textOn(color) {
  return color === "#8f2d12" || color === "#5c6b7a" ? "#fff8f0" : "#1c1612";
}

function fillRegionSelect(select, selected) {
  select.innerHTML = "";
  REGIONS.forEach(function (region) {
    var option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.name;
    select.appendChild(option);
  });
  if (selected) select.value = selected;
}

function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

var SOURCE_HELP = {
  modis_calibrated: "MODIS, scaled onto the VIIRS scale with this month's calibration ratio. This is how the years before VIIRS can sit on the same chart.",
  viirs_archive: "Science-quality VIIRS. Once this record exists, it is the one the calendar uses, and the calibration ratio is not applied.",
  viirs_nrt: "Near-real-time VIIRS. The month is still being revised, so the comparison can move when the science-quality product arrives.",
};

function sourceHelp(source) {
  return SOURCE_HELP[source] || "Which sensor produced this month after harmonization.";
}

function term(id, label) {
  return "<a href=\"glossary.html#" + id + "\">" + label + "</a>";
}

function metricItem(title, value, help) {
  return "<div><dt>" + title + "</dt><dd class='metric-value'>" + value + "</dd><dd class='metric-help'>" + help + "</dd></div>";
}
