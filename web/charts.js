// Small SVG chart kit for the fire calendar. No library, no build.
//
// Every chart:
//   - redraws on resize and when the theme changes (colors come from CSS tokens)
//   - shows a tooltip on hover AND on keyboard focus (same content)
//   - has a table view through tableToggle(), so no value lives only in a tooltip
//
// Load after gold.js.

var SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs, parent) {
  var node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach(function (key) {
    if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
  });
  if (parent) parent.appendChild(node);
  return node;
}

// ---------- tooltip ----------

var Tip = (function () {
  var node = null;

  function ensure() {
    if (!node) {
      node = document.createElement("div");
      node.className = "tooltip";
      node.setAttribute("role", "tooltip");
      document.body.appendChild(node);
    }
    return node;
  }

  // content: { title, rows: [{ label, value, color, kind: "line"|"box"|"dash" }], note }
  function fill(content) {
    var tip = ensure();
    tip.innerHTML = "";
    if (content.title) tip.appendChild(el("div", { class: "tt-title", text: content.title }));
    (content.rows || []).forEach(function (row) {
      var key = el("span", { class: "tt-key" });
      if (row.color) {
        var swatch = el("i", { class: row.kind === "box" ? "box" : "" });
        if (row.kind === "box") swatch.style.background = row.color;
        else swatch.style.borderTopColor = row.color;
        if (row.kind === "dash") swatch.style.borderTopStyle = "dashed";
        key.appendChild(swatch);
      }
      key.appendChild(document.createTextNode(row.label));
      tip.appendChild(el("div", { class: "tt-row" }, [key, el("span", { class: "tt-val", text: row.value })]));
    });
    if (content.note) tip.appendChild(el("div", { class: "tt-note", text: content.note }));
    return tip;
  }

  function place(tip, x, y) {
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var left = x + 14;
    var top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
    tip.dataset.show = "true";
  }

  return {
    show: function (content, x, y) { place(fill(content), x, y); },
    showAt: function (content, target) {
      var rect = target.getBoundingClientRect();
      var tip = fill(content);
      place(tip, rect.left + rect.width / 2 - 14, rect.top - tip.offsetHeight - 6 < 8 ? rect.bottom - 14 : rect.top - tip.offsetHeight - 28);
    },
    hide: function () { if (node) node.dataset.show = "false"; },
  };
})();

document.addEventListener("scroll", function () { Tip.hide(); }, true);

// ---------- redraw on resize and theme change ----------

// Calling a chart again on the same host replaces its drawing; the resize and
// theme listeners are attached once per host.
function autoRender(host, draw) {
  host.__draw = draw;
  if (!host.__observed) {
    host.__observed = true;
    var lastWidth = host.clientWidth;
    var frame = 0;
    var onResize = function () {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        if (host.clientWidth === lastWidth) return;
        lastWidth = host.clientWidth;
        host.__draw();
      });
    };
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(host);
    else window.addEventListener("resize", onResize);
    var onTheme = function () {
      if (!host.isConnected) { document.removeEventListener("themechange", onTheme); return; }
      host.__draw();
    };
    document.addEventListener("themechange", onTheme);
  }
  draw();
  return { redraw: function () { host.__draw(); } };
}

// ---------- scale helpers ----------

function niceTicks(max, count) {
  if (!(max > 0)) return [0, 1];
  var raw = max / (count || 4);
  var power = Math.pow(10, Math.floor(Math.log10(raw)));
  var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * power; }).filter(function (s) { return s >= raw; })[0];
  var ticks = [];
  for (var v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return "";
  var rr = Math.min(r, w / 2, h);
  return "M" + x + "," + (y + h) +
    "V" + (y + rr) +
    "Q" + x + "," + y + " " + (x + rr) + "," + y +
    "H" + (x + w - rr) +
    "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + rr) +
    "V" + (y + h) + "Z";
}

// Arrow-key movement across a set of focusable marks (one tab stop per chart).
function rovingKeys(marks, onMove) {
  marks.forEach(function (mark, index) {
    mark.addEventListener("keydown", function (event) {
      var next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(marks.length - 1, index + 1);
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = marks.length - 1;
      if (next === null) return;
      event.preventDefault();
      marks[index].setAttribute("tabindex", "-1");
      marks[next].setAttribute("tabindex", "0");
      marks[next].focus();
      if (onMove) onMove(next);
    });
  });
}

