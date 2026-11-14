// GET /api/gold/<table>
//
// Pages binding: Settings → Bindings → R2
//   Variable name: FIRMS
//   Bucket: firms-data
// Object key: publish/<table>.json
//
// scripts/export_calendar.py writes those objects from gold/<table>.parquet.
// Until an object exists, this Worker returns web/sample/<table>.json
// and sets source to "sample".
//
// This file is a Pages Function, which runs as a Worker on the Pages host.
// R2_KEY_ID and R2_SECRET do not belong here. The FIRMS binding is the credential.

var TABLES = [
  "gold_cell_monthly",
  "gold_region_monthly",
  "gold_region_annual",
  "gold_region_analogs",
  "gold_region_headline",
  "gold_calibration",
];

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
  var table = context.params.table;
  if (TABLES.indexOf(table) === -1) {
    return json({ error: "Unknown table." }, 404);
  }
  var published = await readPublished(context.env, table);
  if (published) {
    published.source = "r2";
    return json(published);
  }
  try {
    var sample = await readSample(context, table);
    sample.source = "sample";
    return json(sample);
  } catch (err) {
    return json({ source: "sample", note: "Sample file is missing for " + table + ".", rows: [] }, 500);
  }
}

async function readPublished(env, table) {
  if (!env.FIRMS || typeof env.FIRMS.get !== "function") return null;
  try {
    var object = await env.FIRMS.get("publish/" + table + ".json");
    if (!object) return null;
    return await object.json();
  } catch (err) {
    return null;
  }
}

async function readSample(context, table) {
  var assetUrl = new URL("/sample/" + table + ".json", context.request.url);
  var response = await context.env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) throw new Error("sample missing");
  return await response.json();
}
