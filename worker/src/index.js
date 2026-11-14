export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // The home page, so you can see the Worker is alive
    if (pathname === "/") {
      return new Response("Worker is running. Try /data/test/hello.json");
    }

    // Only handle addresses that start with /data/
    if (!pathname.startsWith("/data/")) {
      return new Response("Not found", { status: 404 });
    }

    // "/data/test/hello.json" becomes "test/hello.json", the file's name in the bucket
    const key = decodeURIComponent(pathname.slice("/data/".length));

    // Ask the bucket for that file
    const file = await env.DATA.get(key);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }

    // Copy the file's labels (like Content-Type) onto the reply
    const headers = new Headers();
    file.writeHttpMetadata(headers);
    headers.set("ETag", file.httpEtag);
    headers.set("Cache-Control", "public, max-age=300"); // browsers may reuse it for 5 minutes

    // Send the file back. "manual" means don't compress it a second time
    return new Response(file.body, { headers, encodeBody: "manual" });
  },
};
