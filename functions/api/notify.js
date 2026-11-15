// Fire briefing by text message, WhatsApp or phone call, through Twilio.
//
//   GET  /api/notify  -> { live, recipients: [names], channels }   (never the phone numbers)
//   POST /api/notify  { headline | region, year, month, count, ratio, rank, n, source }
//                     -> preview only: { live, sms }  (briefing.js uses this; it never sends)
//   POST /api/notify  { ..., send: true, to: "<recipient name>", channel: "sms" | "whatsapp" | "call", link }
//                     -> sends through Twilio when it is set up
//
// Set these on the Pages project as secrets (Workers & Pages → kubranauts-hotspots → Settings →
// Variables and Secrets → Add → type Secret), on Production and on Preview, then redeploy:
//   TWILIO_ACCOUNT_SID   from the Twilio Console
//   TWILIO_AUTH_TOKEN    from the Twilio Console
//   TWILIO_FROM          the Twilio phone number, like +12125550123
//   TWILIO_RECIPIENTS    who may receive, as Name=number pairs: Akbar=+16465550123,Deniz=+19175550123
//   TWILIO_LIVE          true
// Optional: TWILIO_WHATSAPP_FROM (default +14155238886, Twilio's WhatsApp sandbox).
// Do not commit the values. Codespaces secrets are a different store and this function cannot see them.
//
// Safety: nothing is sent unless TWILIO_LIVE is "true", the request asks for it (send: true), and "to" names one of
// TWILIO_RECIPIENTS. The page never sees a phone number, so the public site cannot be used to text anyone else.

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var CHANNELS = ["sms", "whatsapp", "call"];
var MAX_TEXT = 480;
var WHATSAPP_SANDBOX = "+14155238886";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeNumber(raw) {
  var n = String(raw || "").replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

// "Akbar=+16465550123, Deniz=+19175550123" (a bare number gets the name "Phone 1", "Phone 2", ...)
function recipients(env) {
  var out = [];
  String((env && env.TWILIO_RECIPIENTS) || "").split(",").forEach(function (part, i) {
    var p = part.trim();
    if (!p) return;
    var eq = p.lastIndexOf("=");
    var name = eq > 0 ? p.slice(0, eq).trim() : "Phone " + (i + 1);
    var number = normalizeNumber(eq > 0 ? p.slice(eq + 1) : p);
    if (name && number) out.push({ name: name.slice(0, 40), number: number });
  });
  return out;
}

function liveConfig(env) {
  env = env || {};
  return env.TWILIO_LIVE === "true" && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN && !!env.TWILIO_FROM && recipients(env).length > 0;
}

// Setup check: which settings this deployment can see (true/false only, never a value), so a missing or misspelled
// secret shows up without opening the dashboard.
var SETTINGS = ["TWILIO_LIVE", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "TWILIO_RECIPIENTS"];

export async function onRequestGet(context) {
  var env = context.env || {};
  var seen = {};
  SETTINGS.forEach(function (k) { seen[k] = !!(env[k] && String(env[k]).trim()); });
  var notes = [];
  if (seen.TWILIO_LIVE && env.TWILIO_LIVE !== "true") notes.push("TWILIO_LIVE is set but is not exactly: true");
  if (seen.TWILIO_ACCOUNT_SID && !/^AC[0-9a-fA-F]{32}$/.test(String(env.TWILIO_ACCOUNT_SID).trim())) notes.push("TWILIO_ACCOUNT_SID should be AC followed by 32 letters and digits");
  if (seen.TWILIO_FROM && !normalizeNumber(env.TWILIO_FROM)) notes.push("TWILIO_FROM should look like +12125550123");
  if (seen.TWILIO_RECIPIENTS && !recipients(env).length) notes.push("TWILIO_RECIPIENTS has no valid Name=+1... entry");
  if (!SETTINGS.some(function (k) { return seen[k]; })) notes.push("This deployment sees none of the settings: add them as Secrets on this environment (Preview for dev), then retry the deployment");
  return json({
    live: liveConfig(env),
    recipients: recipients(env).map(function (r) { return r.name; }),
    channels: CHANNELS,
    settings: seen,
    notes: notes,
  });
}

export async function onRequestPost(context) {
  var env = context.env || {};
  var body = {};
  try {
    body = await context.request.json();
  } catch (err) {
    body = {};
  }
  var sms = clean(messageFor(body));

  if (body.send !== true) {
    return json({
      live: liveConfig(env),
      sms: sms,
      twilio: liveConfig(env) ? "Preview only. Sending happens from the map page." : "Twilio is not connected. No message was sent.",
    });
  }

  if (!liveConfig(env)) {
    return json({ live: false, sent: false, sms: sms, error: "Sending is off on this copy of the site: Twilio is not set up here. The preview shows the exact text." }, 503);
  }
  var channel = CHANNELS.indexOf(body.channel) > -1 ? body.channel : "sms";
  var who = recipients(env).filter(function (r) { return r.name === body.to; })[0];
  if (!who) return json({ live: true, sent: false, sms: sms, error: "Pick one of the listed recipients." }, 400);

  // Only links back to this site are added to the message.
  var link = "";
  try {
    if (body.link && new URL(body.link).origin === new URL(context.request.url).origin) link = new URL(body.link).toString();
  } catch (err) {
    link = "";
  }

  var sid = env.TWILIO_ACCOUNT_SID;
  var form = new URLSearchParams();
  var endpoint;
  if (channel === "call") {
    endpoint = "Calls.json";
    form.set("To", who.number);
    form.set("From", normalizeNumber(env.TWILIO_FROM) || env.TWILIO_FROM);
    form.set("Twiml", twimlFor(sms));
  } else {
    endpoint = "Messages.json";
    var text = link ? sms + " " + link : sms;
    if (channel === "whatsapp") {
      form.set("To", "whatsapp:" + who.number);
      form.set("From", "whatsapp:" + (normalizeNumber(env.TWILIO_WHATSAPP_FROM) || WHATSAPP_SANDBOX));
    } else {
      form.set("To", who.number);
      form.set("From", normalizeNumber(env.TWILIO_FROM) || env.TWILIO_FROM);
    }
    form.set("Body", text);
  }

  var res;
  var data = {};
  try {
    res = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + "/" + endpoint, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(sid + ":" + env.TWILIO_AUTH_TOKEN),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    data = await res.json().catch(function () { return {}; });
  } catch (err) {
    return json({ live: true, sent: false, sms: sms, error: "Could not reach Twilio. Try again." }, 502);
  }
  if (!res.ok) {
    return json({ live: true, sent: false, sms: sms, error: "Twilio refused it: " + (data.message || "status " + res.status) + (data.code ? " (code " + data.code + ")" : ""), code: data.code || null }, 502);
  }
  return json({ live: true, sent: true, sms: sms, channel: channel, to: who.name, status: data.status || "queued", sid: data.sid || null });
}

// Plain text, one line, capped.
function clean(text) {
  var t = String(text || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The call reads the briefing twice, so a listener who picks up late still hears it.
function twimlFor(text) {
  var spoken = escapeXml(text.replace(/×/g, " times ").replace(/·/g, ". ").replace(/–/g, " to "));
  return "<Response><Pause length=\"1\"/><Say voice=\"Polly.Joanna\">" + spoken + "</Say><Pause length=\"1\"/>" +
    "<Say voice=\"Polly.Joanna\">Again. " + spoken + "</Say></Response>";
}

function messageFor(body) {
  var suffix = body.source === "sample" || body.dataset === "sample" ? " Sample data, for layout only." : "";
  if (body.headline) return body.headline + suffix;
  var region = body.region || "Unknown region";
  var month = MONTHS[(Number(body.month) || 1) - 1] || "that month";
  var year = body.year || "that year";
  if (body.count === null || body.count === undefined || body.count === "") {
    return "Fire briefing: " + region + ", " + month + " " + year + ". No cell-days are available for that month." + suffix;
  }
  var count = Math.round(Number(body.count));
  var line = "Fire briefing: " + region + ", " + month + " " + year + ". " + count.toLocaleString("en-US") + " harmonized cell-days.";
  if (body.ratio) line += " " + body.ratio + "× the usual " + month + ".";
  if (body.rank && body.n) line += " Rank " + body.rank + " of " + body.n + ".";
  return line + suffix;
}
