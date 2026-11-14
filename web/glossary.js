// Terms page: live search over the definitions, and the side list follows
// the term on screen. Press "/" to jump to the search box.

(function () {
  var input = document.getElementById("term-search");
  var count = document.getElementById("term-count");
  var empty = document.getElementById("term-empty");
  var articles = Array.prototype.slice.call(document.querySelectorAll(".glossary article[id]"));
  var headings = Array.prototype.slice.call(document.querySelectorAll(".glossary-body h2"));
  var links = {};
  document.querySelectorAll(".glossary-toc a").forEach(function (link) {
    links[link.getAttribute("href").slice(1)] = link;
  });
  articles.forEach(function (article) {
    var title = article.querySelector("h3");
    article.dataset.title = title ? title.textContent : article.id;
  });

  function setCount(shown) {
    count.textContent = shown === articles.length ? articles.length + " terms" : shown + " of " + articles.length + " terms";
  }

  function paintTitle(article, query) {
    var title = article.querySelector("h3");
    if (!title) return;
    var text = article.dataset.title;
    title.textContent = "";
    var at = query ? text.toLowerCase().indexOf(query) : -1;
    if (at < 0) { title.textContent = text; return; }
    title.appendChild(document.createTextNode(text.slice(0, at)));
    var mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + query.length);
    title.appendChild(mark);
    title.appendChild(document.createTextNode(text.slice(at + query.length)));
  }

  function filter() {
    var query = input.value.trim().toLowerCase();
    var shown = 0;
    articles.forEach(function (article) {
      var match = !query || article.textContent.toLowerCase().indexOf(query) !== -1;
      article.hidden = !match;
      if (links[article.id]) links[article.id].hidden = !match;
      paintTitle(article, query);
      if (match) shown += 1;
    });
    headings.forEach(function (heading) {
      var next = heading.nextElementSibling;
      var any = false;
      while (next && next.tagName !== "H2") {
        if (next.tagName === "ARTICLE" && !next.hidden) any = true;
        next = next.nextElementSibling;
      }
      heading.hidden = !any;
    });
    empty.hidden = shown !== 0;
    setCount(shown);
  }

  input.addEventListener("input", filter);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { input.value = ""; filter(); }
    if (event.key === "Enter") {
      var first = articles.filter(function (a) { return !a.hidden; })[0];
      if (first) location.hash = first.id;
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      event.preventDefault();
      input.focus();
    }
  });
  setCount(articles.length);

  // Only to keep the header's data pill honest on this page.
  fetchGold("gold_region_headline").catch(function () { showOffline(null); });

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Object.keys(links).forEach(function (id) { links[id].classList.remove("active"); });
        var link = links[entry.target.id];
        if (link) link.classList.add("active");
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    articles.forEach(function (article) { observer.observe(article); });
  }
})();
