// Site header: brand, page links, the data-source pill, and the light/dark
// toggle. Load after gold.js.
//
// A new page needs one entry in PAGES below.

(function () {
  // [page, label, mode]. The home page (index) is the map; "Draw an area" opens it with the drawing tools
  // (draw.html forwards there too).
  var PAGES = [
    ["index", "Map", "explore"],
    ["problem", "The problem"],
    ["regions", "Fire calendar"],
    ["index", "Draw an area", "draw"],
    ["accuracy", "How accurate is it?"],
    ["glossary", "Words used"],
    // The old Map page lives at map-old.html (no nav entry).
    // Hidden from the nav (still in the repo): overview, year and briefing depend on the analogs table, which the
    // Argentina MVP does not produce, or on SMS preview copy. See harmonization/argentina/SCOPE_AND_GAPS.md.
  ];
  var THEME_KEY = "fire-calendar-theme";

  var header = document.getElementById("site-header");
  if (!header) return;

  var path = location.pathname.split("/").pop().replace(/\.html$/, "") || "index";

  header.className = "site-header";
  header.innerHTML =
    "<a class='skip-link' href='#main'>Skip to content</a>" +
    "<div class='bar'>" +
    "  <a class='brand' href='index.html'>" +
    "    <span class='brand-mark'>" + icon("flame", 18) + "</span>" +
    "    <span class='brand-text'>Fire Calendar<small>Team Kubranauts · NASA Space Apps</small></span>" +
    "  </a>" +
    "  <nav class='nav' id='site-nav' aria-label='Pages'></nav>" +
    "  <div class='bar-tools'>" +
    "    <span class='source-pill' id='source-pill' data-source='sample' tabindex='0' title='Which dataset the pages are reading'><span class='dot'></span><span class='pill-text'>Loading</span></span>" +
    "    <button type='button' class='btn ghost icon' id='theme-toggle'></button>" +
    "    <button type='button' class='btn ghost icon menu-button' id='menu-toggle' aria-expanded='false' aria-controls='site-nav' aria-label='Menu'>" + icon("menu", 20) + "</button>" +
    "  </div>" +
    "</div>";

  var nav = document.getElementById("site-nav");
  function currentMode() {
    var m = new URLSearchParams(location.search).get("mode");
    return m === "draw" || m === "region" ? m : "explore";
  }
  function markCurrent() {
    nav.querySelectorAll("a").forEach(function (link) {
      var on = link.dataset.page === path && (!link.dataset.mode || link.dataset.mode === (currentMode() === "draw" ? "draw" : "explore"));
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }
  PAGES.forEach(function (page) {
    var link = document.createElement("a");
    link.href = page[0] + ".html" + (page[2] === "draw" ? "?mode=draw" : "");
    link.dataset.page = page[0];
    if (page[2]) link.dataset.mode = page[2];
    link.textContent = page[1];
    nav.appendChild(link);
  });
  markCurrent();
  // The map page switches modes without reloading; keep the highlighted link in step.
  document.addEventListener("paramschange", markCurrent);

  // No header region picker: only the Fire calendar page has regions, and it has its own buttons. Nav links carry no ?region=.

  var menu = document.getElementById("menu-toggle");
  menu.addEventListener("click", function () {
    var open = nav.dataset.open !== "true";
    nav.dataset.open = String(open);
    menu.setAttribute("aria-expanded", String(open));
  });

  // ----- theme -----
  var toggle = document.getElementById("theme-toggle");

  function effectiveTheme() {
    var stamp = document.documentElement.dataset.theme;
    if (stamp === "light" || stamp === "dark") return stamp;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function paintToggle() {
    var dark = effectiveTheme() === "dark";
    toggle.innerHTML = icon(dark ? "sun" : "moon", 19);
    toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    toggle.title = toggle.getAttribute("aria-label");
  }

  toggle.addEventListener("click", function () {
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore */ }
    paintToggle();
    document.dispatchEvent(new CustomEvent("themechange"));
  });

  if (window.matchMedia) {
    var query = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystemChange = function () {
      paintToggle();
      document.dispatchEvent(new CustomEvent("themechange"));
    };
    if (query.addEventListener) query.addEventListener("change", onSystemChange);
    else if (query.addListener) query.addListener(onSystemChange);
  }

  paintToggle();

  // <span data-icon="map"></span> in the HTML becomes the inline icon.
  document.querySelectorAll("[data-icon]").forEach(function (node) {
    node.outerHTML = icon(node.getAttribute("data-icon"), Number(node.getAttribute("data-size")) || 17);
  });
})();
