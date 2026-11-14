(function () {
  var pages = [
    ["index.html", "Overview"],
    ["map.html", "Map"],
    ["calendar.html", "Calendar"],
    ["year.html", "Year"],
    ["briefing.html", "Briefing"],
    ["glossary.html", "Terms"],
  ];
  var path = location.pathname.split("/").pop();
  if (!path) path = "index.html";
  var header = document.getElementById("site-header");
  if (!header) return;
  var links = pages.map(function (page) {
    var current = path === page[0];
    return '<a href="' + page[0] + '"' + (current ? ' aria-current="page"' : "") + ">" + page[1] + "</a>";
  }).join("");
  header.innerHTML =
    '<div class="bar"><a class="brand" href="index.html">Kubranauts</a><nav>' + links + "</nav></div>";
})();
