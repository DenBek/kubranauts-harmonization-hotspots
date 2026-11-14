// Briefing: pick a month, preview the text from /api/notify on a phone.
// Nothing is sent; functions/api/notify.js only builds the sentence.

var banner = document.getElementById("data-banner");
var monthly = [];
var headlines = [];
var source = "sample";
var pick = { year: Number(queryParam("year")) || null, month: Number(queryParam("month")) || null };
var lastSms = "";
var requestId = 0;

// GSM 03.38 basic set: messages using only these fit 160 characters per text.
var GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

Promise.all([fetchGold("gold_region_monthly"), fetchGold("gold_region_headline")])
  .then(function (results) {
    monthly = results[0].rows || [];
    headlines = results[1].rows || [];
    source = results[0].source || "sample";
    showBanner(banner, results[0]);
    render();
    // render() keeps the picked month if the new region has it.
    onRegionChange(function () { render(); });
  })
  .catch(function () { showOffline(banner); });

document.addEventListener("themechange", function () { if (monthly.length) render(); });

function mine() {
  return monthly.filter(function (row) { return row.region_id === currentRegion(); })
    .sort(function (a, b) { return a.year - b.year || a.month - b.month; });
}

function find(year, month) {
  return mine().filter(function (row) { return row.year === year && row.month === month; })[0];
}

function render() {
  var rows = mine();
  if (!rows.length) return;
  var headline = headlines.filter(function (h) { return h.region_id === currentRegion(); })[0];
  if (!pick.year || !find(pick.year, pick.month)) {
    if (headline && headline.as_of_month) {
      pick = { year: Number(headline.as_of_month.slice(0, 4)), month: Number(headline.as_of_month.slice(5, 7)) };
    }
    if (!find(pick.year, pick.month)) {
      var last = rows[rows.length - 1];
      pick = { year: last.year, month: last.month };
    }
  }
  document.getElementById("eyebrow").textContent = regionName(currentRegion()) + " · field briefing";
  document.getElementById("phone-region").textContent = regionName(currentRegion());
  renderYears(rows);
  renderMonths();
  renderFacts();
  preview();
  legend(document.getElementById("class-legend"), CLASS_ORDER.map(function (name) {
    return { kind: "box", label: CLASS_LABEL[name], color: classColor(name) };
  }));
}

function choose(year, month) {
  pick = { year: year, month: month };
  setParams({ year: year, month: month });
  renderYears(mine());
  renderMonths();
  renderFacts();
  preview();
}

function renderYears(rows) {
  var host = document.getElementById("year-chips");
  host.innerHTML = "";
  var years = [];
  rows.forEach(function (row) { if (years.indexOf(row.year) === -1) years.push(row.year); });
  years.forEach(function (year) {
    var chip = el("button", { type: "button", class: "chip", "aria-pressed": String(year === pick.year), text: String(year) });
    chip.addEventListener("click", function () {
      var keep = find(year, pick.month);
      var first = mine().filter(function (r) { return r.year === year; });
      choose(year, keep ? pick.month : first[first.length - 1].month);
    });
    host.appendChild(chip);
  });
}

function renderMonths() {
  var host = document.getElementById("month-picker");
  host.innerHTML = "";
  for (var m = 1; m <= 12; m++) {
    var row = find(pick.year, m);
    var button = el("button", { type: "button", "aria-pressed": String(m === pick.month), text: MONTHS_SHORT[m - 1] });
    if (!row) {
      button.disabled = true;
      button.setAttribute("aria-label", MONTHS[m - 1] + " " + pick.year + ": no data");
    } else {
      var fill = classColor(row.anomaly_class);
      button.style.background = fill;
      button.style.color = textOn(fill);
      button.setAttribute("aria-label", monthLabel(pick.year, m) + ": " + CLASS_LABEL[row.anomaly_class] + " usual");
      (function (month) {
        button.addEventListener("click", function () { choose(pick.year, month); });
      })(m);
    }
    host.appendChild(button);
  }
}

