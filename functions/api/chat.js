// POST /api/chat   body: { messages: [{ role: "user" | "model", text: "..." }, ...] }
//                  reply: { reply: "..." }  or  { error: "..." } with a non-200 status
//
// Calls Gemini (Google AI Studio REST API) with the project notes in web/chat_context.txt as the system prompt.
//
// Secrets (Pages project -> Settings -> Variables and Secrets, on Production AND Preview):
//   GEMINI_API_KEY   required. Never commit it; the browser never sees it.
//   GEMINI_MODEL     optional. Defaults to the cheapest listed model (docs/gemini_models.md).
//
// Local preview: scripts/dev_server.py mirrors this route and reads the key from .env.

var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

var MAX_TURNS = 20;          // messages kept per request
var MAX_CHARS = 1500;        // per message
var MAX_OUTPUT_TOKENS = 700;
var TIMEOUT_MS = 25000;
var RATE_LIMIT = 12;         // requests per IP per window, per isolate (best effort, not a guarantee)
var RATE_WINDOW_MS = 60 * 1000;

var hits = new Map();        // ip -> [timestamps]
var contextCache = null;     // system prompt text, read once per isolate

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
  var upstream;
  try {
    upstream = await fetch(API_BASE + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: contents,
        generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
    });
  } catch (err) {
    return json({ error: err && err.name === "AbortError" ? "The assistant took too long. Please try again." : "Could not reach the assistant. Please try again." }, 504);
  } finally {
    clearTimeout(timer);
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
  var candidate = data && data.candidates && data.candidates[0];
  var parts = candidate && candidate.content && candidate.content.parts;
  var text = Array.isArray(parts)
    ? parts.filter(function (p) { return p && typeof p.text === "string" && !p.thought; }).map(function (p) { return p.text; }).join("").trim()
    : "";
  if (!text) {
    return json({ error: "I could not answer that one. Try rephrasing the question." }, 502);
  }
  if (candidate.finishReason === "MAX_TOKENS") text += "\n\n(Answer cut short. Ask me to continue if you want more.)";
  return json({ reply: text });
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "Use POST." }, 405);
}
