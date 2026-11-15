// Shared helpers for every page: regions, the gold-table API, formatting,
// colors, icons, and the region the visitor is looking at.
//
// The pages call /api/gold/<table> (functions/api/gold/[table].js). That route
// returns the published JSON from R2, or the sample in web/sample/ until the
// export has run. Each response carries `source` ("r2" or "sample").

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var MONTHS_SHORT = MONTHS.map(function (name) { return name.slice(0, 3); });

var REGIONS = [
  { id: "argentina", name: "Argentina (whole country)", stratum: "argentina", country: "Argentina" },
  { id: "ar_ne", name: "North-east (Corrientes, Misiones, Entre Ríos)", stratum: "argentina", country: "Argentina" },
  { id: "ar_nw", name: "North-west and western Chaco (Salta, Tucumán, Santiago del Estero)", stratum: "argentina", country: "Argentina" },
  { id: "ar_c", name: "Centre (Córdoba, Pampas, La Pampa)", stratum: "argentina", country: "Argentina" },
  { id: "ar_s", name: "Patagonia (south of 39°S)", stratum: "argentina", country: "Argentina" },
  { id: "ar_delta", name: "Paraná Delta (box)", stratum: "argentina", country: "Argentina" },
];

// ---------- anomaly classes ----------

var CLASS_ORDER = ["much_below", "below", "normal", "above", "much_above"];
var CLASS_LABEL = {
  much_below: "Much below",
  below: "Below",
  normal: "Normal",
  above: "Above",
  much_above: "Much above",
};
var CLASS_VAR = {
  much_below: "--c-much-below",
  below: "--c-below",
  normal: "--c-normal",
  above: "--c-above",
  much_above: "--c-much-above",
};
var CLASS_ICON = {
  much_below: "chevronsDown",
  below: "arrowDown",
  normal: "minus",
  above: "arrowUp",
  much_above: "chevronsUp",
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function classColor(name) {
  return cssVar(CLASS_VAR[name] || "--c-normal");
}

// Kept for older code: CLASS_COLOR.above still works and follows the theme.
var CLASS_COLOR = {};
CLASS_ORDER.forEach(function (name) {
  Object.defineProperty(CLASS_COLOR, name, {
    enumerable: true,
    get: function () { return classColor(name); },
  });
});

// ---------- regions ----------

var REGION_KEY = "fire-calendar-region";

function regionById(id) {
  return REGIONS.filter(function (region) { return region.id === id; })[0];
}

function regionName(id) {
  var region = regionById(id);
  return region ? region.name : id;
}

function currentRegion() {
  var fromUrl = queryParam("region");
  if (fromUrl && regionById(fromUrl)) return fromUrl;
  try {
    var saved = localStorage.getItem(REGION_KEY);
    if (saved && regionById(saved)) return saved;
  } catch (err) { /* storage can be blocked; fall through */ }
  return REGIONS[0].id;
}

// Every page listens for "regionchange" instead of owning its own select.
function setRegion(id) {
  if (!regionById(id)) return;
  setParams({ region: id });
  try { localStorage.setItem(REGION_KEY, id); } catch (err) { /* ignore */ }
  document.dispatchEvent(new CustomEvent("regionchange", { detail: { region: id } }));
}

function onRegionChange(handler) {
  document.addEventListener("regionchange", function (event) { handler(event.detail.region); });
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

// ---------- URL state ----------

function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function setParams(values) {
  var params = new URLSearchParams(location.search);
  Object.keys(values).forEach(function (key) {
    var value = values[key];
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  });
  var query = params.toString();
  history.replaceState(null, "", location.pathname + (query ? "?" + query : "") + location.hash);
  document.dispatchEvent(new CustomEvent("paramschange"));
}

// ---------- data ----------

var DATA_SOURCES = {};

function fetchGold(table) {
  return fetch("/api/gold/" + table).then(function (response) {
    if (!response.ok) throw new Error(table);
    return response.json();
  }).then(function (data) {
    DATA_SOURCES[table] = { source: data.source || "sample", note: data.note || "" };
    updateSourcePill();
    return data;
  });
}

function updateSourcePill() {
  var pill = document.getElementById("source-pill");
  if (!pill) return;
  var tables = Object.keys(DATA_SOURCES);
  if (!tables.length) return;
  var live = tables.filter(function (table) { return DATA_SOURCES[table].source === "r2"; });
  var state = live.length === tables.length ? "r2" : "sample";
  pill.dataset.source = state;
  pill.querySelector(".pill-text").textContent = state === "r2" ? "Live data" : (live.length ? "Partly sample" : "Sample data");
  pill.title = tables.map(function (table) {
    return table + ": " + (DATA_SOURCES[table].source === "r2" ? "live (R2)" : "sample");
  }).join("\n");
}

function showBanner(banner, data) {
  if (!banner || !data) return;
  banner.dataset.source = data.source || "sample";
  banner.innerHTML = icon("info", 16);
  var text = document.createElement("span");
  text.textContent = data.note || (data.source === "r2" ? "Live gold tables from the firms-data bucket." : "");
  banner.appendChild(text);
}

function showOffline(banner) {
  var pill = document.getElementById("source-pill");
  if (pill) {
    pill.dataset.source = "offline";
    pill.querySelector(".pill-text").textContent = "No data";
  }
  if (!banner) return;
  banner.dataset.source = "offline";
  banner.innerHTML = icon("info", 16);
  var text = document.createElement("span");
  text.innerHTML = "The data API is not running. From the repo root, run <code>npx wrangler pages dev web</code> and open <code>http://localhost:8788</code>.";
  banner.appendChild(text);
}

// ---------- formatting ----------

function isMissing(value) {
  return value === null || value === undefined || value === "" || (typeof value === "number" && isNaN(value));
}

function formatNumber(value) {
  if (isMissing(value)) return "not included";
  return Math.round(Number(value)).toLocaleString("en-US");
}

function formatCompact(value) {
  if (isMissing(value)) return "–";
  var n = Number(value);
  var abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

function formatRatio(value) {
  if (isMissing(value)) return "–";
  if (Number(value) > 10) return "more than 10×";   // the exact ratio stays in the CSV downloads
  return (Math.round(Number(value) * 100) / 100).toFixed(2) + "×";
}

function monthLabel(year, month) {
  return MONTHS[month - 1] + " " + year;
}

// ---------- color helpers ----------

function parseColor(color) {
  var c = String(color).trim();
  if (c.charAt(0) === "#") {
    if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  var m = c.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(",").slice(0, 3).map(function (v) { return parseFloat(v); });
  return [128, 128, 128];
}

function luminance(color) {
  var rgb = parseColor(color).map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(a, b) {
  var la = luminance(a);
  var lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Dark or light ink, whichever reads better on the fill.
function textOn(fill) {
  return contrastRatio(fill, "#111317") >= contrastRatio(fill, "#ffffff") ? "#111317" : "#ffffff";
}

function rampColor(t) {
  var steps = ["--r1", "--r2", "--r3", "--r4", "--r5"];
  var index = Math.max(0, Math.min(steps.length - 1, Math.round(t * (steps.length - 1))));
  return cssVar(steps[index]);
}

// ---------- glossary links and metric blocks ----------

var SOURCE_HELP = {
  modis_calibrated: "MODIS, scaled onto the VIIRS scale with this month's calibration ratio. This is how the years before VIIRS can sit on the same chart.",
  viirs_archive: "Science-quality VIIRS. Once this record exists, it is the one the calendar uses, and the calibration ratio is not applied.",
  viirs_nrt: "Near-real-time VIIRS. The month is still being revised, so the comparison can move when the science-quality product arrives.",
};
var SOURCE_LABEL = {
  modis_calibrated: "MODIS, calibrated",
  viirs_archive: "VIIRS, science quality",
  viirs_nrt: "VIIRS, near real time",
};

function sourceHelp(source) {
  return SOURCE_HELP[source] || "Which sensor produced this month after harmonization.";
}

function sourceLabel(source) {
  return SOURCE_LABEL[source] || source || "Unknown";
}

function term(id, label) {
  return "<a href=\"glossary.html#" + id + "\">" + label + "</a>";
}

function metricItem(title, value, help) {
  return "<div><dt>" + title + "</dt><dd class='metric-value'>" + value + "</dd>" + (help ? "<dd class='metric-help'>" + help + "</dd>" : "") + "</div>";
}

// ---------- small DOM helpers ----------

function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    });
  }
  (children || []).forEach(function (child) {
    if (child === null || child === undefined) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

function statusChip(className) {
  var fill = classColor(className);
  var chip = el("span", { class: "status-chip", style: "background:" + fill + ";color:" + textOn(fill) });
  chip.innerHTML = icon(CLASS_ICON[className] || "minus", 14);
  chip.appendChild(document.createTextNode(className === "normal" ? "Normal" : (CLASS_LABEL[className] ? CLASS_LABEL[className] + " usual" : "Provisional, not compared yet")));
  return chip;
}

function segmented(host, options, value, onChange) {
  host.innerHTML = "";
  host.classList.add("segmented");
  options.forEach(function (option) {
    var button = el("button", { type: "button", "aria-pressed": String(option.value === value), text: option.label });
    button.addEventListener("click", function () {
      host.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      button.setAttribute("aria-pressed", "true");
      onChange(option.value);
    });
    host.appendChild(button);
  });
}

function csvCell(value) {
  if (isMissing(value)) return "";
  var text = String(value);
  return /[",\n]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}

function downloadCsv(filename, header, rows) {
  var lines = [header.map(csvCell).join(",")];
  rows.forEach(function (row) { lines.push(row.map(csvCell).join(",")); });
  var blob = new Blob([lines.join("\n")], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------- icons (inline SVG, stroke follows currentColor) ----------

var ICON_PATHS = {
  flame: "<path d='M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 8 11.5c0-1.4.6-2.4 1.4-3.2.2 1.6 1 2.4 1.8 2.6C11 8 10.8 5.6 12 3Z'/><path d='M9.5 14.5a2.5 2.5 0 0 0 5 0c0-1.6-1.2-2.4-2.5-3.5-1.3 1.1-2.5 1.9-2.5 3.5Z'/>",
  sun: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
  moon: "<path d='M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z'/>",
  menu: "<path d='M4 7h16M4 12h16M4 17h16'/>",
  play: "<path d='M7 4.5v15l12-7.5-12-7.5Z' fill='currentColor' stroke='none'/>",
  pause: "<path d='M7 4h3.5v16H7zM13.5 4H17v16h-3.5z' fill='currentColor' stroke='none'/>",
  prev: "<path d='m15 18-6-6 6-6'/>",
  next: "<path d='m9 18 6-6-6-6'/>",
  download: "<path d='M12 4v11M7 10.5l5 5 5-5M5 20h14'/>",
  area: "<path d='M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3'/>",
  close: "<path d='M6 6l12 12M18 6 6 18'/>",
  info: "<circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8h.01'/>",
  arrowUp: "<path d='M12 19V5M6 11l6-6 6 6'/>",
  arrowDown: "<path d='M12 5v14M6 13l6 6 6-6'/>",
  chevronsUp: "<path d='m7 11 5-5 5 5M7 17l5-5 5 5'/>",
  chevronsDown: "<path d='m7 7 5 5 5-5M7 13l5 5 5-5'/>",
  minus: "<path d='M6 12h12'/>",
  map: "<path d='M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z'/><path d='M9 4v14M15 6v14'/>",
  calendar: "<rect x='3' y='5' width='18' height='16' rx='2'/><path d='M3 10h18M8 3v4M16 3v4'/>",
  copy: "<rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15V6a2 2 0 0 1 2-2h8'/>",
  send: "<path d='M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z'/>",
  table: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 10h18M3 15h18M10 4v16'/>",
  chart: "<path d='M4 20V10M10 20V4M16 20v-7M22 20H2'/>",
  target: "<circle cx='12' cy='12' r='8'/><circle cx='12' cy='12' r='3'/>",
  check: "<path d='m5 12 5 5 9-10'/>",
};

function icon(name, size) {
  var s = size || 18;
  return "<svg width='" + s + "' height='" + s + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'>" + (ICON_PATHS[name] || "") + "</svg>";
}
