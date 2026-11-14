// Overview: headline, five indicators, the season against the usual year,
// the last 12 months, and both regions side by side.

var banner = document.getElementById("data-banner");
var store = { headlines: [], monthly: [], analogs: [] };
var compareYear = null;

Promise.all([
  fetchGold("gold_region_headline"),
  fetchGold("gold_region_monthly"),
  fetchGold("gold_region_analogs"),
]).then(function (results) {
  store.headlines = results[0].rows || [];
  store.monthly = results[1].rows || [];
  store.analogs = results[2].rows || [];
  showBanner(banner, results[0]);
  render();
  onRegionChange(function () {
    compareYear = null;
    render();
  });
}).catch(function () {
  showOffline(banner);
  document.getElementById("headline-text").textContent = "No data yet.";
});

function regionMonths(region) {
  return store.monthly
    .filter(function (row) { return row.region_id === region; })
    .sort(function (a, b) { return a.year - b.year || a.month - b.month; });
}

function findMonth(region, year, month) {
  return store.monthly.filter(function (row) {
    return row.region_id === region && row.year === year && row.month === month;
  })[0];
}

function asOf(headline) {
  if (!headline || !headline.as_of_month) return null;
  return { year: Number(headline.as_of_month.slice(0, 4)), month: Number(headline.as_of_month.slice(5, 7)) };
}

function render() {
  var region = currentRegion();
  var headline = store.headlines.filter(function (row) { return row.region_id === region; })[0];
  var mine = regionMonths(region);
  var when = asOf(headline) || (mine.length ? { year: mine[mine.length - 1].year, month: mine[mine.length - 1].month } : null);
  var row = when ? findMonth(region, when.year, when.month) : null;

  renderHero(region, headline, row, when);
  renderKpis(region, headline, row, when, mine);
  renderSeason(region, mine, when);
  renderLast12(region, mine);
  renderRegions(region);

  var query = "?region=" + encodeURIComponent(region);
  var deep = when ? query + "&year=" + when.year + "&month=" + when.month : query;
  document.getElementById("link-calendar").href = "calendar.html" + deep;
  document.getElementById("link-calendar-2").href = "calendar.html" + deep;
  document.getElementById("link-map").href = "index.html" + query;
  document.getElementById("link-year").href = "year.html" + query + (when ? "&year=" + when.year : "");
  document.getElementById("link-briefing").href = "briefing.html" + deep;
}

function renderHero(region, headline, row, when) {
  document.getElementById("hero-eyebrow").textContent = regionName(region) + (when ? " · as of " + monthLabel(when.year, when.month) : "");
  var chip = document.getElementById("hero-chip");
  chip.innerHTML = "";
  if (row && row.anomaly_class) chip.appendChild(statusChip(row.anomaly_class));
  document.getElementById("headline-text").textContent = headline ? headline.headline : "No headline for this region yet.";
  var alt = document.getElementById("headline-alt");
  if (headline && headline.alt_text) alt.textContent = headline.alt_text;
}

// ---------- indicators ----------

function kpi(label, value, unit, help, vizBuilder) {
  var card = el("article", { class: "kpi" });
  card.appendChild(el("div", { class: "kpi-label", html: label }));
  var valueNode = el("div", { class: "kpi-value", text: value });
  if (unit) valueNode.appendChild(el("span", { class: "unit", text: unit }));
  card.appendChild(valueNode);
  var viz = el("div", { class: "kpi-viz" });
  card.appendChild(viz);
  var details = el("details", null, [el("summary", { text: "What this means" }), el("p", { text: help })]);
  card.appendChild(details);
  document.getElementById("kpis").appendChild(card);
  if (vizBuilder) vizBuilder(viz);
}

