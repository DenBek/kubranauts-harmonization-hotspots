// The website's only data read.
//
// Pages binding: Settings → Bindings → R2
//   Variable name: FIRMS
//   Bucket: firms-data
// Object key: publish/calendar_by_country.json
//
// scripts/export_calendar.py writes that object from the gold table
// gold/calendar_monthly.parquet. Until the object exists, this function
// returns web/sample-calendar.json and sets source to "sample".
//
// R2_KEY_ID and R2_SECRET do not belong here. The binding is the credential.

var PUBLISH_KEY = "publish/calendar_by_country.json";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  var published = await readPublished(context.env);
  if (published) {
    published.source = "r2";
    return json(published);
  }
  try {
    var sample = await readSample(context);
    sample.source = "sample";
    return json(sample);
  } catch (err) {
    return json({ source: "sample", note: "Sample calendar file is missing.", regions: [] }, 500);
  }
}

async function readPublished(env) {
  if (!env.FIRMS || typeof env.FIRMS.get !== "function") return null;
  try {
    var object = await env.FIRMS.get(PUBLISH_KEY);
    if (!object) return null;
    return await object.json();
  } catch (err) {
    return null;
  }
}

async function readSample(context) {
  var assetUrl = new URL("/sample-calendar.json", context.request.url);
  var response = await context.env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) throw new Error("sample calendar missing");
  return await response.json();
}
