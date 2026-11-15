// POST /api/chat   body: { messages: [{ role: "user" | "model", text: "..." }, ...] }
//                  reply: { reply: "...", lookups: [{ label, href }] }  or  { error: "..." } with a non-200 status
//
// Calls Gemini (Google AI Studio REST API) with the project notes in web/chat_context.txt as the system prompt, and
// three lookup tools that read publish/chat_lookup.json (built by scripts/export_calendar.py from the gold tables):
//   get_month(region, year, month), get_year(region, year), top_months(region, n)
// The tools enforce the honesty rules in code: provisional and in-progress months never get a comparison, rank or
// percentile; ratios above 10 are shown as "more than 10x"; unknown months return an error, never a guess.
//
// Secrets (Pages project -> Settings -> Variables and Secrets, on Production AND Preview):
//   GEMINI_API_KEY   required. Never commit it; the browser never sees it.
//   GEMINI_MODEL     optional. Defaults to the cheapest listed model (docs/gemini_models.md).
// R2 binding FIRMS (same as /api/gold) supplies chat_lookup.json.
//
// Local preview: scripts/dev_server.py mirrors this route and the tools in Python. KEEP THE TWO IN STEP.

var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

var MAX_TURNS = 20;          // messages kept per request
var MAX_CHARS = 1500;        // per message
var MAX_OUTPUT_TOKENS = 900;
var MAX_TOOL_ROUNDS = 3;     // model <-> tool round trips per question
var TIMEOUT_MS = 25000;      // whole request, all rounds
var RATE_LIMIT = 12;         // requests per IP per window, per isolate (best effort, not a guarantee)
var RATE_WINDOW_MS = 60 * 1000;
var LOOKUP_TTL_MS = 10 * 60 * 1000;

var hits = new Map();        // ip -> [timestamps]
var contextCache = null;     // system prompt text, read once per isolate
var lookupCache = null;      // { at, index } for chat_lookup.json

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var REGION_IDS = ["argentina", "ar_ne", "ar_nw", "ar_c", "ar_s", "ar_delta"];
var CLASS_TEXT = { much_below: "much below usual", below: "below usual", normal: "normal", above: "above usual", much_above: "much above usual" };
var METHOD_TEXT = {
  observed_viirs: "measured by VIIRS",
  modelled_aqua: "converted from MODIS Aqua to the VIIRS scale",
  provisional_nrt: "provisional (near-real-time VIIRS, can still change)",
  insufficient_data: "no estimate (too few MODIS detections to convert)",
  mixed: "built from more than one source (converted MODIS months, measured VIIRS months, or months with no estimate)",
};

var TOOLS = [{
  functionDeclarations: [
    {
      name: "get_month",
      description: "Look up one calendar month for one region: detections (VIIRS-equivalent), whether it was measured or converted, likely range and reliability flag for converted months, and the comparison with a usual month (only when it exists).",
      parameters: {
        type: "OBJECT",
        properties: {
          region: { type: "STRING", enum: REGION_IDS, description: "argentina = whole country; ar_ne north-east; ar_nw north-west and western Chaco; ar_c centre; ar_s Patagonia; ar_delta Parana Delta box" },
          year: { type: "INTEGER", description: "2003 or later" },
          month: { type: "INTEGER", description: "1 to 12" },
        },
        required: ["region", "year", "month"],
      },
    },
    {
      name: "get_year",
      description: "Look up one calendar year for one region: total detections, how it was made, rank among years, peak month and season.",
      parameters: {
        type: "OBJECT",
        properties: { region: { type: "STRING", enum: REGION_IDS }, year: { type: "INTEGER" } },
        required: ["region", "year"],
      },
    },
    {
      name: "top_months",
      description: "The busiest months on record for one region (provisional months are left out).",
      parameters: {
        type: "OBJECT",
        properties: { region: { type: "STRING", enum: REGION_IDS }, n: { type: "INTEGER", description: "1 to 5, default 5" } },
        required: ["region"],
      },
    },
  ],
}];

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function tooMany(ip) {
  var now = Date.now();
  var list = (hits.get(ip) || []).filter(function (t) { return now - t < RATE_WINDOW_MS; });
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return false;
}