function renderKpis(region, headline, row, when, mine) {
  var host = document.getElementById("kpis");
  host.innerHTML = "";
  if (!headline) return;

  kpi(term("anomaly-ratio", "This month vs usual"), formatRatio(headline.month_anomaly_ratio), null,
    "This month's cell-days divided by the usual value for that month. Above 1 means a busier month than the historical middle. The dot is this month, the band is the middle half of past years, the line is the usual month.",
    function (viz) {
      if (row) bullet(viz, { lo: row.baseline_p25, hi: row.baseline_p75, median: row.baseline_median, value: row.harmonized_cell_days, color: classColor(row.anomaly_class) });
    });

  var sameMonth = mine.filter(function (r) { return when && r.month === when.month; });
  kpi(term("rank", "Rank in that month"), String(headline.month_rank_in_month), row ? " of " + row.n_years_ranked : "",
    "1 is the busiest year on record for that calendar month. Each bar is one year's " + (when ? MONTHS[when.month - 1] : "month") + "; the highlighted bar is this year.",
    function (viz) { miniColumns(viz, sameMonth.map(function (r) { return { key: r.year, label: String(r.year), value: r.harmonized_cell_days, cls: r.anomaly_class }; }), when ? when.year : null); });

  var thisYear = when ? mine.filter(function (r) { return r.year === when.year && r.month <= when.month; }) : [];
  kpi(term("year-to-date", "Year to date"), formatCompact(headline.ytd_cell_days), "cell-days",
    "Harmonized cell-days from January through the latest month (" + formatNumber(headline.ytd_cell_days) + "). One hot month can sit inside an otherwise ordinary year, so the running total is the check.",
    function (viz) {
      var values = [];
      var titles = [];
      for (var m = 1; m <= 12; m++) {
        var r = thisYear.filter(function (x) { return x.month === m; })[0];
        values.push(r ? r.harmonized_cell_days : null);
        titles.push(when ? monthLabel(when.year, m) : MONTHS[m - 1]);
      }
      sparkline(viz, { values: values, titles: titles, label: "Cell-days", markIndex: when ? when.month - 1 : null });
    });

  kpi(term("year-to-date", "Year to date vs usual"), formatRatio(headline.ytd_vs_median), null,
    "The running total divided by the usual total for those same months in past years. This says whether the season so far, not just one month, is high.",
    function (viz) {
      var usual = headline.ytd_vs_median ? headline.ytd_cell_days / headline.ytd_vs_median : null;
      pairBars(viz, [
        { label: when ? String(when.year) : "This year", value: headline.ytd_cell_days, color: cssVar("--s-harm") },
        { label: "Usual", value: usual, color: cssVar("--median") },
      ]);
    });

  var top = store.analogs.filter(function (a) { return a.region_id === region; }).sort(function (a, b) { return a.rank - b.rank; })[0];
  kpi(term("analog", "Closest earlier year"), String(headline.top_analog_year || "–"), top ? " · " + Math.round(top.similarity_pct) + "% similar" : "",
    "The past year whose month-by-month pattern, up to now, looks most like this one. It is a resemblance, not a forecast of how the rest of the season will go.",
    function (viz) {
      if (!top) return;
      viz.appendChild(el("div", { class: "analog" }, [
        el("div", { class: "sim" }, [el("i", { style: "width:" + Math.round(top.similarity_pct) + "%" })]),
        el("div", { class: "small muted", text: "After " + MONTHS[top.through_month - 1] + ", " + top.analog_year + " added " + formatCompact(top.analog_rest_of_year_cell_days) + " cell-days (" + formatRatio(top.analog_rest_vs_median) + " usual)." }),
      ]));
    });
}

function miniColumns(host, items, selectedKey) {
  host.innerHTML = "";
  var max = Math.max.apply(null, items.map(function (d) { return d.value || 0; }).concat([1]));
  var row = el("div", { style: "display:flex;align-items:flex-end;gap:2px;height:38px" });
  items.forEach(function (d) {
    var selected = d.key === selectedKey;
    var fill = classColor(d.cls);
    var bar = el("span", {
      tabindex: "0",
      "aria-label": d.label + ": " + formatNumber(d.value) + " cell-days, " + (CLASS_LABEL[d.cls] || "") + " usual",
      style: "flex:1;min-width:4px;height:" + Math.max(6, (38 * (d.value || 0)) / max) + "px;border-radius:3px 3px 0 0;background:" + fill + ";" + (selected ? "box-shadow:0 0 0 2px var(--ink);" : "opacity:0.75;"),
    });
    var content = function () {
      return { title: d.label, rows: [{ label: "Cell-days", value: formatNumber(d.value), color: fill, kind: "box" }, { label: "Class", value: CLASS_LABEL[d.cls] || "–" }] };
    };
    bar.addEventListener("pointermove", function (event) { Tip.show(content(), event.clientX, event.clientY); });
    bar.addEventListener("pointerleave", Tip.hide);
    bar.addEventListener("focus", function () { Tip.showAt(content(), bar); });
    bar.addEventListener("blur", Tip.hide);
    row.appendChild(bar);
  });
  host.appendChild(row);
}

