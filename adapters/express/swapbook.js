"use strict";
// Swapbook adapter for Express.
//
// Exposes the Swapbook protocol (manifest / preview / mocks / mock) as an
// Express router. Render-agnostic: a variant's render is (args) => htmlString,
// so it works with any template engine or raw strings. Mount it:
//   app.use(registry.router());
const express = require("express");

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function splitRoute(route) {
  const i = route.indexOf(" ");
  return i === -1 ? ["GET", route] : [route.slice(0, i), route.slice(i + 1)];
}

function control(name, type = "text", def = null, options) {
  const c = { name, type, default: def };
  if (options) c.options = options;
  return c;
}

// Pass a non-2xx status (422, 500, ...) to preview a component's error state.
function mock(route, render, status = 200) {
  const [verb, path] = splitRoute(route);
  return { verb: verb.toUpperCase(), path, render, status };
}

// A named preview width, added to the built-in full/tablet/phone.
function viewport(name, w) {
  return { name, w };
}

// Play steps: scripted interactions + assertions run against the preview.
function click(target) { return { action: "click", target }; }
function type(target, value) { return { action: "type", target, value }; }
function expectText(target, text) { return { action: "expect-text", target, text }; }
function expectVisible(target) { return { action: "expect-visible", target }; }
function wait(target) { return { action: "wait", target }; }

function variant(name, render, opts = {}) {
  return {
    name, render,
    controls: opts.controls || [],
    docs: opts.docs || "",
    mocks: opts.mocks || [],
    play: opts.play || [],
  };
}

function coerce(controls, query) {
  const args = {};
  for (const c of controls) {
    const raw = query[c.name];
    if (raw === undefined) { args[c.name] = c.default; continue; } // absent -> default
    if (c.type === "number") {
      const n = parseFloat(raw);
      args[c.name] = Number.isNaN(n) ? c.default : n;
    } else if (c.type === "bool") {
      args[c.name] = raw === "true" || raw === "1" || raw === "on";
    } else {
      args[c.name] = raw;
    }
  }
  return args;
}

class Registry {
  constructor(opts = {}) {
    this.htmxSrc = opts.htmxSrc || "";
    this.cssSrc = opts.cssSrc || "";
    this.jsSrc = opts.jsSrc || "";
    this.viewports = opts.viewports || [];
    this._stories = [];
    this._globalMocks = [];
  }

  register(name, variants, opts = {}) {
    this._stories.push({ id: slug(name), name, group: opts.group || "", docs: opts.docs || "", variants });
    return this;
  }

  // Registry-level mock merged into every variant; a variant's own mock for the
  // same route wins.
  mock(route, render, status = 200) {
    this._globalMocks.push(mock(route, render, status));
    return this;
  }

  _mocksFor(v) { return this._globalMocks.concat(v.mocks); }
  _find(sid, vname) {
    const s = this._stories.find((x) => x.id === sid);
    return s && s.variants.find((v) => v.name === vname);
  }

  _manifest() {
    const vmeta = (v) => {
      const m = { name: v.name, controls: v.controls, docs: v.docs };
      if (v.play && v.play.length) m.play = v.play;
      return m;
    };
    const out = {
      htmxSrc: this.htmxSrc, cssSrc: this.cssSrc, jsSrc: this.jsSrc,
      stories: this._stories.map((s) => ({
        id: s.id, name: s.name, group: s.group, docs: s.docs,
        variants: s.variants.map(vmeta),
      })),
    };
    if (this.viewports.length) out.viewports = this.viewports;
    return out;
  }

  router() {
    const r = express.Router();
    r.get("/_swapbook/manifest.json", (req, res) => res.json(this._manifest()));
    r.get("/_swapbook/preview/:sid/:vname", (req, res) => {
      const v = this._find(req.params.sid, req.params.vname);
      if (!v) return res.sendStatus(404);
      res.type("html").send(v.render(coerce(v.controls, req.query)));
    });
    r.get("/_swapbook/mocks/:sid/:vname", (req, res) => {
      const v = this._find(req.params.sid, req.params.vname);
      if (!v) return res.sendStatus(404);
      res.json(this._mocksFor(v).map((m, i) => ({ verb: m.verb, path: m.path, index: i })));
    });
    r.all("/_swapbook/mock/:sid/:vname/:index", (req, res) => {
      const v = this._find(req.params.sid, req.params.vname);
      if (!v) return res.sendStatus(404);
      const mk = this._mocksFor(v)[parseInt(req.params.index, 10)];
      if (!mk) return res.sendStatus(404);
      res.status(mk.status || 200).type("html").send(mk.render({}));
    });
    return r;
  }
}

module.exports = { Registry, control, mock, variant, viewport, click, type, expectText, expectVisible, wait };