// ---------- bar chart ----------
//
// opts: {
//   data: [{ key, label, value, partial, title }],
//   color: "--s-harm", selectedKey, median, medianLabel,
//   height, format(value), tooltip(d) -> content, onSelect(d), ariaLabel
// }
function barChart(host, opts) {
  return autoRender(host, function () {
    host.innerHTML = "";
    var data = opts.data || [];
    var width = Math.max(240, host.clientWidth);
    var height = opts.height || 220;
    var m = { top: 16, right: 14, bottom: 26, left: 44 };
    var innerW = width - m.left - m.right;
    var innerH = height - m.top - m.bottom;
    var values = data.map(function (d) { return d.value || 0; });
    var max = Math.max.apply(null, values.concat([opts.median || 0, 1]));
    var ticks = niceTicks(max, 4);
    var top = ticks[ticks.length - 1];
    var y = function (v) { return m.top + innerH - (innerH * v) / top; };
    var color = cssVar(opts.color || "--s-harm");
    var format = opts.format || formatCompact;

    var root = svg("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": opts.ariaLabel || "Bar chart" }, null);
    var uid = "h" + Math.random().toString(36).slice(2, 8);
    var defs = svg("defs", {}, root);
    var pattern = svg("pattern", { id: uid, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }, pattern);

    ticks.forEach(function (t) {
      svg("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: t === 0 ? "axis-line" : "grid-line" }, root);
      var label = svg("text", { x: m.left - 8, y: y(t) + 4, "text-anchor": "end" }, root);
      label.textContent = format(t);
    });

    var band = innerW / Math.max(1, data.length);
    var barW = Math.max(2, Math.min(56, band - 4));
    var every = Math.max(1, Math.ceil((data.length * 34) / innerW));
    var hasSelection = opts.selectedKey !== undefined && opts.selectedKey !== null;
    var marks = [];

    data.forEach(function (d, i) {
      var x0 = m.left + i * band;
      var bx = x0 + (band - barW) / 2;
      var v = d.value || 0;
      var selected = hasSelection && d.key === opts.selectedKey;
      var g = svg("g", { class: "mark" + (hasSelection && !selected ? " dim" : ""), tabindex: "-1", role: "button", "aria-label": (d.title || d.label) + ": " + formatNumber(d.value) + (selected ? ", selected" : "") }, root);
      svg("rect", { x: x0, y: m.top, width: band, height: innerH, class: "bar-hit" }, g);
      if (!isMissing(d.value)) {
        var path = roundedTop(bx, y(v), barW, Math.max(0, y(0) - y(v)), 4);
        svg("path", { d: path, fill: d.color || color, class: "bar" }, g);
        if (d.partial) svg("path", { d: path, fill: "url(#" + uid + ")", class: "bar", "pointer-events": "none" }, g);
      }
      if (selected && !isMissing(d.value)) {
        var valueLabel = svg("text", { x: bx + barW / 2, y: y(v) - 6, "text-anchor": "middle", "font-weight": "700", style: "fill:var(--ink)" }, g);
        valueLabel.textContent = format(d.value);
      }
      if (i % every === 0 || selected) {
        var xl = svg("text", { x: bx + barW / 2, y: height - 8, "text-anchor": "middle", style: selected ? "fill:var(--ink);font-weight:700" : null }, root);
        xl.textContent = d.label;
      }
      var content = function () { return opts.tooltip ? opts.tooltip(d) : { title: d.title || d.label, rows: [{ label: "Value", value: formatNumber(d.value), color: d.color || color, kind: "box" }] }; };
      g.addEventListener("pointermove", function (event) { Tip.show(content(), event.clientX, event.clientY); });
      g.addEventListener("pointerleave", Tip.hide);
      g.addEventListener("focus", function () { Tip.showAt(content(), g); });
      g.addEventListener("blur", Tip.hide);
      if (opts.onSelect) {
        g.addEventListener("click", function () { Tip.hide(); opts.onSelect(d); });
        g.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); opts.onSelect(d); }
        });
      }
      marks.push(g);
    });

    if (!isMissing(opts.median) && opts.median > 0) {
      svg("line", { x1: m.left, x2: width - m.right, y1: y(opts.median), y2: y(opts.median), class: "median-line" }, root);
      var ml = svg("text", { x: m.left + 4, y: y(opts.median) - 5, "text-anchor": "start", class: "median-label" }, root);
      ml.textContent = (opts.medianLabel || "Usual") + " " + format(opts.median);
    }

    var focusIndex = Math.max(0, data.findIndex(function (d) { return d.key === opts.selectedKey; }));
    if (marks[focusIndex]) marks[focusIndex].setAttribute("tabindex", "0");
    rovingKeys(marks);
    host.appendChild(root);
  });
}