// Only accept calls from pages on this same site (blocks other websites from spending our quota from a browser).
function sameOrigin(request) {
  var origin = request.headers.get("origin");
  if (!origin) return true; // non-browser callers (curl, tests)
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (err) {
    return false;
  }
}

function clean(messages) {
  if (!Array.isArray(messages)) return null;
  var out = [];
  messages.slice(-MAX_TURNS).forEach(function (m) {
    if (!m || (m.role !== "user" && m.role !== "model") || typeof m.text !== "string") return;
    var text = m.text.trim().slice(0, MAX_CHARS);
    if (!text) return;
    var last = out[out.length - 1];
    if (last && last.role === m.role) last.parts[0].text += "\n" + text; // Gemini wants alternating roles
    else out.push({ role: m.role, parts: [{ text: text }] });
  });
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

async function loadContext(context) {
  if (contextCache) return contextCache;
  var url = new URL("/chat_context.txt", context.request.url);
  var response = await context.env.ASSETS.fetch(new Request(url));
  if (!response.ok) throw new Error("context missing");
  contextCache = await response.text();
  return contextCache;
}

// ---------- lookup data ----------

function objectsFrom(cols, rows) {
  return rows.map(function (row) {
    var o = {};
    cols.forEach(function (c, i) { o[c] = row[i]; });
    return o;
  });
}

async function loadLookup(env) {
  var now = Date.now();
  if (lookupCache && now - lookupCache.at < LOOKUP_TTL_MS) return lookupCache.index;
  if (!env.FIRMS || typeof env.FIRMS.get !== "function") return null;
  var object = await env.FIRMS.get("publish/chat_lookup.json");
  if (!object) return null;
  var data = await object.json();
  var index = { regions: data.regions || {}, advice: data.advice || {}, months: {}, years: {}, last: 0 };
  objectsFrom(data.month_cols, data.months).forEach(function (r) {
    index.months[r.region + "|" + r.year + "|" + r.month] = r;
    index.last = Math.max(index.last, r.year * 100 + r.month);
  });
  objectsFrom(data.year_cols, data.years).forEach(function (r) { index.years[r.region + "|" + r.year] = r; });
  index.list = objectsFrom(data.month_cols, data.months);
  lookupCache = { at: now, index: index };
  return index;
}

// ---------- tools ----------

function ordinal(n) {
  var v = n % 100;
  return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th");
}

function ratioText(r) {
  return r > 10 ? "more than 10x" : (Math.round(r * 100) / 100) + "x";
}

function monthLabel(y, m) { return MONTHS[m - 1] + " " + y; }

function lastLabel(L) { return monthLabel(Math.floor(L.last / 100), L.last % 100); }

function validRegion(L, region) { return typeof region === "string" && Object.prototype.hasOwnProperty.call(L.regions, region); }

function monthTool(L, args, lookups) {
  var region = args.region, year = Math.trunc(Number(args.year)), month = Math.trunc(Number(args.month));
  if (!validRegion(L, region)) return { error: "unknown_region", valid_regions: Object.keys(L.regions) };
  var r = L.months[region + "|" + year + "|" + month];
  if (!r) return { error: "no_data", note: "No estimate on file for that month. The calendar covers January 2003 to " + lastLabel(L) + ".", data_through: lastLabel(L) };
  lookups.push({ label: L.regions[region] + ", " + monthLabel(year, month), href: "regions.html?region=" + region + "&year=" + year + "&month=" + month });
  var out = {
    region: L.regions[region],
    month: monthLabel(year, month),
    method: METHOD_TEXT[r.method] || r.method,
    unit: "VIIRS-equivalent fire detections",
    detections: r.value === null ? null : Math.round(r.value),
    share_of_days_with_valid_satellite_data: r.coverage === null ? null : Math.round(r.coverage * 100) + "%",
  };
  if (r.method === "modelled_aqua") {
    out.likely_range = [Math.round(r.low), Math.round(r.high)];
    out.likely_range_meaning = "about an 85% chance the true VIIRS-equivalent value lies in this range (tested on years the method had not seen)";
    out.reliability = r.flag;
    out.reliability_advice = L.advice[r.flag] || "";
  } else if (r.method === "observed_viirs") {
    out.reliability = "reliable (measured directly, any area size)";
  }
  if (r.status === "ok" && r.ratio !== null && r.cls) {
    out.comparison = {
      compared_with_usual: ratioText(r.ratio),
      class: CLASS_TEXT[r.cls] || r.cls,
      usual_detections_for_this_calendar_month: Math.round(r.median),
      usual_means: "median of the same calendar month, 2003 to 2022",
      rank: ordinal(r.rank) + " of " + r.n_ranked + " " + MONTHS[month - 1] + "s (1st = busiest)",
      percentile: Math.round(r.percentile),
    };
    if (r.ratio > 10 || r.median < 200) out.comparison.note = "The usual level is small here, so the ratio can look huge. Lead with the rank.";
  } else if (r.status === "provisional") {
    out.comparison = { status: "not_compared", reason: "Provisional near-real-time data. It can still change, so it is not compared with earlier years." };
  } else if (r.status === "incomplete") {
    out.comparison = { status: "not_compared", reason: "The month is still in progress, so it is not compared with earlier years." };
  } else {
    out.comparison = { status: "not_compared", reason: "No estimate for this month in this region." };
  }
  return out;
}

function yearTool(L, args, lookups) {
  var region = args.region, year = Math.trunc(Number(args.year));
  if (!validRegion(L, region)) return { error: "unknown_region", valid_regions: Object.keys(L.regions) };
  var r = L.years[region + "|" + year];
  if (!r) return { error: "no_data", note: "No yearly figure on file. The calendar covers 2003 to " + Math.floor(L.last / 100) + ".", data_through: lastLabel(L) };
  lookups.push({ label: L.regions[region] + ", " + year, href: "regions.html?region=" + region });
  var out = {
    region: L.regions[region], year: year, unit: "VIIRS-equivalent fire detections",
    total_detections: r.total === null ? null : Math.round(r.total),
    method: METHOD_TEXT[r.method] || r.method,
    peak_month: r.peak_month ? MONTHS[r.peak_month - 1] : null,
    season_from_10_to_90_percent_of_the_year: r.season_start && r.season_end ? MONTHS[r.season_start - 1] + " to " + MONTHS[r.season_end - 1] : null,
  };
  if (r.method === "modelled_aqua" || r.method === "mixed") out.likely_range = [Math.round(r.low), Math.round(r.high)];
  if (r.is_complete && r.rank) {
    out.rank = ordinal(r.rank) + " of " + r.n_ranked + " complete years (1st = busiest)";
    if (r.ratio !== null) out.compared_with_usual_year = ratioText(r.ratio);
  } else {
    out.note = r.is_partial ? "Partial year: some months are in progress, provisional, or have no estimate, so the total is incomplete and is not ranked." : "Year not complete, so it is not ranked.";
  }
  return out;
}

function topTool(L, args, lookups) {
  var region = args.region;
  var n = Math.min(5, Math.max(1, Math.trunc(Number(args.n)) || 5));
  if (!validRegion(L, region)) return { error: "unknown_region", valid_regions: Object.keys(L.regions) };
  var rows = L.list.filter(function (r) {
    return r.region === region && r.status === "ok" && r.value !== null && (r.method === "modelled_aqua" || r.method === "observed_viirs");
  }).sort(function (a, b) { return b.value - a.value; }).slice(0, n);
  lookups.push({ label: L.regions[region] + ", busiest months", href: "regions.html?region=" + region });
  return {
    region: L.regions[region], unit: "VIIRS-equivalent fire detections", note: "Provisional months are left out.",
    busiest_months: rows.map(function (r) { return { month: monthLabel(r.year, r.month), detections: Math.round(r.value), method: METHOD_TEXT[r.method] }; }),
  };
}

async function runTool(env, name, args, lookups) {
  var L;
  try { L = await loadLookup(env); } catch (err) { L = null; }
  if (!L) return { error: "lookup_unavailable", note: "The data lookup is not available right now." };
  args = args && typeof args === "object" ? args : {};
  if (name === "get_month") return monthTool(L, args, lookups);
  if (name === "get_year") return yearTool(L, args, lookups);
  if (name === "top_months") return topTool(L, args, lookups);
  return { error: "unknown_tool" };
}

// ---------- Gemini ----------

function uniqueLookups(list) {
  var seen = {}, out = [];
  list.forEach(function (l) { if (!seen[l.href] && out.length < 3) { seen[l.href] = true; out.push(l); } });
  return out;
}

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env || {};

  if (!sameOrigin(request)) return json({ error: "Not allowed from this origin." }, 403);
  if (!env.GEMINI_API_KEY) {
    return json({ error: "The assistant is not set up on this site yet (no API key)." }, 503);
  }
  if (tooMany(request.headers.get("cf-connecting-ip") || "unknown")) {
    return json({ error: "Too many questions in a short time. Please wait a minute and try again." }, 429);
  }

  var body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Bad request." }, 400);
  }
  var contents = clean(body && body.messages);
  if (!contents) return json({ error: "Send at least one question." }, 400);

  var system;
  try {
    system = await loadContext(context);
  } catch (err) {
    return json({ error: "The assistant notes are missing on the server." }, 500);
  }

  var model = env.GEMINI_MODEL || DEFAULT_MODEL;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  var lookups = [];
  var candidate = null;
  try {
    for (var round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      var payload = {
        systemInstruction: { parts: [{ text: system }] },
        contents: contents,
        tools: TOOLS,
        // on the last round tools are switched off so the model has to write the answer
        toolConfig: { functionCallingConfig: { mode: round === MAX_TOOL_ROUNDS ? "NONE" : "AUTO" } },
        generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
      };
      var upstream;
      for (var attempt = 0; attempt < 2; attempt++) {
        upstream = await fetch(API_BASE + encodeURIComponent(model) + ":generateContent", {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(payload),
        });
        // a busy or overloaded model usually answers on a second try
        if (upstream.ok || [429, 500, 503].indexOf(upstream.status) === -1) break;
        await new Promise(function (resolve) { setTimeout(resolve, 1500); });
      }
      if (!upstream.ok) {
        // Do not pass Google's error text to the browser; it can name the project or the key.
        var status = upstream.status === 429 ? 429 : 502;
        return json({ error: status === 429 ? "The assistant is busy. Please try again in a minute." : "The assistant had a problem. Please try again." }, status);
      }
      var data;
      try {
        data = await upstream.json();
      } catch (err) {
        return json({ error: "The assistant sent an unreadable reply." }, 502);
      }
      candidate = data && data.candidates && data.candidates[0];
      var parts = candidate && candidate.content && candidate.content.parts;
      var calls = Array.isArray(parts) ? parts.filter(function (p) { return p && p.functionCall; }) : [];
      if (!calls.length) break;
      // Echo the model turn back unchanged (keeps any thought signatures), then answer every call.
      contents.push(candidate.content);
      var answers = [];
      for (var i = 0; i < calls.length; i++) {
        var fc = calls[i].functionCall;
        var result = await runTool(env, fc.name, fc.args, lookups);
        answers.push({ functionResponse: { name: fc.name, response: { result: result } } });
      }
      contents.push({ role: "user", parts: answers });
    }
  } catch (err) {
    return json({ error: err && err.name === "AbortError" ? "The assistant took too long. Please try again." : "Could not reach the assistant. Please try again." }, 504);
  } finally {
    clearTimeout(timer);
  }

  var finalParts = candidate && candidate.content && candidate.content.parts;
  var text = Array.isArray(finalParts)
    ? finalParts.filter(function (p) { return p && typeof p.text === "string" && !p.thought; }).map(function (p) { return p.text; }).join("").trim()
    : "";
  if (!text) {
    return json({ error: "I could not answer that one. Try rephrasing the question." }, 502);
  }
  if (candidate.finishReason === "MAX_TOKENS") text += "\n\n(Answer cut short. Ask me to continue if you want more.)";
  return json({ reply: text, lookups: uniqueLookups(lookups) });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "Use POST." }, 405);
}