function renderFacts() {
  var host = document.getElementById("month-facts");
  host.innerHTML = "";
  var row = find(pick.year, pick.month);
  if (!row) return;
  var head = el("div", { class: "card-head", style: "margin-bottom:0" }, [el("h3", { text: monthLabel(row.year, row.month) }), statusChip(row.anomaly_class)]);
  host.appendChild(head);
  var dl = el("dl", { class: "metric compact" });
  dl.innerHTML =
    metricItem(term("harmonized-cell-days", "Cell-days"), formatNumber(row.harmonized_cell_days)) +
    metricItem(term("anomaly-ratio", "Compared with usual"), formatRatio(row.anomaly_ratio)) +
    metricItem(term("rank", "Rank"), row.rank_in_month + " of " + row.n_years_ranked);
  host.appendChild(dl);
}

function preview() {
  var row = find(pick.year, pick.month);
  var headline = headlines.filter(function (h) { return h.region_id === currentRegion(); })[0];
  var useHeadline = headline && Number(headline.as_of_month.slice(0, 4)) === pick.year && Number(headline.as_of_month.slice(5, 7)) === pick.month;
  var body = {
    region: regionName(currentRegion()),
    year: pick.year,
    month: pick.month,
    count: row ? row.harmonized_cell_days : null,
    ratio: row ? row.anomaly_ratio : null,
    rank: row ? row.rank_in_month : null,
    n: row ? row.n_years_ranked : null,
    headline: useHeadline ? headline.headline : "",
    source: source,
  };
  var id = ++requestId;
  var bubble = document.getElementById("sms");
  bubble.classList.add("refreshing");
  fetch("/api/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(function (response) { return response.json(); })
    .then(function (result) {
      if (id !== requestId) return;
      lastSms = result.sms || "";
      var fresh = el("p", { class: "sms-bubble", id: "sms", "aria-live": "polite", text: lastSms });
      bubble.replaceWith(fresh);
      document.getElementById("sms-meta").textContent = "Preview · " + (useHeadline ? "headline month" : "built from the calendar row");
      document.getElementById("phone-time").textContent = "Briefing for " + monthLabel(pick.year, pick.month);
      document.getElementById("twilio-status").textContent = result.twilio || "";
      renderCounter(lastSms);
    })
    .catch(function () {
      bubble.classList.remove("refreshing");
      bubble.textContent = "The preview API did not respond.";
    });
}

function renderCounter(text) {
  var host = document.getElementById("counter");
  host.innerHTML = "";
  var gsm = Array.from(text).every(function (ch) { return GSM.indexOf(ch) !== -1; });
  var length = Array.from(text).length;
  var single = gsm ? 160 : 70;
  var multi = gsm ? 153 : 67;
  var parts = length <= single ? 1 : Math.ceil(length / multi);
  host.appendChild(el("span", null, [el("strong", { text: String(length) }), " characters"]));
  host.appendChild(el("span", null, [el("strong", { text: String(parts) }), parts === 1 ? " text message" : " text messages"]));
  host.appendChild(el("span", { title: gsm ? "Only standard SMS characters" : "A character such as × needs Unicode, which shortens each text to 70 characters" }, [gsm ? "Standard characters" : "Unicode (70 per text)"]));
}

document.getElementById("copy").addEventListener("click", function () {
  var button = document.getElementById("copy");
  if (!lastSms || !navigator.clipboard) return;
  navigator.clipboard.writeText(lastSms).then(function () {
    button.innerHTML = icon("check", 16) + "Copied";
    setTimeout(function () { button.innerHTML = icon("copy", 16) + "Copy text"; }, 1600);
  });
});

document.getElementById("send").addEventListener("click", function () {
  document.getElementById("twilio-status").textContent = "Sending is off: Twilio is not connected, so no message leaves this page.";
});