// ---------- line chart with a normal-range band ----------
//
// opts: {
//   labels: ["Jan", ...], titles: ["January 2025", ...],
//   band: [{ lo, hi }] | null, median: [..] | null,
//   series: [{ name, values, color: "--s-harm", dashed, width }],
//   height, format, selectedIndex, onPick(i), ariaLabel
// }
function lineBandChart(host, opts) {
  var state = { index: null };
  return autoRender(host, function () {
    host.innerHTML = "";
    var labels = opts.labels;
    var n = labels.length;
    var width = Math.max(260, host.clientWidth);
    var height = opts.height || 250;
    var m = { top: 16, right: 16, bottom: 28, left: 46 };
    var innerW = width - m.left - m.right;
    var innerH = height - m.top - m.bottom;
    var format = opts.format || formatCompact;
    var all = [1];
    (opts.band || []).forEach(function (b) { if (b && !isMissing(b.hi)) all.push(b.hi); });
    (opts.median || []).forEach(function (v) { if (!isMissing(v)) all.push(v); });
    opts.series.forEach(function (s) { if (s.hidden) return; s.values.forEach(function (v) { if (!isMissing(v)) all.push(v); }); });
    var ticks = niceTicks(Math.max.apply(null, all), 4);
    var top = ticks[ticks.length - 1];
    var x = function (i) { return m.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1)); };
    var y = function (v) { return m.top + innerH - (innerH * v) / top; };

    var root = svg("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": opts.ariaLabel || "Line chart" }, null);

    ticks.forEach(function (t) {
      svg("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: t === 0 ? "axis-line" : "grid-line" }, root);
      var label = svg("text", { x: m.left - 8, y: y(t) + 4, "text-anchor": "end" }, root);
      label.textContent = format(t);
    });
    labels.forEach(function (label, i) {
      if (n > 14 && i % Math.ceil(n / 12) !== 0) return;
      var t = svg("text", { x: x(i), y: height - 8, "text-anchor": "middle" }, root);
      t.textContent = label;
    });

    if (!isMissing(opts.selectedIndex)) {
      var sx = x(opts.selectedIndex);
      svg("rect", { x: sx - Math.max(6, innerW / n / 2), y: m.top, width: Math.max(12, innerW / n), height: innerH, fill: "var(--accent-soft)", rx: 6 }, root);
    }

    if (opts.band) {
      var upper = [];
      var lower = [];
      opts.band.forEach(function (b, i) {
        if (!b || isMissing(b.lo) || isMissing(b.hi)) return;
        upper.push(x(i) + "," + y(b.hi));
        lower.unshift(x(i) + "," + y(b.lo));
      });
      if (upper.length > 1) svg("path", { d: "M" + upper.join("L") + "L" + lower.join("L") + "Z", class: "band" }, root);
    }

    function linePath(values) {
      var d = "";
      var pen = false;
      values.forEach(function (v, i) {
        if (isMissing(v)) { pen = false; return; }
        d += (pen ? "L" : "M") + x(i) + "," + y(v);
        pen = true;
      });
      return d;
    }

    if (opts.median) svg("path", { d: linePath(opts.median), class: "median-line" }, root);

    var dotLayers = [];
    opts.series.forEach(function (s) {
      if (s.hidden) return;
      var color = cssVar(s.color);
      svg("path", { d: linePath(s.values), fill: "none", stroke: color, "stroke-width": s.width || 2, "stroke-dasharray": s.dashed ? "6 4" : null, "stroke-linejoin": "round", "stroke-linecap": "round" }, root);
      var layer = svg("g", {}, root);
      s.values.forEach(function (v, i) {
        if (isMissing(v)) return;
        svg("circle", { cx: x(i), cy: y(v), r: s.dots === false ? 0 : 3, fill: color, class: "dot" }, layer);
      });
      dotLayers.push({ s: s, color: color });
    });

    var cross = svg("line", { x1: 0, x2: 0, y1: m.top, y2: m.top + innerH, class: "crosshair", visibility: "hidden" }, root);
    var hot = svg("g", {}, root);

    function content(i) {
      var rows = [];
      opts.series.forEach(function (s) {
        if (s.hidden) return;
        rows.push({ label: s.name, value: isMissing(s.values[i]) ? "no value" : formatNumber(s.values[i]), color: cssVar(s.color), kind: s.dashed ? "dash" : "line" });
      });
      if (opts.median && !isMissing(opts.median[i])) rows.push({ label: "Usual (median)", value: formatNumber(opts.median[i]), color: cssVar("--median"), kind: "dash" });
      if (opts.band && opts.band[i] && !isMissing(opts.band[i].lo)) rows.push({ label: "Normal range", value: formatCompact(opts.band[i].lo) + "–" + formatCompact(opts.band[i].hi) });
      return { title: (opts.titles && opts.titles[i]) || labels[i], rows: rows, note: opts.onPick ? "Click to open this month" : null };
    }

    function highlight(i) {
      state.index = i;
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      hot.innerHTML = "";
      dotLayers.forEach(function (layer) {
        var v = layer.s.values[i];
        if (!isMissing(v)) svg("circle", { cx: x(i), cy: y(v), r: 5.5, fill: layer.color, class: "dot" }, hot);
      });
    }

    function clear() {
      cross.setAttribute("visibility", "hidden");
      hot.innerHTML = "";
      Tip.hide();
    }

    var overlay = svg("rect", { x: m.left - 10, y: m.top, width: innerW + 20, height: innerH, fill: "transparent", tabindex: "0", role: "slider", "aria-label": (opts.ariaLabel || "Chart") + ". Use arrow keys to read each month.", "aria-valuemin": 0, "aria-valuemax": n - 1 }, root);
    overlay.style.cursor = opts.onPick ? "pointer" : "crosshair";
    function indexAt(event) {
      var box = root.getBoundingClientRect();
      var px = ((event.clientX - box.left) / box.width) * width;
      return Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / innerW) * (n - 1))));
    }
    overlay.addEventListener("pointermove", function (event) {
      var i = indexAt(event);
      highlight(i);
      Tip.show(content(i), event.clientX, event.clientY);
    });
    overlay.addEventListener("pointerleave", clear);
    overlay.addEventListener("click", function (event) { if (opts.onPick) { clear(); opts.onPick(indexAt(event)); } });
    overlay.addEventListener("focus", function () {
      var i = isMissing(state.index) ? (isMissing(opts.selectedIndex) ? 0 : opts.selectedIndex) : state.index;
      highlight(i);
      overlay.setAttribute("aria-valuenow", i);
      overlay.setAttribute("aria-valuetext", content(i).title);
      Tip.showAt(content(i), overlay);
    });
    overlay.addEventListener("blur", clear);
    overlay.addEventListener("keydown", function (event) {
      var i = isMissing(state.index) ? 0 : state.index;
      if (event.key === "ArrowRight") i = Math.min(n - 1, i + 1);
      else if (event.key === "ArrowLeft") i = Math.max(0, i - 1);
      else if ((event.key === "Enter" || event.key === " ") && opts.onPick) { event.preventDefault(); opts.onPick(i); return; }
      else return;
      event.preventDefault();
      highlight(i);
      overlay.setAttribute("aria-valuenow", i);
      overlay.setAttribute("aria-valuetext", content(i).title);
      var box = root.getBoundingClientRect();
      Tip.show(content(i), box.left + (x(i) / width) * box.width, box.top + 20);
    });

    host.appendChild(root);
  });
}

