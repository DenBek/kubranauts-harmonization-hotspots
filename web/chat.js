// Fire Calendar assistant: one chat engine, two surfaces.
//   - chat.html has <div id="chat-page"></div> and gets the full-page chat.
//   - every other page gets a floating button (added by nav.js, which loads this file and chat.css).
// Both surfaces share one conversation, kept in sessionStorage (gone when the tab closes).
// Talks to POST /api/chat (functions/api/chat.js). The API key lives on the server only.
// Plain JS, no library. Model text is never put into innerHTML: it is built with DOM nodes.

(function () {
  if (window.FireChat) return;

  var STORE_KEY = "fire-calendar-chat-v1";
  var MAX_INPUT = 1000;       // characters per question
  var MAX_KEPT = 40;          // messages kept in the browser
  var MAX_SENT = 12;          // messages sent per request (server caps at 20)
  var TIMEOUT_MS = 30000;
  var SUGGESTIONS = [
    "Why do we need to harmonize MODIS and VIIRS?",
    "How does the conversion work?",
    "How accurate is it?",
    "What does the hatched square mean?",
    "Why does the calendar start in 2003?",
    "What can I not conclude from this?",
  ];
  var GREETING = "Hi! I can explain what this fire calendar shows, how the MODIS and VIIRS counts were joined into one record, and how far to trust the numbers. I know the project notes for Argentina. I can't look up a specific month: use the Fire calendar page for that.";

  // ---------- conversation store (shared by every panel on the page) ----------

  var messages = load();      // [{ role: "user" | "model", text }]
  var busy = false;
  var failed = null;          // last error text, shown under the conversation
  var panels = [];

  function load() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter(function (m) {
        return m && (m.role === "user" || m.role === "model") && typeof m.text === "string";
      }).slice(-MAX_KEPT) : [];
    } catch (err) { return []; }
  }

  function save() {
    messages = messages.slice(-MAX_KEPT);
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages)); } catch (err) { /* private mode: keep in memory */ }
  }

  function notify() { panels.forEach(function (p) { p.render(); }); }

  function send(text) {
    text = String(text || "").trim().slice(0, MAX_INPUT);
    if (!text || busy) return;
    messages.push({ role: "user", text: text });
    save();
    failed = null;
    request();
  }

  function retry() {
    if (busy || !messages.length || messages[messages.length - 1].role !== "user") return;
    failed = null;
    request();
  }

  function request() {
    busy = true;
    notify();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({ messages: messages.slice(-MAX_SENT) }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.reply) throw new Error(data.error || "Something went wrong. Please try again.");
        messages.push({ role: "model", text: String(data.reply) });
        save();
      });
    }).catch(function (err) {
      failed = err && err.name === "AbortError" ? "The assistant took too long. Please try again." :
        (err && err.message && err.message !== "Failed to fetch" ? err.message : "Could not reach the assistant. Check your connection and try again.");
    }).then(function () {
      clearTimeout(timer);
      busy = false;
      notify();
    });
  }

  function clearAll() {
    if (busy) return;
    messages = [];
    failed = null;
    save();
    notify();
  }

  // ---------- safe text rendering: paragraphs, "-" lists, **bold**, `code` ----------

  function inline(parent, text) {
    text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).forEach(function (part) {
      if (!part) return;
      var node;
      if (part.length > 4 && part.slice(0, 2) === "**" && part.slice(-2) === "**") {
        node = document.createElement("strong");
        node.textContent = part.slice(2, -2);
      } else if (part.length > 2 && part.charAt(0) === "`" && part.slice(-1) === "`") {
        node = document.createElement("code");
        node.textContent = part.slice(1, -1);
      } else {
        node = document.createTextNode(part);
      }
      parent.appendChild(node);
    });
  }

  function richText(container, text) {
    var list = null;
    var listTag = "";
    function flush() { list = null; listTag = ""; }
    String(text).replace(/\r/g, "").split("\n").forEach(function (line) {
      var bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      var numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        var tag = bullet ? "ul" : "ol";
        if (!list || listTag !== tag) {
          list = document.createElement(tag);
          listTag = tag;
          container.appendChild(list);
        }
        var li = document.createElement("li");
        inline(li, (bullet || numbered)[1]);
        list.appendChild(li);
      } else if (line.trim()) {
        flush();
        var p = document.createElement("p");
        inline(p, line.trim());
        container.appendChild(p);
      } else {
        flush();
      }
    });
  }

  // ---------- one chat surface ----------

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function createPanel(host, opts) {
    opts = opts || {};
    var root = node("div", "chat" + (opts.compact ? " chat-compact" : ""));
    var log = node("div", "chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-label", "Conversation");
    var chips = node("div", "chat-chips");
    var form = node("form", "chat-form");
    form.setAttribute("autocomplete", "off");
    var input = node("textarea", "chat-input");
    input.rows = 1;
    input.maxLength = MAX_INPUT;
    input.placeholder = "Ask about the fire calendar…";
    input.setAttribute("aria-label", "Your question");
    var sendBtn = node("button", "btn chat-send", "Send");
    sendBtn.type = "submit";
    var foot = node("div", "chat-foot");
    var note = node("span", "chat-note", "AI assistant. It can make mistakes, and it only knows the project notes. Check the numbers on the pages.");
    var clearBtn = node("button", "btn ghost small chat-clear", "Clear chat");
    clearBtn.type = "button";
    foot.appendChild(note);
    foot.appendChild(clearBtn);
    form.appendChild(input);
    form.appendChild(sendBtn);
    root.appendChild(log);
    root.appendChild(chips);
    root.appendChild(form);
    root.appendChild(foot);
    host.appendChild(root);

    function grow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = input.value;
      if (!value.trim() || busy) return;
      input.value = "";
      grow();
      send(value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit ? form.requestSubmit() : sendBtn.click();
      }
    });
    input.addEventListener("input", grow);
    clearBtn.addEventListener("click", clearAll);

    function bubble(role, text) {
      var row = node("div", "chat-msg " + (role === "user" ? "from-user" : "from-bot"));
      var body = node("div", "chat-bubble");
      if (role === "user") body.textContent = text;
      else richText(body, text);
      row.appendChild(body);
      return row;
    }

    function render() {
      log.textContent = "";
      log.appendChild(bubble("model", GREETING));
      messages.forEach(function (m) { log.appendChild(bubble(m.role, m.text)); });
      if (busy) {
        var typing = node("div", "chat-msg from-bot");
        var dots = node("div", "chat-bubble chat-typing");
        dots.setAttribute("role", "status");
        dots.setAttribute("aria-label", "The assistant is typing");
        dots.innerHTML = "<span></span><span></span><span></span>";
        typing.appendChild(dots);
        log.appendChild(typing);
      }
      if (failed) {
        var err = node("div", "chat-error");
        err.setAttribute("role", "alert");
        err.appendChild(node("span", "", failed));
        if (messages.length && messages[messages.length - 1].role === "user") {
          var again = node("button", "btn secondary small", "Try again");
          again.type = "button";
          again.addEventListener("click", retry);
          err.appendChild(again);
        }
        log.appendChild(err);
      }
      log.scrollTop = log.scrollHeight;

      chips.textContent = "";
      if (!messages.length && !busy) {
        SUGGESTIONS.forEach(function (q) {
          var chip = node("button", "chat-chip", q);
          chip.type = "button";
          chip.addEventListener("click", function () { send(q); });
          chips.appendChild(chip);
        });
      }
      chips.hidden = !chips.childNodes.length;
      sendBtn.disabled = busy;
      clearBtn.hidden = !messages.length;
      clearBtn.disabled = busy;
      root.setAttribute("aria-busy", busy ? "true" : "false");
    }

    var panel = { root: root, render: render, focus: function () { input.focus(); } };
    panels.push(panel);
    render();
    return panel;
  }

  // ---------- surfaces ----------

  function mountPage(host) {
    var panel = createPanel(host);
    window.addEventListener("pageshow", panel.render);
    return panel;
  }

  function mountWidget() {
    var wrap = node("div", "chat-widget");
    var fab = node("button", "chat-fab");
    fab.type = "button";
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "chat-widget-panel");
    fab.setAttribute("aria-label", "Ask the fire calendar assistant");
    fab.innerHTML = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'/></svg><span class='chat-fab-text'>Ask</span>";

    var box = node("section", "chat-popup");
    box.id = "chat-widget-panel";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Fire calendar assistant");
    var head = node("div", "chat-popup-head");
    head.appendChild(node("strong", "", "Ask about this data"));
    var full = node("a", "chat-popup-full", "Open full page");
    full.href = "chat.html";
    var close = node("button", "btn ghost small icon", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close the assistant");
    head.appendChild(full);
    head.appendChild(close);
    box.appendChild(head);
    var panel = createPanel(box, { compact: true });
    wrap.appendChild(box);
    wrap.appendChild(fab);
    document.body.appendChild(wrap);

    function setOpen(open) {
      box.hidden = !open;
      fab.setAttribute("aria-expanded", String(open));
      wrap.classList.toggle("open", open);
      if (open) { panel.render(); panel.focus(); } else { fab.focus(); }
    }
    fab.addEventListener("click", function () { setOpen(box.hidden); });
    close.addEventListener("click", function () { setOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !box.hidden) setOpen(false);
    });
  }

  window.FireChat = { send: send, clear: clearAll };

  function start() {
    var page = document.getElementById("chat-page");
    if (page) mountPage(page);
    else mountWidget();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