function pairBars(host, items) {
  host.innerHTML = "";
  var max = Math.max.apply(null, items.map(function (d) { return d.value || 0; }).concat([1]));
  items.forEach(function (d) {
    host.appendChild(el("div", { style: "display:grid;grid-template-columns:3.6rem 1fr auto;align-items:center;gap:0.4rem;font-size:0.78rem;color:var(--muted);margin-top:3px" }, [
      el("span", { text: d.label }),
      el("span", { style: "height:8px;border-radius:4px;background:" + d.color + ";width:" + (100 * (d.value || 0)) / max + "%" }),
      el("span", { class: "num", text: formatCompact(d.value) }),
    ]));
  });
}

// ---------- season chart ----------

function baselineFor(mine, month, preferYear) {
  var pick = mine.filter(function (r) { return r.month === month && r.year === preferYear; })[0] ||
    mine.filter(function (r) { return r.month === month; }).slice(-1)[0];
  return pick || null;
}

function renderSeason(region, mine, when) {
  var year = when ? when.year : null;
  var years = [];
  mine.forEach(function (r) { if (years.indexOf(r.year) === -1 && r.year !== year) years.push(r.year); });
  years.sort(function (a, b) { return b - a; });

  var chips = document.getElementById("compare-years");
  chips.innerHTML = "";
  [null].concat(years).forEach(function (y) {
    var chip = el("button", { type: "button", class: "chip", "aria-pressed": String(y === compareYear), text: y === null ? "None" : String(y) });
    chip.addEventListener("click", function () {
      compareYear = y;
      renderSeason(region, mine, when);
    });
    chips.appendChild(chip);
  });

  var valuesFor = function (y) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var r = mine.filter(function (x) { return x.year === y && x.month === m; })[0];
      out.push(r ? r.harmonized_cell_days : null);
    }
    return out;
  };

  var band = [];
  var median = [];
  for (var m = 1; m <= 12; m++) {
    var b = baselineFor(mine, m, year);
    band.push(b ? { lo: b.baseline_p25, hi: b.baseline_p75 } : null);
    median.push(b ? b.baseline_median : null);
  }

  var series = [];
  if (year) series.push({ name: String(year), values: valuesFor(year), color: "--s-harm", width: 2.5 });
  if (compareYear) series.push({ name: String(compareYear), values: valuesFor(compareYear), color: "--s-modis", dashed: true });

  document.getElementById("season-sub").textContent = year
    ? "Harmonized cell-days in " + year + " against the usual month (dashed) and the normal range (shaded). Click a month to open it in the calendar."
    : "";

  lineBandChart(document.getElementById("season-chart"), {
    labels: MONTHS_SHORT,
    titles: MONTHS.map(function (name) { return name + (year ? " " + year : ""); }),
    band: band,
    median: median,
    series: series,
    selectedIndex: when ? when.month - 1 : null,
    ariaLabel: "Monthly harmonized cell-days for " + regionName(region),
    onPick: function (i) {
      if (!year) return;
      location.href = "calendar.html?region=" + encodeURIComponent(region) + "&year=" + year + "&month=" + (i + 1);
    },
  });

  var items = [{ kind: "band", label: "Normal range" }, { kind: "dash", label: "Usual month", color: cssVar("--median") }];
  if (year) items.unshift({ kind: "line", label: String(year), color: cssVar("--s-harm") });
  if (compareYear) items.splice(1, 0, { kind: "dash", label: String(compareYear), color: cssVar("--s-modis") });
  legend(document.getElementById("season-legend"), items);

  var button = document.getElementById("season-table");
  var fresh = button.cloneNode(false);
  button.replaceWith(fresh);
  tableToggle(fresh, document.getElementById("season-chart"), document.getElementById("season-table-host"), function () {
    var current = year ? valuesFor(year) : [];
    var other = compareYear ? valuesFor(compareYear) : [];
    var headers = ["Month", year ? String(year) : "This year"].concat(compareYear ? [String(compareYear)] : []).concat(["Usual", "Normal range"]);
    return buildTable(headers, MONTHS.map(function (name, i) {
      return [name, formatNumber(current[i])].concat(compareYear ? [formatNumber(other[i])] : []).concat([
        formatNumber(median[i]),
        band[i] ? formatNumber(band[i].lo) + " – " + formatNumber(band[i].hi) : "none",
      ]);
    }));
  });
  document.getElementById("season-chart").hidden = false;
  document.getElementById("season-table-host").hidden = true;
}