// ---------- sparkline ----------
// opts: { values, color, markIndex, height, titles }
function sparkline(host, opts) {
  return autoRender(host, function () {
    host.innerHTML = "";
    var values = opts.values;
    var width = Math.max(80, host.clientWidth);
    var height = opts.height || 36;
    var nums = values.filter(function (v) { return !isMissing(v); });
    var max = Math.max.apply(null, nums.concat([1]));
    var n = values.length;
    var x = function (i) { return 3 + ((width - 6) * i) / Math.max(1, n - 1); };
    var y = function (v) { return 3 + (height - 6) * (1 - v / max); };
    var color = cssVar(opts.color || "--s-harm");
    var root = svg("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, "aria-hidden": "true" }, null);
    var d = "";
    var area = "";
    var first = null;
    var last = null;
    values.forEach(function (v, i) {
      if (isMissing(v)) return;
      d += (d ? "L" : "M") + x(i) + "," + y(v);
      if (first === null) first = i;
      last = i;
    });
    if (first !== null) {
      area = d + "L" + x(last) + "," + (height - 2) + "L" + x(first) + "," + (height - 2) + "Z";
      svg("path", { d: area, fill: color, opacity: 0.14 }, root);
      svg("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }, root);
    }
    if (!isMissing(opts.markIndex) && !isMissing(values[opts.markIndex])) {
      svg("circle", { cx: x(opts.markIndex), cy: y(values[opts.markIndex]), r: 4, fill: color, stroke: cssVar("--surface"), "stroke-width": 2 }, root);
    }
    if (opts.titles) {
      root.removeAttribute("aria-hidden");
      root.addEventListener("pointermove", function (event) {
        var box = root.getBoundingClientRect();
        var i = Math.max(0, Math.min(n - 1, Math.round(((event.clientX - box.left) / box.width) * (n - 1))));
        Tip.show({ title: opts.titles[i], rows: [{ label: opts.label || "Value", value: formatNumber(values[i]), color: color, kind: "line" }] }, event.clientX, event.clientY);
      });
      root.addEventListener("pointerleave", Tip.hide);
    }
    host.appendChild(root);
  });
}

// ---------- bullet: one value against the normal range ----------
// opts: { lo, hi, median, value, color }
function bullet(host, opts) {
  var max = Math.max(opts.hi || 0, opts.value || 0, opts.median || 0, 1) * 1.08;
  var pct = function (v) { return (100 * v) / max + "%"; };
  host.innerHTML = "";
  var wrap = el("div", { class: "bullet" });
  wrap.appendChild(el("div", { class: "track" }));
  if (!isMissing(opts.lo) && !isMissing(opts.hi)) {
    wrap.appendChild(el("div", { class: "range", style: "left:" + pct(opts.lo) + ";width:calc(" + pct(opts.hi) + " - " + pct(opts.lo) + ")" }));
  }
  if (!isMissing(opts.median)) wrap.appendChild(el("div", { class: "median", style: "left:" + pct(opts.median) }));
  if (!isMissing(opts.value)) wrap.appendChild(el("div", { class: "value", style: "left:" + pct(opts.value) + ";background:" + (opts.color || cssVar("--s-harm")) }));
  host.appendChild(wrap);
  host.appendChild(el("div", { class: "bullet-scale" }, [
    el("span", { text: "Normal " + formatCompact(opts.lo) + "–" + formatCompact(opts.hi) }),
    el("span", { text: "Usual " + formatCompact(opts.median) }),
  ]));
}

// ---------- table view ----------

function buildTable(headers, rows) {
  var table = el("table", { class: "chart-table" });
  var head = el("tr");
  headers.forEach(function (h) { head.appendChild(el("th", { scope: "col", text: h })); });
  table.appendChild(el("thead", null, [head]));
  var body = el("tbody");
  rows.forEach(function (row) {
    var tr = el("tr");
    row.forEach(function (cell, i) { tr.appendChild(el(i === 0 ? "th" : "td", i === 0 ? { scope: "row", text: String(cell) } : { text: String(cell) })); });
    body.appendChild(tr);
  });
  table.appendChild(body);
  return el("div", { class: "table-scroll" }, [table]);
}

// A "Table" button that swaps a chart for its data table.
function tableToggle(button, chartHost, tableHost, makeTable) {
  button.innerHTML = icon("table", 16) + "<span>Table</span>";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", function () {
    var showing = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", String(!showing));
    button.innerHTML = icon(showing ? "table" : "chart", 16) + "<span>" + (showing ? "Table" : "Chart") + "</span>";
    chartHost.hidden = !showing;
    tableHost.hidden = showing;
    if (!showing) {
      tableHost.innerHTML = "";
      tableHost.appendChild(makeTable());
    }
  });
}

function legend(host, items) {
  host.innerHTML = "";
  host.classList.add("legend");
  items.forEach(function (item) {
    var key;
    if (item.kind === "band") key = el("span", { class: "band-key" });
    else if (item.kind === "line" || item.kind === "dash") key = el("span", { class: "line-key" + (item.kind === "dash" ? " dashed" : ""), style: "border-top-color:" + item.color });
    else key = el("span", { class: "swatch", style: "background:" + item.color });
    if (item.onToggle) {
      var button = el("button", { type: "button", class: "legend-item", "aria-pressed": String(!item.hidden) }, [key, item.label]);
      button.addEventListener("click", function () {
        var on = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(on));
        item.onToggle(on);
      });
      host.appendChild(button);
    } else {
      host.appendChild(el("span", { class: "legend-item" }, [key, item.label]));
    }
  });
}
