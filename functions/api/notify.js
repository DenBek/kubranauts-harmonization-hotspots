// Twilio preview. This function builds the text and does not send it.
//
// Live credentials, when you want them, go on the Pages project:
//   Settings → Environment variables → Production
//     TWILIO_ACCOUNT_SID
//     TWILIO_AUTH_TOKEN
//     TWILIO_FROM
//     TWILIO_LIVE=true
// Then redeploy. Do not commit the values. Codespaces secrets are a
// different store and this function cannot see them.
//
// The send stays off unless TWILIO_LIVE is the string "true". Even then,
// the call itself is the marked block below and is not implemented yet.

var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestPost(context) {
  var body = {};
  try {
    body = await context.request.json();
  } catch (err) {
    body = {};
  }
  var sms = messageFor(body);
  var liveFlag = context.env && context.env.TWILIO_LIVE === "true";

  if (liveFlag) {
    // Live send goes here, and only here, once TWILIO_LIVE is true.
    // POST https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json
    // Authorization: Basic base64(TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN)
    // Body fields: To, From=TWILIO_FROM, Body=sms
    // Do not add that call until the team is ready to send real messages.
    return json({
      live: false,
      sms: sms,
      twilio: "TWILIO_LIVE is set, but the send call in functions/api/notify.js is not wired yet. No message was sent.",
    });
  }

  return json({
    live: false,
    sms: sms,
    twilio: "Twilio is not connected. No message was sent.",
  });
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
