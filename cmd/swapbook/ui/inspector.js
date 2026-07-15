// @ts-check
// Injected into every preview frame. Detects which hypermedia library the page
// uses and attaches a matching "probe" that normalizes its network lifecycle
// into a common shape ({verb, path, status, target, params}) forwarded to the
// Swapbook chrome via postMessage. Probes also apply mock/safe-mode behavior.
//
// Coverage: htmx is full (mock rewrite + mutation blocking + rich logging).
// Turbo, Unpoly and Datastar (fetch-based) get normalized logging plus
// best-effort mock rewrite / blocking, since each library intercepts requests
// differently. New libraries are added by writing another probe.
(function () {
  var W = /** @type {any} */ (window);
  var cfg = W.__SB || {};
  var mode = cfg.mode === "safe" || cfg.mode === "live" ? cfg.mode : "mock";
  var mocks = cfg.mocks || {};
  var MUTATING = { POST: 1, PUT: 1, DELETE: 1, PATCH: 1 };

  var seq = 0;
  function send(event, data) {
    try {
      parent.postMessage({ source: "swapbook", seq: seq++, event: event, data: data || {} }, "*");
    } catch (_) {}
  }

  function up(v) {
    return (v || "").toUpperCase();
  }

  // flash: briefly outline the element a response was swapped into.
  function flash(el) {
    if (!el || !el.style) return;
    var prev = el.style.outline, prevOff = el.style.outlineOffset;
    el.style.transition = "outline 120ms ease";
    el.style.outline = "2px solid #82c9e0";
    el.style.outlineOffset = "2px";
    setTimeout(function () {
      el.style.outline = prev;
      el.style.outlineOffset = prevOff;
    }, 750);
  }

  var reqTimes = []; // FIFO of request start times, for latency

  function pathOf(u) {
    try {
      return new URL(u, location.origin).pathname;
    } catch (_) {
      return String(u || "");
    }
  }

  function eltDesc(el) {
    if (!el || !el.tagName) return "";
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    var attrs = ["hx-get", "hx-post", "hx-put", "hx-delete", "hx-target", "hx-swap"];
    attrs.forEach(function (a) {
      if (el.getAttribute && el.getAttribute(a)) s += " " + a + '="' + el.getAttribute(a) + '"';
    });
    return s;
  }

  // Normalize htmx/other request parameters (FormData or plain object).
  function paramsToObj(p) {
    if (!p) return null;
    var o = {};
    if (typeof p.forEach === "function" && typeof p.entries === "function") {
      p.forEach(function (v, k) {
        o[k] = typeof v === "string" ? v : "[file]";
      });
    } else if (typeof p === "object") {
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
    }
    return Object.keys(o).length ? o : null;
  }

  // A request already rerouted to a mock endpoint must never be blocked.
  function isMockPath(path) {
    return (path || "").indexOf("/__sb/mock/") === 0;
  }

  // shouldBlock: outside live mode, unmocked mutating requests are cancelled.
  function shouldBlock(verb, path) {
    return mode !== "live" && !isMockPath(path) && MUTATING[up(verb)];
  }

  // mockFor returns the mock overlay URL for a "VERB /path", if declared.
  function mockFor(verb, path) {
    return mode === "mock" ? mocks[up(verb) + " " + path] : undefined;
  }

  // gate applies the mock/safe policy for a request and logs it. Returns
  // { mock: url } to reroute, { block: true } to cancel, or {} to let through.
  // Non-htmx probes share this so the policy lives in one place; each supplies
  // its own reroute/cancel mechanics.
  function gate(verb, path, lib) {
    var url = mockFor(verb, path);
    if (url) {
      send("mock", { verb: verb, path: path, lib: lib });
      return { mock: url };
    }
    if (shouldBlock(verb, path)) {
      send("blocked", { verb: verb, path: path, lib: lib });
      return { block: true };
    }
    return {};
  }

  // active[name] is set once a probe attaches (see wire()), so the nav guard
  // knows which libraries are live and can defer their own links/forms to them.
  var active = {};

  // Contain navigation: a full-page component ships real <a href> / <form>
  // that would navigate the preview iframe across the whole (proxied) app,
  // escaping the story and losing the inspector. Outside live mode, cancel
  // native navigations and log them. Links/forms driven by an active hypermedia
  // library are left to that library's probe (it reroutes/blocks/logs them);
  // the probe gates the request, so containment still holds. Live mode lets you
  // roam the real app.
  function libDriven(el) {
    if (
      el.closest("[hx-boost]") ||
      el.hasAttribute("hx-get") || el.hasAttribute("hx-post") ||
      el.hasAttribute("hx-put") || el.hasAttribute("hx-delete") || el.hasAttribute("hx-patch")
    ) return true;
    // Unpoly: any element opting into unpoly navigation.
    if (active.unpoly && el.closest("[up-follow],[up-submit],[up-target],[up-layer],[up-nav],[up-href]")) return true;
    // Turbo Drive owns every same-origin link/form unless explicitly opted out.
    if (active.turbo && !el.closest('[data-turbo="false"]')) return true;
    // Datastar wires requests via data-on-* actions, not native nav.
    if (active.datastar && el.closest("[data-on-click],[data-on-submit],[data-on-load]")) return true;
    return false;
  }
  document.addEventListener("click", function (/** @type {any} */ e) {
    if (mode === "live" || !e.target.closest) return;
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href[0] === "#" || href.indexOf("javascript:") === 0 || a.target === "_blank") return;
    if (libDriven(a)) return;
    e.preventDefault();
    send("nav", { path: href });
  }, true);
  document.addEventListener("submit", function (/** @type {any} */ e) {
    if (mode === "live") return;
    var f = e.target;
    if (libDriven(f)) return;
    e.preventDefault();
    send("nav", { verb: up(f.method || "GET"), path: f.getAttribute("action") || "" });
  }, true);

  // ---- Probes -------------------------------------------------------------

  var htmxProbe = {
    name: "htmx",
    detect: function () {
      return !!W.htmx;
    },
    attach: function () {
      // reroute matching requests to their mock endpoint before htmx sends them
      document.addEventListener("htmx:configRequest", function (/** @type {any} */ e) {
        var url = mockFor(e.detail.verb, e.detail.path);
        if (url) {
          send("mock", { verb: up(e.detail.verb), path: e.detail.path, lib: "htmx" });
          e.detail.path = url;
        }
      });
      // block unmocked mutations
      document.addEventListener("htmx:beforeRequest", function (/** @type {any} */ e) {
        var rc = e.detail.requestConfig || {};
        if (shouldBlock(rc.verb, rc.path)) {
          e.preventDefault();
          send("blocked", { verb: up(rc.verb), path: rc.path, target: eltDesc(e.detail.target), params: paramsToObj(rc.parameters), lib: "htmx" });
        }
      });
      // rich logging
      ["beforeRequest", "afterRequest", "beforeSwap", "afterSwap", "responseError"].forEach(function (n) {
        document.addEventListener("htmx:" + n, function (/** @type {any} */ e) {
          var d = e.detail || {};
          // a blocked request is logged once as "blocked" by the gate above;
          // skip the duplicate beforeRequest row (and its unmatched timing push).
          if (n === "beforeRequest" && d.requestConfig && shouldBlock(d.requestConfig.verb, d.requestConfig.path)) return;
          var out = { lib: "htmx" };
          if (d.requestConfig) {
            out.verb = up(d.requestConfig.verb);
            out.path = d.requestConfig.path;
            out.params = paramsToObj(d.requestConfig.parameters);
          }
          if (d.pathInfo && d.pathInfo.requestPath) out.path = d.pathInfo.requestPath;
          if (d.xhr) out.status = d.xhr.status;
          if (d.target) out.target = eltDesc(d.target);
          if (n === "beforeRequest") reqTimes.push(performance.now());
          if (n === "afterRequest") {
            var t0 = reqTimes.shift();
            if (t0 != null) out.ms = Math.round(performance.now() - t0);
          }
          if (n === "beforeSwap" && typeof d.serverResponse === "string") {
            out.responseBytes = d.serverResponse.length;
            out.response = d.serverResponse.slice(0, 6000);
          }
          if (n === "afterSwap") flash(d.target);
          send(n, out);
        });
      });
      // out-of-band swaps update elements other than the primary target; flash
      // and log those too, else a multi-target response looks like nothing
      // happened outside the main swap.
      document.addEventListener("htmx:oobAfterSwap", function (/** @type {any} */ e) {
        var t = (e.detail && e.detail.target) || e.target;
        flash(t);
        send("oobSwap", { target: eltDesc(t), lib: "htmx" });
      });
    },
  };

  var turboProbe = {
    name: "turbo",
    detect: function () {
      return !!W.Turbo;
    },
    attach: function () {
      document.addEventListener("turbo:before-fetch-request", function (/** @type {any} */ e) {
        var d = e.detail || {};
        var verb = up((d.fetchOptions && d.fetchOptions.method) || "GET");
        var path = pathOf(d.url);
        var g = gate(verb, path, "turbo");
        if (g.mock) {
          try { d.url = new URL(g.mock, location.origin); } catch (_) {}
        } else if (g.block) {
          if (e.cancelable) e.preventDefault();
          return;
        }
        send("beforeRequest", { verb: verb, path: path, lib: "turbo" });
      });
      document.addEventListener("turbo:before-fetch-response", function (/** @type {any} */ e) {
        var r = e.detail && e.detail.fetchResponse;
        send("afterRequest", { status: r && r.response && r.response.status, lib: "turbo" });
      });
    },
  };

  var unpolyProbe = {
    name: "unpoly",
    detect: function () {
      return !!(W.up && W.up.on);
    },
    attach: function () {
      W.up.on("up:request:load", function (event) {
        var req = event.request || {};
        var verb = up(req.method || "GET");
        var path = pathOf(req.url);
        var g = gate(verb, path, "unpoly");
        if (g.mock) {
          try { req.url = g.mock; } catch (_) {}
        } else if (g.block) {
          if (event.preventDefault) event.preventDefault();
          return;
        }
        send("beforeRequest", { verb: verb, path: path, lib: "unpoly" });
      });
      W.up.on("up:request:loaded", function (event) {
        var resp = event.response || {};
        send("afterRequest", { status: resp.status, lib: "unpoly" });
      });
    },
  };

  // Datastar and other fetch-based libraries: wrap fetch. htmx uses XHR, so
  // this does not double-count htmx traffic.
  var datastarProbe = {
    name: "datastar",
    detect: function () {
      return !!(W.Datastar || document.querySelector("[data-signals],[data-on-load],[data-star]"));
    },
    attach: function () {
      var orig = window.fetch;
      if (!orig) return;
      window.fetch = function (/** @type {any} */ input, init) {
        var raw = typeof input === "string" ? input : (input && input.url) || "";
        var verb = up((init && init.method) || (input && input.method) || "GET");
        var path = pathOf(raw);
        var g = gate(verb, path, "datastar");
        if (g.mock) {
          send("beforeRequest", { verb: verb, path: path, lib: "datastar" });
          return orig(g.mock, init);
        }
        if (g.block) return Promise.reject(new Error("blocked by swapbook (" + mode + " mode)"));
        send("beforeRequest", { verb: verb, path: path, lib: "datastar" });
        return orig(input, init).then(function (r) {
          send("afterRequest", { status: r.status, lib: "datastar" });
          return r;
        });
      };
    },
  };

  // ---- a11y lint (dependency-free; axe-core is a future drop-in) ----------
  function runA11y() {
    var v = [];
    document.querySelectorAll("img:not([alt])").forEach(function (el) {
      v.push({ rule: "img-alt", msg: "image has no alt text", target: eltDesc(el) });
    });
    document.querySelectorAll("button, a[href]").forEach(function (el) {
      var name = (el.textContent || "").trim() || el.getAttribute("aria-label") || el.getAttribute("title");
      if (!name) v.push({ rule: "name", msg: el.tagName.toLowerCase() + " has no accessible label", target: eltDesc(el) });
    });
    document.querySelectorAll("input, select, textarea").forEach(function (el) {
      var t = (el.getAttribute("type") || "").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button") return;
      var labelled =
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title") ||
        el.closest("label") ||
        (el.id && document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'));
      if (!labelled) v.push({ rule: "label", msg: "form control has no label (placeholder is not a label)", target: eltDesc(el) });
    });
    var seen = {};
    document.querySelectorAll("[id]").forEach(function (el) {
      if (seen[el.id]) v.push({ rule: "dup-id", msg: 'duplicate id "' + el.id + '"', target: eltDesc(el) });
      seen[el.id] = true;
    });
    send("a11y", { violations: v });
  }
  // report content height so the chrome can auto-size autodocs mini-previews
  function reportHeight() {
    try {
      // body.scrollHeight is the CONTENT height; documentElement.scrollHeight
      // would report at least the iframe's own viewport (self-referential),
      // leaving dead space below short fragments.
      var b = document.body;
      if (b) send("height", { h: b.scrollHeight + 16 }); // +margin buffer
    } catch (_) {}
  }

  // re-lint + re-measure whenever the DOM changes, regardless of which library
  // performed the swap (htmx/Turbo/Unpoly/Datastar all mutate the DOM).
  var changeT;
  function onContentChange() {
    clearTimeout(changeT);
    changeT = setTimeout(function () {
      runA11y();
      reportHeight();
    }, 120);
  }

  // ---- SSE / WebSocket lens -----------------------------------------------
  // Long-lived connections have no discrete request to trace, so wrap the
  // EventSource and WebSocket constructors and stream their lifecycle (open,
  // each message, send, close, error) to the chrome. Observational only: the
  // connection is never rerouted or blocked, since it is not a mock-able request.
  function streamMsg(kind, path, dir, data) {
    var s = typeof data === "string" ? data : "[binary]";
    send("streamMsg", { kind: kind, path: path, dir: dir, data: s.slice(0, 2000), bytes: s.length });
  }
  // wrap replaces a stream constructor with one that logs open + each message +
  // error, keeps prototype/static constants intact, and runs extra() for the
  // per-kind pieces (SSE close-method override; WS close event + send wrap).
  function wrap(Orig, kind, statics, extra) {
    var Wrapped = function (url, arg) {
      var inst = arg !== undefined ? new Orig(url, arg) : new Orig(url);
      var path = pathOf(url);
      send("streamOpen", { kind: kind, path: path });
      inst.addEventListener("message", function (ev) { streamMsg(kind, path, "recv", ev.data); });
      inst.addEventListener("error", function () { send("streamError", { kind: kind, path: path }); });
      extra(inst, path);
      return inst;
    };
    Wrapped.prototype = Orig.prototype;
    statics.forEach(function (k) { Wrapped[k] = Orig[k]; });
    return Wrapped;
  }
  function wireStreams() {
    if (W.EventSource) {
      W.EventSource = wrap(W.EventSource, "SSE", ["CONNECTING", "OPEN", "CLOSED"], function (es, path) {
        var close = es.close.bind(es);
        es.close = function () { send("streamClose", { kind: "SSE", path: path }); return close(); };
      });
    }
    if (W.WebSocket) {
      W.WebSocket = wrap(W.WebSocket, "WS", ["CONNECTING", "OPEN", "CLOSING", "CLOSED"], function (ws, path) {
        ws.addEventListener("close", function (ev) { send("streamClose", { kind: "WS", path: path, code: ev && ev.code }); });
        var origSend = ws.send.bind(ws);
        ws.send = function (data) { streamMsg("WS", path, "send", data); return origSend(data); };
      });
    }
  }

  // ---- Play: scripted interactions + assertions ---------------------------
  // The chrome posts { source: "swapbook-cmd", cmd: "play", steps } into this
  // frame; we run each step against the DOM and report the outcome back. Steps
  // are declarative (click / type / expect-text / expect-visible / wait), so no
  // eval and the vocabulary is shared with the adapters.
  function q(sel) {
    try { return document.querySelector(sel); } catch (_) { return null; }
  }
  // waitFor polls for target up to ms; resolves with the element once it exists
  // and (if given) pred(el) holds, else null on timeout.
  function waitFor(sel, ms, pred) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function poll() {
        var el = q(sel);
        if (el && (!pred || pred(el))) return resolve(el);
        if (performance.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 50);
      })();
    });
  }
  async function runStep(s) {
    if (s.action === "click") {
      var el = await waitFor(s.target, 2000);
      if (!el) return "no element at " + s.target;
      el.click();
      return "";
    }
    if (s.action === "type") {
      var input = await waitFor(s.target, 2000);
      if (!input) return "no element at " + s.target;
      input.value = s.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return "";
    }
    if (s.action === "wait") {
      return (await waitFor(s.target, 3000)) ? "" : "timed out waiting for " + s.target;
    }
    if (s.action === "expect-visible") {
      var vis = await waitFor(s.target, 3000);
      return vis && vis.offsetParent !== null ? "" : (vis ? "not visible" : "not found") + ": " + s.target;
    }
    if (s.action === "expect-text") {
      if (s.text == null) return "expect-text step has no text";
      var found = await waitFor(s.target, 3000, function (el) {
        return (el.textContent || "").indexOf(s.text) !== -1;
      });
      return found ? "" : "expected " + s.target + ' to contain "' + s.text + '"';
    }
    return "unknown action: " + s.action;
  }
  var playing = false;
  async function runPlay(steps) {
    playing = true;
    var passed = 0;
    try {
      for (var i = 0; i < steps.length; i++) {
        var detail = "";
        try {
          detail = await runStep(steps[i]);
        } catch (e) {
          detail = String((e && e.message) || e);
        }
        var ok = detail === "";
        send("play:result", { index: i, action: steps[i].action, target: steps[i].target, ok: ok, detail: detail });
        if (ok) passed++;
        else break; // stop at the first failure, like a test
      }
      send("play:done", { passed: passed, total: steps.length, ok: passed === steps.length });
    } finally {
      playing = false;
    }
  }
  window.addEventListener("message", function (e) {
    var m = e.data;
    // ignore a re-entrant run while one is already in flight
    if (m && m.source === "swapbook-cmd" && m.cmd === "play" && !playing) runPlay(m.steps || []);
  });

  // ---- Wire up ------------------------------------------------------------

  var PROBES = [htmxProbe, turboProbe, unpolyProbe, datastarProbe];

  // Wire probes after DOMContentLoaded: deferred library scripts (e.g. a
  // <script src="htmx.js" defer>) have executed by then, so detection sees
  // W.htmx/Turbo/up. Request events fire on later user interaction, so
  // attaching now never misses anything.
  function wire() {
    var attached = [];
    PROBES.forEach(function (p) {
      if (p.detect()) {
        active[p.name] = true;
        p.attach();
        attached.push(p.name);
      }
    });
    wireStreams();
    send("frame:ready", { mode: mode, libs: attached });
    onContentChange();
    if (document.body && window.MutationObserver) {
      new MutationObserver(onContentChange).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
