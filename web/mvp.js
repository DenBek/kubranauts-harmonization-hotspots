// Shared helpers for the four MVP pages: problem, regions, draw, accuracy.
// Load after gold.js, charts.js and nav.js. Plain JS, no library.
//
// Rules every page follows (harmonization/argentina/SCOPE_AND_GAPS.md, A2):
//   - measured months are solid, converted-from-MODIS months are hatched, provisional months are dashed
//   - provisional (near-real-time) months and the month still in progress show the value but NO anomaly colour,
//     ratio, rank or percentile
//   - a converted month in a small area carries a reliability flag ("!" caution, "?" indicative only)

var DOCS_BASE = "https://github.com/DenBek/kubranauts-harmonization-hotspots/blob/dev/harmonization/argentina/";

var MVP = (function () {
  var METHOD = {
    observed_viirs: { label: "Measured by VIIRS", short: "Measured" },
    modelled_aqua: { label: "Converted from MODIS Aqua", short: "Converted" },
    provisional_nrt: { label: "Provisional (near-real-time VIIRS)", short: "Provisional" },
    insufficient_data: { label: "Too few MODIS detections to convert", short: "No estimate" },
  };
  var FLAG_LABEL = { reliable: "Reliable", good: "Good", caution: "Caution", indicative_only: "Indicative only" };
  var FLAG_MARK = { reliable: "", good: "", caution: "!", indicative_only: "?" };
  var UNIT = "VIIRS-equivalent fire detections";

  function classify(ratio) {
    if (ratio === null || ratio === undefined || !isFinite(ratio)) return null;
    if (ratio < 0.5) return "much_below";
    if (ratio < 0.8) return "below";
    if (ratio <= 1.2) return "normal";
    if (ratio <= 1.8) return "above";
    return "much_above";
  }

  function methodBadge(method) {
    var m = METHOD[method] || { label: method };
    return el("span", { class: "badge " + method }, [el("i"), m.label]);
  }

  function flagBadge(flag) {
    return el("span", { class: "badge flag-" + flag, text: FLAG_LABEL[flag] || flag });
  }

  function pct(v, digits) {
    if (isMissing(v)) return "–";
    var n = Number(v);
    return (n > 0 ? "+" : "") + n.toFixed(digits === undefined ? 0 : digits) + "%";
  }

  // ----- one calendar month, from a gold_region_monthly row (or built the same way for a drawn area) -----

  function norm(r, base) {
    var viirs = base === "viirs";
    var status = r.anomaly_status || (r.is_provisional ? "provisional" : "ok");
    var ok = status === "ok";
    return {
      year: r.year, month: r.month, key: r.year * 100 + r.month,
      value: isMissing(r.harmonized_cell_days) ? null : Number(r.harmonized_cell_days),
      low: isMissing(r.harmonized_low) ? null : Number(r.harmonized_low),
      high: isMissing(r.harmonized_high) ? null : Number(r.harmonized_high),
      method: r.method, status: status, flag: r.reliability || "reliable",
      ratio: ok ? (viirs ? r.anomaly_ratio_viirs : r.anomaly_ratio) : null,
      cls: ok ? (viirs ? r.anomaly_class_viirs : r.anomaly_class) : null,
      median: viirs ? r.baseline_viirs_median : r.baseline_median,
      rank: ok ? r.rank_in_month : null, nRanked: r.n_years_ranked,
      percentile: ok ? r.percentile_rank : null,
      stable: r.anomaly_class_stable, coverage: r.coverage, aqua: r.modis_cell_days, raw: r.raw_count,
      complete: r.is_complete !== false, src: r,
    };
  }

  function ordinal(n) {
    var v = n % 100;
    return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th");
  }

  function statusText(r) {
    if (r.status === "provisional") return "Provisional: near-real-time data, not yet compared with earlier years.";
    if (r.status === "incomplete") return "Month in progress: not yet compared with earlier years.";
    if (r.status === "insufficient_data") return "Too few MODIS detections in this area to convert this month.";
    return "";
  }

  // ----- hatch pattern -----

  function addHatch(svgNode, id) {
    var defs = svg("defs", {}, svgNode);
    var p = svg("pattern", { id: id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }, p);
  }

  var uid = 0;

  // ----- month x year calendar -----
  // rows: norm() results. opts: { selected, onSelect, label }. Returns { select(key) }.

  function calendarGrid(host, rows, opts) {
    opts = opts || {};
    var years = [];
    var byKey = {};
    rows.forEach(function (r) { byKey[r.key] = r; if (years.indexOf(r.year) === -1) years.push(r.year); });
    years.sort(function (a, b) { return a - b; });
    var selected = opts.selected || null;
    var cells = {};
    var id = "hatch" + (++uid);

    function cellLabel(r) {
      var t = monthLabel(r.year, r.month) + ": " + (r.value === null ? "no estimate" : formatNumber(r.value) + " detections") + ". " + (METHOD[r.method] || {}).label + ".";
      if (r.status === "ok") t += " " + (CLASS_LABEL[r.cls] || "No comparison") + " usual.";
      else t += " " + statusText(r);
      if (r.method === "modelled_aqua" && FLAG_MARK[r.flag]) t += " Reliability: " + FLAG_LABEL[r.flag] + ".";
      return t;
    }

    function draw() {
      host.innerHTML = "";
      host.classList.add("mvp-chart");
      cells = {};
      var W = Math.max(host.clientWidth || 720, 520);
      var left = 36, top = 36, gap = 2, ch = 24;
      var cw = (W - left - 4) / years.length;
      var H = top + 12 * ch + 4;
      var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": opts.label || "Months by year" }, host);
      addHatch(s, id);
      for (var m = 1; m <= 12; m++) svg("text", { x: left - 6, y: top + (m - 1) * ch + ch / 2 + 4, "text-anchor": "end" }, s).textContent = MONTHS_SHORT[m - 1];
      years.forEach(function (y, i) {
        if (cw >= 24 || i % 2 === 0) svg("text", { x: left + i * cw + cw / 2, y: top - 8, "text-anchor": "middle" }, s).textContent = cw >= 24 ? String(y).slice(2) : y;
      });
      years.forEach(function (y, i) {
        for (var mo = 1; mo <= 12; mo++) {
          var r = byKey[y * 100 + mo];
          var x = left + i * cw;
          var yy = top + (mo - 1) * ch;
          if (!r) {
            svg("rect", { x: x, y: yy, width: cw - gap, height: ch - gap, rx: 3, fill: "none", stroke: cssVar("--line"), "stroke-dasharray": "2 3" }, s);
            continue;
          }
          var g = svg("g", { class: "cal-cell" + (selected === r.key ? " selected" : ""), tabindex: "0", role: "button", "aria-label": cellLabel(r) }, s);
          var shown = r.status === "ok";
          var fill = shown ? classColor(r.cls || "normal") : null;
          var box = svg("rect", { class: "cal-box" + (shown ? "" : " prov-box"), x: x, y: yy, width: cw - gap, height: ch - gap, rx: 3 }, g);
          if (shown) box.setAttribute("fill", fill);
          if (r.status === "insufficient_data") { box.classList.remove("prov-box"); box.setAttribute("fill", "none"); box.setAttribute("stroke", cssVar("--muted")); }
          if (shown && r.method === "modelled_aqua" && r.flag === "indicative_only") box.setAttribute("fill-opacity", "0.45");
          if (r.method === "modelled_aqua" && r.status !== "insufficient_data") svg("rect", { x: x, y: yy, width: cw - gap, height: ch - gap, rx: 3, fill: "url(#" + id + ")", "pointer-events": "none" }, g);
          var mark = r.status === "provisional" || r.status === "incomplete" ? "P" : r.status === "insufficient_data" ? "n/a" : (r.method === "modelled_aqua" ? FLAG_MARK[r.flag] : "");
          if (mark) {
            var t = svg("text", { x: x + (cw - gap) / 2, y: yy + ch / 2 + 3, "text-anchor": "middle" }, g);
            t.textContent = mark;
            if (shown) t.style.fill = textOn(fill);
          }
          cells[r.key] = { g: g, r: r };
          (function (row, node) {
            node.addEventListener("click", function () { choose(row.key, true); });
            node.addEventListener("keydown", function (e) {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(row.key, true); return; }
              var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
              if (!d) return;
              e.preventDefault();
              var ny = row.year + d[0], nm = row.month + d[1];
              if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; }
              var next = cells[ny * 100 + nm];
              if (next) next.g.focus();
            });
            var tip = function (ev) {
              var rows2 = [{ label: "Detections", value: row.value === null ? "no estimate" : formatNumber(row.value) }];
              if (row.low !== null && row.method === "modelled_aqua") rows2.push({ label: "Likely range", value: formatNumber(row.low) + " – " + formatNumber(row.high) });
              if (row.status === "ok") rows2.push({ label: "Compared with usual", value: formatRatio(row.ratio) + " · " + (CLASS_LABEL[row.cls] || "") });
              Tip.show({ title: monthLabel(row.year, row.month), rows: rows2, note: statusText(row) || (METHOD[row.method] || {}).label }, ev.clientX, ev.clientY);
            };
            node.addEventListener("mousemove", tip);
            node.addEventListener("mouseleave", function () { Tip.hide(); });
            node.addEventListener("focus", function () { Tip.showAt({ title: monthLabel(row.year, row.month), rows: [{ label: "Detections", value: row.value === null ? "no estimate" : formatNumber(row.value) }], note: statusText(row) || (METHOD[row.method] || {}).label }, node); });
            node.addEventListener("blur", function () { Tip.hide(); });
          })(r, g);
        }
      });
      var i12 = years.indexOf(2012);
      if (i12 > -1) {
        svg("line", { x1: left + i12 * cw - 1, x2: left + i12 * cw - 1, y1: top - 4, y2: H - 2, stroke: cssVar("--ink-2"), "stroke-width": 1.5 }, s);
        var lab = svg("text", { x: left + i12 * cw + 4, y: 10, "text-anchor": "start" }, s);
        lab.style.fill = cssVar("--ink-2"); lab.style.fontWeight = 650;
        lab.textContent = "VIIRS measured from here →";
      }
    }

    function choose(key, fire) {
      selected = key;
      Object.keys(cells).forEach(function (k) { cells[k].g.classList.toggle("selected", Number(k) === key); });
      if (fire && opts.onSelect) opts.onSelect(byKey[key]);
    }

    autoRender(host, draw);
    return { select: function (key) { choose(key, true); }, mark: function (key) { choose(key, false); } };
  }

  function calendarKey(host) {
    host.className = "key-row";
    var sw = function (inner) { return "<svg width='20' height='14' viewBox='0 0 20 14' aria-hidden='true'>" + inner + "</svg>"; };
    var hid = "keyhatch" + (++uid);
    var def = "<defs><pattern id='" + hid + "' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><line x1='0' y1='0' x2='0' y2='6' class='hatch-line'/></pattern></defs>";
    var parts = CLASS_ORDER.map(function (c) {
      return "<span class='k'>" + sw("<rect width='20' height='14' rx='3' fill='" + classColor(c) + "'/>") + CLASS_LABEL[c] + "</span>";
    });
    parts.push("<span class='k'>" + sw(def + "<rect width='20' height='14' rx='3' fill='" + classColor("normal") + "'/><rect width='20' height='14' rx='3' fill='url(#" + hid + ")'/>") + "Hatched: converted from MODIS</span>");
    parts.push("<span class='k'>" + sw("<rect x='1' y='1' width='18' height='12' rx='3' fill='none' stroke='" + cssVar("--ink-2") + "' stroke-dasharray='3 2' stroke-width='1.4'/>") + "P: provisional, no comparison</span>");
    parts.push("<span class='k'><b>!</b> caution · <b>?</b> indicative only</span>");
    host.innerHTML = parts.join("");
  }

  // ----- time series -----
  // spec: { lines: [{ name, color, points: [{ x, y, low, high, kind, title, rows }] }], log, height, vlines: [{ x, label }],
  //         shade: true, label }

  function seriesChart(host, spec) {
    var id = "hatch" + (++uid);
    function draw() {
      host.innerHTML = "";
      host.classList.add("mvp-chart");
      var W = Math.max(host.clientWidth || 720, 360);
      var H = spec.height || 320;
      var m = { l: 58, r: 12, t: 16, b: 28 };
      var pw = W - m.l - m.r, ph = H - m.t - m.b;
      var all = [];
      spec.lines.forEach(function (ln) { ln.points.forEach(function (p) { all.push(p); }); });
      var xs = all.map(function (p) { return p.x; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs) + 1 / 12;
      var ymax = Math.max.apply(null, all.map(function (p) { return Math.max(p.y || 0, p.high || 0); })) * 1.05;
      var X = function (v) { return m.l + (v - x0) / (x1 - x0) * pw; };
      var Y, ticks;
      if (spec.log) {
        var ymin = Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, all.filter(function (p) { return p.y > 0; }).map(function (p) { return p.y; })))));
        var ymaxL = Math.pow(10, Math.ceil(Math.log10(ymax)));
        Y = function (v) { return m.t + ph - (Math.log10(Math.max(v, ymin)) - Math.log10(ymin)) / (Math.log10(ymaxL) - Math.log10(ymin)) * ph; };
        ticks = []; for (var e = Math.log10(ymin); e <= Math.log10(ymaxL) + 0.001; e++) ticks.push(Math.pow(10, e));
      } else {
        ticks = niceTicks(ymax, 4);
        var top = ticks[ticks.length - 1];
        Y = function (v) { return m.t + ph - v / top * ph; };
      }
      var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": spec.label || "Time series" }, host);
      addHatch(s, id);
      ticks.forEach(function (t) {
        svg("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "gridline" }, s);
        svg("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }, s).textContent = formatCompact(t);
      });
      var step = pw / (x1 - x0) > 40 ? 1 : 2;
      for (var yr = Math.ceil(x0); yr <= x1; yr += step) {
        svg("text", { x: X(yr), y: H - 8, "text-anchor": "middle" }, s).textContent = yr;
      }
      svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph, class: "axis" }, s);

      // background spans: converted (hatched) and provisional (dashed)
      var first = spec.lines[0].points;
      function spans(kind) {
        var out = [], cur = null;
        first.forEach(function (p) {
          if (p.kind === kind) { if (!cur) { cur = { a: p.x, b: p.x }; out.push(cur); } cur.b = p.x; } else cur = null;
        });
        return out;
      }
      if (spec.shade !== false) {
        spans("modelled").forEach(function (sp) {
          svg("rect", { x: X(sp.a), y: m.t, width: X(sp.b + 1 / 12) - X(sp.a), height: ph, fill: "url(#" + id + ")", opacity: 0.22 }, s);
        });
        spans("provisional").forEach(function (sp) {
          svg("rect", { x: X(sp.a), y: m.t, width: Math.max(X(sp.b + 1 / 12) - X(sp.a), 3), height: ph, fill: "none", stroke: cssVar("--ink-2"), "stroke-dasharray": "3 2" }, s);
        });
      }
      (spec.vlines || []).forEach(function (v) {
        svg("line", { x1: X(v.x), x2: X(v.x), y1: m.t, y2: m.t + ph, stroke: cssVar("--ink-2"), "stroke-width": 1.2, "stroke-dasharray": "4 3" }, s);
        var t = svg("text", { x: X(v.x) + 4, y: m.t + 11, "text-anchor": "start" }, s);
        t.textContent = v.label; t.style.fill = cssVar("--ink-2"); t.style.fontWeight = 650;
      });

      spec.lines.forEach(function (ln) {
        // likely-range band for converted months
        var run = [];
        function flush() {
          if (run.length > 1) {
            var d = run.map(function (p, i) { return (i ? "L" : "M") + X(p.x) + "," + Y(p.high); }).join("") +
              run.slice().reverse().map(function (p) { return "L" + X(p.x) + "," + Y(p.low); }).join("") + "Z";
            svg("path", { d: d, fill: ln.color, opacity: 0.2 }, s);
          }
          run = [];
        }
        ln.points.forEach(function (p) {
          if (p.kind === "modelled" && !isMissing(p.low)) run.push(p); else flush();
        });
        flush();
        for (var i = 1; i < ln.points.length; i++) {
          var a = ln.points[i - 1], b = ln.points[i];
          if (isMissing(a.y) || isMissing(b.y)) continue;
          svg("line", { x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y), stroke: b.color || ln.color, "stroke-width": 1.7,
            "stroke-dasharray": b.kind === "provisional" ? "2 3" : null, "stroke-linecap": "round" }, s);
        }
        ln.points.forEach(function (p) {
          if (p.kind === "provisional" && !isMissing(p.y)) svg("circle", { cx: X(p.x), cy: Y(p.y), r: 3, fill: cssVar("--surface"), stroke: p.color || ln.color, "stroke-width": 1.5 }, s);
        });
      });

      var guide = svg("line", { y1: m.t, y2: m.t + ph, stroke: cssVar("--ink-2"), "stroke-width": 1, visibility: "hidden" }, s);
      var overlay = svg("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "transparent" }, s);
      overlay.addEventListener("mousemove", function (ev) {
        var box = overlay.getBoundingClientRect();
        var xv = x0 + (ev.clientX - box.left) / box.width * (x1 - x0);
        var idx = Math.max(0, Math.min(first.length - 1, Math.round((xv - first[0].x) * 12)));
        var p = first[idx];
        guide.setAttribute("x1", X(p.x)); guide.setAttribute("x2", X(p.x)); guide.setAttribute("visibility", "visible");
        var rows = [];
        spec.lines.forEach(function (ln) {
          var q = ln.points[idx];
          if (q) rows.push({ label: ln.name, value: isMissing(q.y) ? "not included" : formatNumber(q.y), color: q.color || ln.color, kind: "line" });
        });
        if (!isMissing(p.low) && p.kind === "modelled") rows.push({ label: "Likely range", value: formatNumber(p.low) + " – " + formatNumber(p.high) });
        Tip.show({ title: p.title, rows: rows, note: p.note }, ev.clientX, ev.clientY);
      });
      overlay.addEventListener("mouseleave", function () { guide.setAttribute("visibility", "hidden"); Tip.hide(); });
    }
    return autoRender(host, draw);
  }

  // ----- year bars -----
  // spec: { bars: [{ label, value, low, high, kind: "observed"|"modelled"|"mixed"|"partial", color, title, note }],
  //         vline: { before: label, text }, height, label }

  function yearBars(host, spec) {
    var id = "hatch" + (++uid);
    function draw() {
      host.innerHTML = "";
      host.classList.add("mvp-chart");
      var W = Math.max(host.clientWidth || 720, 360);
      var H = spec.height || 320;
      var m = { l: 52, r: 8, t: 18, b: 34 };
      var pw = W - m.l - m.r, ph = H - m.t - m.b;
      var n = spec.bars.length;
      var vmax = Math.max.apply(null, spec.bars.map(function (b) { return Math.max(b.value || 0, b.high || 0); }));
      var ticks = niceTicks(vmax * 1.04, 4);
      var top = ticks[ticks.length - 1];
      var Y = function (v) { return m.t + ph - v / top * ph; };
      var bw = pw / n;
      var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": spec.label || "Yearly totals" }, host);
      addHatch(s, id);
      ticks.forEach(function (tk) {
        svg("line", { x1: m.l, x2: W - m.r, y1: Y(tk), y2: Y(tk), class: "gridline" }, s);
        svg("text", { x: m.l - 6, y: Y(tk) + 4, "text-anchor": "end" }, s).textContent = formatCompact(tk);
      });
      svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph, class: "axis" }, s);
      spec.bars.forEach(function (b, i) {
        var x = m.l + i * bw + bw * 0.12, w = bw * 0.76;
        var g = svg("g", { tabindex: "0", role: "img", "aria-label": b.title + ": " + formatNumber(b.value) + " detections. " + (b.note || "") }, s);
        var h = Math.max(0, m.t + ph - Y(b.value || 0));
        if (b.kind === "partial") {
          svg("rect", { x: x, y: Y(b.value || 0), width: w, height: h, fill: "none", stroke: cssVar("--ink-2"), "stroke-dasharray": "3 2", "stroke-width": 1.4 }, g);
        } else {
          svg("rect", { x: x, y: Y(b.value || 0), width: w, height: h, fill: b.color, rx: 2 }, g);
          if (b.kind === "modelled" || b.kind === "mixed") svg("rect", { x: x, y: Y(b.value || 0), width: w, height: h, fill: "url(#" + id + ")", rx: 2 }, g);
          if (!isMissing(b.low) && b.kind !== "observed") {
            var cx = x + w / 2;
            svg("line", { x1: cx, x2: cx, y1: Y(b.low), y2: Y(b.high), stroke: cssVar("--ink"), "stroke-width": 1.3 }, g);
            svg("line", { x1: cx - 3, x2: cx + 3, y1: Y(b.low), y2: Y(b.low), stroke: cssVar("--ink"), "stroke-width": 1.3 }, g);
            svg("line", { x1: cx - 3, x2: cx + 3, y1: Y(b.high), y2: Y(b.high), stroke: cssVar("--ink"), "stroke-width": 1.3 }, g);
          }
        }
        if (bw >= 22 || i % 2 === 0) svg("text", { x: x + w / 2, y: H - 14, "text-anchor": "middle" }, s).textContent = bw >= 22 ? String(b.label).slice(2) : b.label;
        g.addEventListener("mousemove", function (ev) {
          var rows = [{ label: "Detections", value: formatNumber(b.value) }];
          if (!isMissing(b.low) && b.kind !== "observed") rows.push({ label: "Likely range", value: formatNumber(b.low) + " – " + formatNumber(b.high) });
          Tip.show({ title: b.title, rows: rows, note: b.note }, ev.clientX, ev.clientY);
        });
        g.addEventListener("mouseleave", function () { Tip.hide(); });
        g.addEventListener("focus", function () { Tip.showAt({ title: b.title, rows: [{ label: "Detections", value: formatNumber(b.value) }], note: b.note }, g); });
        g.addEventListener("blur", function () { Tip.hide(); });
      });
      if (spec.vline) {
        var idx = spec.bars.map(function (b) { return b.label; }).indexOf(spec.vline.before);
        if (idx > -1) {
          var vx = m.l + idx * bw;
          svg("line", { x1: vx, x2: vx, y1: m.t - 4, y2: m.t + ph, stroke: cssVar("--ink-2"), "stroke-width": 1.2, "stroke-dasharray": "4 3" }, s);
          var tx = svg("text", { x: vx + 5, y: m.t + 9, "text-anchor": "start" }, s);
          tx.textContent = spec.vline.text; tx.style.fill = cssVar("--ink-2"); tx.style.fontWeight = 650;
        }
      }
    }
    return autoRender(host, draw);
  }

  // ----- reliability lookup (gold_reliability rows) -----

  function reliabilityFor(relRows, aqua) {
    var sorted = relRows.slice().sort(function (a, b) { return a.aqua_min - b.aqua_min; });
    var hit = sorted[0];
    sorted.forEach(function (r) { if (aqua >= r.aqua_min) hit = r; });
    return hit;
  }

  function suggestionFor(relRows, flag) {
    var r = relRows.filter(function (x) { return x.reliability === flag; })[0];
    return r ? r.suggestion : "";
  }

  // ----- selected-month panel -----
  // ctx: { name, baselineLabel, relRows }

  function detailPanel(host, r, ctx) {
    host.innerHTML = "";
    if (!r) { host.appendChild(el("h2", { text: "Select a month" })); host.appendChild(el("p", { class: "small muted", text: "Click a square in the calendar." })); return; }
    host.appendChild(el("p", { class: "eyebrow", text: ctx.name }));
    host.appendChild(el("h2", { text: monthLabel(r.year, r.month) }));
    var big = el("div", { class: "big", text: r.value === null ? "No estimate" : formatNumber(r.value) });
    if (r.value !== null) big.appendChild(el("span", { class: "unit", text: "detections" }));
    host.appendChild(big);
    host.appendChild(el("div", { style: "margin-top:0.4rem" }, [methodBadge(r.method)]));
    if (r.status === "provisional" || r.status === "incomplete") {
      host.appendChild(el("div", { class: "notice provisional", text: statusText(r) + " The value may change when science-quality data replaces it." }));
    } else if (r.status === "insufficient_data") {
      host.appendChild(el("div", { class: "notice warn", text: statusText(r) + " VIIRS would usually have seen a few fires, so this is not zero." }));
    }
    var dl = el("dl");
    function item(t, v, help) {
      dl.appendChild(el("div", null, [el("dt", { text: t }), el("dd", typeof v === "string" ? { text: v } : {}, typeof v === "string" ? [] : [v]), help ? el("dd", { class: "help", text: help }) : null]));
    }
    if (r.method === "modelled_aqua" && r.low !== null) {
      item("Likely range", formatNumber(r.low) + " – " + formatNumber(r.high), "About an 85% chance of containing the true VIIRS-equivalent value (tested on years the method had not seen).");
      var fl = el("span", null, [flagBadge(r.flag)]);
      item("Reliability for this area and month", fl, suggestionFor(ctx.relRows || [], r.flag));
    } else if (r.method === "observed_viirs") {
      item("Reliability", "Measured directly by VIIRS, reliable at any area size.");
    }
    if (r.status === "ok") {
      var tiny = r.ratio > 10 || r.median < 200;
      item("Compared with usual", formatRatio(r.ratio) + " · " + (CLASS_LABEL[r.cls] || ""), "Usual = " + ctx.baselineLabel + ": " + formatNumber(r.median) + " detections for this calendar month." +
        (tiny ? " The usual level is small here, so the ratio can look huge. The rank below is the clearer read." : ""));
      if (r.stable === false) item("Class certainty", "The likely range spans more than one class.", "Treat the colour as approximate.");
      if (r.rank !== null && r.rank !== undefined) item("Rank in this calendar month", ordinal(r.rank) + " of " + r.nRanked + " " + MONTHS[r.month - 1] + "s", "1st = busiest. Percentile " + Math.round(r.percentile) + ", among every complete year on file.");
    } else if (r.status === "provisional" || r.status === "incomplete") {
      item("Compared with usual", "Not shown yet");
    }
    if (!isMissing(r.coverage)) item("Days with valid satellite data", Math.round(r.coverage * 100) + "%");
    host.appendChild(dl);
  }

  // ----- data loading -----

  function loadTables(names, banner) {
    return Promise.all(names.map(function (n) { return fetchGold(n); })).then(function (list) {
      var out = {};
      names.forEach(function (n, i) { out[n] = list[i]; });
      if (banner) {
        var notLive = list.filter(function (d) { return d.source !== "r2"; });
        showBanner(banner, notLive.length ? notLive[0] : list[0]);
        if (!notLive.length) banner.innerHTML = "";   // live data: no banner (an empty banner is hidden by the CSS)
      }
      return out;
    }).catch(function (err) {
      showOffline(banner);
      throw err;
    });
  }

  function docLink(file, text) {
    return "<a href='" + DOCS_BASE + file + "' target='_blank' rel='noopener'>" + text + "</a>";
  }

  return {
    METHOD: METHOD, FLAG_LABEL: FLAG_LABEL, UNIT: UNIT,
    classify: classify, methodBadge: methodBadge, flagBadge: flagBadge, pct: pct, norm: norm, statusText: statusText,
    calendarGrid: calendarGrid, calendarKey: calendarKey, seriesChart: seriesChart, yearBars: yearBars, detailPanel: detailPanel,
    reliabilityFor: reliabilityFor, suggestionFor: suggestionFor, loadTables: loadTables, docLink: docLink,
  };
})();