// ---------- last 12 months ----------

function renderLast12(region, mine) {
  var host = document.getElementById("last12");
  host.innerHTML = "";
  mine.slice(-12).forEach(function (r) {
    var fill = classColor(r.anomaly_class);
    var button = el("button", {
      type: "button",
      style: "background:" + fill + ";color:" + textOn(fill),
      "aria-label": monthLabel(r.year, r.month) + ": " + (CLASS_LABEL[r.anomaly_class] || "") + " usual, " + formatNumber(r.harmonized_cell_days) + " cell-days",
    }, [MONTHS_SHORT[r.month - 1], el("br"), el("span", { style: "font-weight:500;opacity:0.85", text: "'" + String(r.year).slice(2) })]);
    var content = function () {
      return {
        title: monthLabel(r.year, r.month),
        rows: [
          { label: "Cell-days", value: formatNumber(r.harmonized_cell_days), color: fill, kind: "box" },
          { label: "Compared with usual", value: formatRatio(r.anomaly_ratio) },
          { label: "Rank", value: r.rank_in_month + " of " + r.n_years_ranked },
        ],
        note: "Open in the calendar",
      };
    };
    button.addEventListener("pointermove", function (event) { Tip.show(content(), event.clientX, event.clientY); });
    button.addEventListener("pointerleave", Tip.hide);
    button.addEventListener("focus", function () { Tip.showAt(content(), button); });
    button.addEventListener("blur", Tip.hide);
    button.addEventListener("click", function () {
      location.href = "calendar.html?region=" + encodeURIComponent(region) + "&year=" + r.year + "&month=" + r.month;
    });
    host.appendChild(button);
  });
  legend(document.getElementById("class-legend"), CLASS_ORDER.map(function (name) {
    return { kind: "box", label: CLASS_LABEL[name], color: classColor(name) };
  }));
}

// ---------- both regions ----------

function renderRegions(current) {
  var host = document.getElementById("regions");
  host.innerHTML = "";
  REGIONS.forEach(function (region) {
    var headline = store.headlines.filter(function (h) { return h.region_id === region.id; })[0];
    var when = asOf(headline);
    var row = when ? findMonth(region.id, when.year, when.month) : null;
    var tile = el("button", { type: "button", class: "region-tile", "aria-pressed": String(region.id === current) });
    tile.appendChild(el("span", { class: "small muted", text: region.name + (when ? " · " + monthLabel(when.year, when.month) : "") }));
    tile.appendChild(el("strong", { text: headline ? formatRatio(headline.month_anomaly_ratio) : "–" }));
    var foot = el("span", { style: "display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap" });
    if (row) foot.appendChild(statusChip(row.anomaly_class));
    if (headline) foot.appendChild(el("span", { class: "small muted", text: "rank " + headline.month_rank_in_month + (row ? " of " + row.n_years_ranked : "") }));
    tile.appendChild(foot);
    tile.addEventListener("click", function () { setRegion(region.id); });
    host.appendChild(tile);
  });
}

document.addEventListener("themechange", function () {
  if (store.monthly.length) render();
});
