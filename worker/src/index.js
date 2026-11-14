// NEW: labels that let web pages on any address read our data.
// The data is public and the Worker can only read.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400", // browsers may remember the answer for a day
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // The home page
    if (pathname === "/") {
      return new Response("Worker is running. Try /data/test/hello.json");
    }

    // Only handle addresses that start with /data/
    if (!pathname.startsWith("/data/")) {
      return new Response("Not found", { status: 404 });
    }

    // (an OPTIONS request). Answer yes, with no file attached.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // "/data/test/hello.json" becomes "test/hello.json", the file's name in the bucket
    const key = decodeURIComponent(pathname.slice("/data/".length));

    // Ask the bucket for that file
    const file = await env.DATA.get(key);
    if (!file) {
      // NEW: CORS labels here too, so the frontend sees "Not found"
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    // Copy the file's labels (like Content-Type) onto the reply.
    const headers = new Headers(CORS_HEADERS);
    file.writeHttpMetadata(headers);
    headers.set("ETag", file.httpEtag);
    headers.set("Cache-Control", "public, max-age=300"); // browsers may reuse it for 5 minutes

    // Send the file back.
    return new Response(file.body, { headers, encodeBody: "manual" });
  },
};