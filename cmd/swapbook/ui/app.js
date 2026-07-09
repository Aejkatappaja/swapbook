// @ts-check
// Swapbook chrome: load the manifest, render the story list + controls, drive
// the preview iframe, stream the frame's network + a11y signals into the
// inspector, and keep everything shareable via URL state + keyboard-driven.

/**
 * @typedef {{ name: string, type: string, default?: unknown, options?: string[] }} Control
 * @typedef {{ name: string, controls?: Control[], docs?: string }} VariantObj
 * @typedef {string | VariantObj} Variant  variants may be a bare name (hand-rolled targets) or an object
 * @typedef {{ id: string, name: string, group?: string, docs?: string, variants: Variant[] }} Story
 * @typedef {{ htmxSrc?: string, cssSrc?: string, jsSrc?: string, stories?: Story[] }} Manifest
 * @typedef {{ source: string, seq?: number, event: string, data?: any }} SBMessage  posted by the frame's inspector
 */

const WIDTHS = [
  { label: "full", w: "100%" },
  { label: "tablet", w: "768px" },
  { label: "phone", w: "375px" },
];
const MODES = ["mock", "safe", "live"];
const MODE_TITLES = {
  mock: "mocked routes served locally, unmocked writes blocked",
  safe: "real requests, mutations intercepted + logged",
  live: "real requests + swaps",
};

const BGS = ["light", "dark", "checker"]; // actual colors live server-side in bgValue

let htmxSrc = "", cssSrc = "", jsSrc = "";
let mode = "mock";
let widthLabel = "full";
let bg = localStorage.getItem("swapbook:bg") || "dark";
/** @type {Story[]} */ let allStories = [];
/** @type {{ story: Story, variant: Variant } | null} */ let current = null;
/** @type {Record<string, any>} */ let args = {};
let docsView = false; // showing a story's autodocs page
/** @type {string | null} */ let manifestRaw = ""; // last manifest body; null = target down

/** @param {Variant} v */ const vName = (v) => (typeof v === "string" ? v : v.name);
/** @param {Variant} v @returns {Control[]} */ const vControls = (v) => (typeof v === "string" ? [] : v.controls || []);
/** @param {Variant} v */ const vDocs = (v) => (typeof v === "string" ? "" : v.docs || "");
/** @param {unknown} s */ const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** typed DOM helpers (checkJs-friendly). @param {string} sel @param {ParentNode} [root] @returns {HTMLElement[]} */
const qsa = (sel, root = document) => /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(sel)));
/** @param {string} id @returns {any} */
const el = (id) => document.getElementById(id);

// applyManifest stores the raw body (so poll compares like-for-like) and the
// asset paths + stories it carries. Shared by boot and poll so a rebuild that
// changes hashed asset URLs is picked up, not just the story list.
function applyManifest(text) {
  manifestRaw = text;
  const m = JSON.parse(text);
  htmxSrc = m.htmxSrc || "";
  cssSrc = m.cssSrc || "";
  jsSrc = m.jsSrc || "";
  allStories = m.stories || [];
}

// fetchManifest classifies the target: "ok" (adapter answered with a manifest),
// "no-adapter" (app is up but nothing is mounted at /_swapbook -> 404), or
// "down" (unreachable -> proxy 502 or network error).
async function fetchManifest() {
  try {
    const res = await fetch("/__sb/api/manifest", { cache: "no-store" });
    if (res.status === 404) return { state: "no-adapter" };
    if (!res.ok) return { state: "down" };
    return { state: "ok", text: await res.text() };
  } catch {
    return { state: "down" };
  }
}

async function boot() {
  renderBars();
  const m = await fetchManifest();
  if (m.state === "ok") {
    applyManifest(m.text);
    renderStories(allStories);
    if (!applyParams(location.hash.replace(/^#/, ""))) {
      try { applyParams(localStorage.getItem("swapbook:last") || ""); } catch {}
    }
  } else {
    showDown(m.state); // still start the poller so we recover when it comes up
  }
  setInterval(poll, 1500); // auto-reload + reconnect
}

function renderStories(stories) {
  const groups = {};
  for (const s of stories) (groups[s.group || ""] ??= []).push(s);
  const nav = el("stories");
  nav.innerHTML = "";
  for (const [group, items] of Object.entries(groups)) {
    if (group) {
      const h = document.createElement("div");
      h.className = "group";
      h.textContent = group;
      nav.appendChild(h);
    }
    for (const s of items) {
      const d = document.createElement("button");
      d.className = "story story-docs";
      d.dataset.sid = s.id;
      d.dataset.docs = "1";
      d.innerHTML = `<span class="knob">▤</span> ${esc(s.name)} · docs`;
      d.onclick = () => selectDocs(s);
      nav.appendChild(d);
      for (const v of s.variants) {
        const name = vName(v);
        const a = document.createElement("button");
        a.className = "story";
        a.dataset.sid = s.id;
        a.dataset.vname = name;
        a.innerHTML = `${esc(s.name)} · ${esc(name)}${vControls(v).length ? ' <span class="knob">◧</span>' : ""}`;
        a.onclick = () => selectVariant(s, v);
        nav.appendChild(a);
      }
    }
  }
  setActiveStory();
}

function setActiveStory() {
  qsa(".story").forEach((b) => {
    const isDocs = b.dataset.docs === "1";
    const on = current && b.dataset.sid === current.story.id &&
      ((docsView && isDocs) || (!docsView && !isDocs && b.dataset.vname === vName(current.variant)));
    b.classList.toggle("active", !!on);
    if (on) b.scrollIntoView({ block: "nearest" });
  });
}

function showPreview() {
  el("preview").hidden = false;
  el("autodocs").hidden = true;
}
function showAutodocs() {
  el("preview").hidden = true;
  el("autodocs").hidden = false;
}

function selectVariant(story, v, stateArgs) {
  docsView = false;
  showPreview();
  current = { story, variant: v };
  args = {};
  for (const c of vControls(v)) args[c.name] = c.default;
  if (stateArgs) Object.assign(args, stateArgs);
  setActiveStory();
  renderControls(vControls(v));
  renderDocs(vDocs(v));
  loadFrame();
  writeState();
}

function selectDocs(story) {
  docsView = true;
  current = { story, variant: story.variants[0] };
  args = {};
  el("current").innerHTML = `<span class="p">$</span> ${esc(story.name)} · docs`;
  renderControls([]);
  renderDocs("");
  showAutodocs();
  renderAutodocs(story);
  setActiveStory();
  writeState();
}

// autodocs: one page per component, description, props table, variant gallery
function renderAutodocs(story) {
  const controls = {};
  for (const v of story.variants) for (const c of vControls(v)) controls[c.name] = c;
  const names = Object.keys(controls);
  let html = `<h1>${esc(story.name)}</h1>`;
  if (story.docs) html += `<div class="ad-desc">${mdToHtml(story.docs)}</div>`;
  if (names.length) {
    html += `<h2>Props</h2><div class="ad-table-wrap"><table class="ad-props"><thead><tr><th>name</th><th>type</th><th>default</th><th>options</th></tr></thead><tbody>`;
    for (const n of names) {
      const c = controls[n];
      html += `<tr><td><code>${esc(n)}</code></td><td>${esc(c.type)}</td><td>${esc(String(c.default ?? ""))}</td><td>${esc((c.options || []).join(", "))}</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `<h2>Variants</h2><div class="ad-variants">`;
  for (const v of story.variants) {
    const defs = {};
    for (const c of vControls(v)) defs[c.name] = c.default;
    html += `<figure class="ad-card"><figcaption>${esc(vName(v))}${vControls(v).length ? ' <span class="knob">◧</span>' : ""}</figcaption>`;
    if (vDocs(v)) html += `<div class="ad-vdoc">${mdToHtml(vDocs(v))}</div>`;
    html += `<iframe loading="lazy" src="${frameUrlFor(story.id, vName(v), defs)}"></iframe></figure>`;
  }
  html += `</div>`;
  el("autodocs").innerHTML = html;
}

// light markdown for story docs (headings, bold, code, links, lists)
function mdToHtml(s) {
  const inline = (x) =>
    esc(x)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let inList = false;
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (/^- /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + inline(line.slice(2)) + "</li>");
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (!line) continue;
    if (/^### /.test(line)) out.push("<h4>" + inline(line.slice(4)) + "</h4>");
    else if (/^## /.test(line)) out.push("<h3>" + inline(line.slice(3)) + "</h3>");
    else if (/^# /.test(line)) out.push("<h2>" + inline(line.slice(2)) + "</h2>");
    else out.push("<p>" + inline(line) + "</p>");
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function renderDocs(md) {
  const tab = el("docsTab");
  const panel = el("docs");
  if (!md) {
    tab.hidden = true;
    panel.innerHTML = "";
    if (tab.classList.contains("active")) qsa('.tab[data-tab="net"]')[0].click();
    return;
  }
  tab.hidden = false;
  panel.innerHTML = mdToHtml(md);
}

function renderControls(controls) {
  const bar = el("controls");
  bar.innerHTML = "";
  if (!controls.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const label = document.createElement("span");
  label.className = "seg-label";
  label.textContent = "controls";
  bar.appendChild(label);
  for (const c of controls) {
    const wrap = document.createElement("label");
    wrap.className = "ctrl";
    const cap = document.createElement("span");
    cap.textContent = c.name;
    wrap.appendChild(cap);
    let input;
    if (c.type === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = args[c.name] === true || args[c.name] === "true";
      input.onchange = () => set(c.name, input.checked);
    } else if (c.type === "select") {
      input = document.createElement("select");
      for (const o of c.options || []) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = o;
        if (o === args[c.name]) opt.selected = true;
        input.appendChild(opt);
      }
      input.onchange = () => set(c.name, input.value);
    } else {
      input = document.createElement("input");
      input.type = c.type === "number" ? "number" : "text";
      input.value = args[c.name] ?? "";
      input.oninput = debounce(() => set(c.name, input.value), 250);
    }
    wrap.appendChild(input);
    bar.appendChild(wrap);
  }
}

function set(name, value) {
  args[name] = value;
  loadFrame();
  writeState();
}

function frameUrlFor(storyId, variantName, a) {
  const q = new URLSearchParams({ mode });
  if (htmxSrc) q.set("htmx", htmxSrc);
  if (cssSrc) q.set("css", cssSrc);
  if (jsSrc) q.set("js", jsSrc);
  q.set("bg", bg);
  // control args are "arg."-namespaced so the server splits them from frame
  // params by prefix (a control may safely be named "mode"/"bg"/etc.)
  for (const [k, v] of Object.entries(a || {})) if (v !== undefined && v !== null) q.set("arg." + k, v);
  return `/__sb/frame/${storyId}/${variantName}?${q}`;
}
function frameUrl() {
  return frameUrlFor(current.story.id, vName(current.variant), args);
}

function loadFrame() {
  if (!current) return;
  el("current").innerHTML =
    `<span class="p">$</span> ${esc(current.story.name)} · ${esc(vName(current.variant))}`;
  clearEvents();
  el("preview").src = frameUrl();
}

// segmented builds a toolbar button group and returns a setActive(value) fn.
// One factory for mode / width / bg instead of three copies.
/** @type {(v: string) => void} */ let setModeActive = () => {};
/** @type {(v: string) => void} */ let setWidthActive = () => {};
/** @type {(v: string) => void} */ let setBgActive = () => {};
function segmented(containerId, values, onpick, title) {
  const bar = el(containerId);
  bar.innerHTML = "";
  for (const v of values) {
    const b = document.createElement("button");
    b.textContent = v;
    b.dataset.val = v;
    if (title) b.title = title(v);
    b.onclick = () => onpick(v);
    bar.appendChild(b);
  }
  return (val) => qsa("button", bar).forEach((b) => b.classList.toggle("active", b.dataset.val === val));
}
function renderBars() {
  setModeActive = segmented("modes", MODES, setMode, (v) => MODE_TITLES[v] || "");
  setWidthActive = segmented("widths", WIDTHS.map((w) => w.label), setWidth);
  setBgActive = segmented("bgs", BGS, setBg);
  setModeActive(mode);
  setWidthActive(widthLabel);
  setBgActive(bg);
  el("stage").style.background = bgCanvas(bg);
}
function setMode(m) {
  mode = m;
  setModeActive(m);
  loadFrame();
  writeState();
}
function setWidth(label) {
  const p = WIDTHS.find((x) => x.label === label) || WIDTHS[0];
  widthLabel = p.label;
  el("preview").style.width = p.w;
  setWidthActive(p.label);
  writeState();
}
// bgCanvas maps a bg choice to the canvas (#stage) backdrop. dark is kept
// distinct from the preview surface so a resized preview stays visible on it.
function bgCanvas(label) {
  if (label === "light") return "#ffffff";
  if (label === "checker") return "repeating-conic-gradient(#c9ccd4 0 25%, #ffffff 0 50%) 50% / 18px 18px";
  return "#0b0c10"; // dark
}
function setBg(label) {
  bg = label;
  setBgActive(label);
  el("stage").style.background = bgCanvas(label);
  try { localStorage.setItem("swapbook:bg", label); } catch {}
  loadFrame();
  writeState();
}

// ---- URL state + persistence ---------------------------------------------
function stateString() {
  if (!current) return "";
  const p = new URLSearchParams();
  p.set("story", current.story.id);
  if (docsView) {
    p.set("docs", "1");
  } else {
    p.set("variant", vName(current.variant));
    for (const [k, v] of Object.entries(args)) if (v != null && v !== "") p.set("arg." + k, v);
  }
  p.set("mode", mode);
  p.set("w", widthLabel);
  p.set("bg", bg);
  return p.toString();
}
function writeState() {
  const s = stateString();
  history.replaceState(null, "", "#" + s);
  try { localStorage.setItem("swapbook:last", s); } catch {}
}
function applyParams(str) {
  if (!str) return false;
  const p = new URLSearchParams(str);
  const story = allStories.find((s) => s.id === p.get("story"));
  if (!story) return false;
  const v = story.variants.find((x) => vName(x) === p.get("variant")) || story.variants[0];
  if (MODES.includes(p.get("mode"))) mode = p.get("mode");
  if (WIDTHS.some((w) => w.label === p.get("w"))) widthLabel = p.get("w");
  if (BGS.includes(p.get("bg"))) bg = p.get("bg");
  setModeActive(mode);
  setBgActive(bg);
  el("stage").style.background = bgCanvas(bg);
  setWidth(widthLabel);
  if (p.get("docs") === "1") {
    selectDocs(story);
    return true;
  }
  const stateArgs = {};
  for (const [k, val] of p) if (k.startsWith("arg.")) stateArgs[k.slice(4)] = val;
  selectVariant(story, v, stateArgs);
  return true;
}

// ---- auto-reload (poll the manifest; reload when the target rebuilds) ------
async function poll() {
  // network layer: decide reachable vs down. Only this flips the overlay.
  const m = await fetchManifest();
  if (m.state !== "ok") {
    showDown(m.state);
    return;
  }
  const text = m.text;
  showError(false);
  // render layer: a hiccup here must NOT be mistaken for the target being down.
  try {
    const wasDown = manifestRaw === null;
    if (!wasDown && text === manifestRaw) {
      setStatus("ready", "ok");
      return;
    }
    applyManifest(text);
    renderStories(currentStoryList());
    if (current) {
      const st = allStories.find((s) => s.id === current.story.id);
      if (st) {
        current = { story: st, variant: st.variants.find((x) => vName(x) === vName(current.variant)) || st.variants[0] };
        setActiveStory();
        if (docsView) renderAutodocs(st);
        else loadFrame();
      }
    }
    setStatus(wasDown ? "reconnected" : "reloaded", "ok");
    setTimeout(() => setStatus("ready", "ok"), 1400);
  } catch {
    setStatus("ready", "ok"); // reachable; ignore transient render error
  }
}
function setStatus(txt, kind) {
  const s = el("status");
  s.querySelector(".status-txt").textContent = txt;
  s.querySelector(".dot").className = "dot " + (kind === "warn" ? "warn" : "ok");
}
// showDown flips the whole UI into an unreachable/no-adapter state and lets the
// poller recover it. state is "down" or "no-adapter".
function showDown(state) {
  manifestRaw = null;
  const noAdapter = state === "no-adapter";
  el("stories").textContent = noAdapter ? "no adapter" : "target unreachable";
  setStatus(noAdapter ? "no adapter" : "reconnecting…", "warn");
  showError(true, state);
}

/** @param {boolean} on @param {string} [state] */
function showError(on, state) {
  el("stage-error").hidden = !on;
  if (!on) return;
  if (state === "no-adapter") {
    el("err-title").textContent = "no swapbook adapter";
    el("err-sub").innerHTML = "your app is up, but nothing answers at <code>/_swapbook</code>. Did you mount the adapter?";
  } else {
    el("err-title").textContent = "target unreachable";
    el("err-sub").innerHTML = 'waiting for <code>your app</code> to come back… (auto-reloads)';
  }
}
function currentStoryList() {
  const q = (el("story-search").value || "").trim().toLowerCase();
  if (!q) return allStories;
  return allStories
    .map((s) => ({ ...s, variants: s.variants.filter((v) => `${s.name} ${vName(v)}`.toLowerCase().includes(q)) }))
    .filter((s) => s.variants.length);
}

// ---- inspector ------------------------------------------------------------
function clearEvents() {
  el("events").innerHTML = "";
  el("a11y").innerHTML = "";
  const c = el("a11yCount");
  c.hidden = true;
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.source !== "swapbook") return;
  if (msg.event === "height") {
    const h = Math.max(80, Math.min((msg.data && msg.data.h) || 160, 700));
    qsa("#autodocs iframe").forEach((/** @type {any} */ f) => { if (f.contentWindow === e.source) f.style.height = h + "px"; });
    return;
  }
  if (msg.event === "frame:ready") return onReady(msg.data || {});
  if (msg.event === "a11y") return onA11y(msg.data || {});
  onNetwork(msg);
});

function onReady(data) {
  clearEvents();
  // htmx is verified end-to-end; the other probes are best-effort, so flag them.
  const libs = (data.libs || []).map((/** @type {string} */ l) => (l === "htmx" ? l : l + " (beta)"));
  const info = document.createElement("li");
  info.className = "evt evt-info";
  info.innerHTML = `<span class="etag">ready</span> <span class="muted">${
    libs.length ? "hypermedia: " + esc(libs.join(", ")) : "no hypermedia lib detected"
  }</span>`;
  el("events").appendChild(info);
}

function toCurl(d) {
  const url = location.origin + d.path;
  const h = "-H 'HX-Request: true'";
  if (d.verb && d.verb !== "GET") {
    const body = d.params ? Object.entries(d.params).map(([k, v]) => `-d '${k}=${v}'`).join(" ") : "";
    return `curl -X ${d.verb} ${h} ${body} '${url}'`.replace(/\s+/g, " ");
  }
  return `curl ${h} '${url}'`;
}

function onNetwork(msg) {
  const d = msg.data || {};
  const li = document.createElement("li");
  li.className = "evt evt-" + msg.event;
  const bits = [
    `<span class="etag">${esc(msg.event)}</span>`,
    d.verb ? `<b>${esc(d.verb)}</b>` : "",
    d.path ? `<code>${esc(d.path)}</code>` : "",
    d.status != null ? `<span class="status s${String(d.status)[0]}">${d.status}</span>` : "",
    d.ms != null ? `<span class="ms">${d.ms}ms</span>` : "",
    msg.event === "blocked" ? `<span class="blocked">intercepted</span>` : "",
    msg.event === "mock" ? `<span class="mocked">served from mock</span>` : "",
    msg.event === "nav" ? `<span class="blocked">navigation intercepted</span>` : "",
    d.target ? `→ <code>${esc(d.target)}</code>` : "",
    d.responseBytes != null ? `<span class="bytes">${d.responseBytes}B</span>` : "",
    msg.event === "beforeRequest" && d.path ? `<span class="curl" title="copy as curl">⧉ curl</span>` : "",
    d.response ? `<span class="peek">view response ▾</span>` : "",
  ].filter(Boolean);
  li.innerHTML = bits.join(" ");
  if (d.params) {
    const p = document.createElement("div");
    p.className = "params";
    p.textContent = Object.entries(d.params)
      .map(([k, v]) => `${k}=${String(v).length > 60 ? String(v).slice(0, 60) + "…" : v}`)
      .join("   ");
    li.appendChild(p);
  }
  const curlEl = /** @type {HTMLElement} */ (li.querySelector(".curl"));
  if (curlEl) curlEl.onclick = () => copyToClipboard(curlEl, toCurl(d), "⧉ curl");
  if (d.response) {
    const pre = document.createElement("pre");
    pre.className = "resp";
    pre.hidden = true;
    pre.textContent = d.response;
    const peek = /** @type {HTMLElement} */ (li.querySelector(".peek"));
    peek.onclick = () => {
      pre.hidden = !pre.hidden;
      peek.textContent = pre.hidden ? "view response ▾" : "hide response ▴";
    };
    li.appendChild(pre);
  }
  el("events").appendChild(li);
}

function onA11y(data) {
  const list = el("a11y");
  list.innerHTML = "";
  const vs = data.violations || [];
  const count = el("a11yCount");
  count.hidden = false;
  count.textContent = vs.length;
  count.classList.toggle("zero", vs.length === 0);
  if (!vs.length) {
    const li = document.createElement("li");
    li.className = "a11y-ok";
    li.textContent = "no basic issues found";
    list.appendChild(li);
    return;
  }
  for (const v of vs) {
    const li = document.createElement("li");
    li.className = "a11y-row";
    li.innerHTML = `<span class="rule">${esc(v.rule)}</span> ${esc(v.msg)} ${v.target ? `<code>${esc(v.target)}</code>` : ""}`;
    list.appendChild(li);
  }
}

// tabs
const TAB_PANELS = { net: "events", a11y: "a11y", docs: "docs" };
qsa(".tab").forEach((t) => {
  t.onclick = () => {
    qsa(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    for (const [k, id] of Object.entries(TAB_PANELS)) el(id).hidden = t.dataset.tab !== k;
  };
});
async function copyToClipboard(el, text, restoreLabel) {
  try {
    await navigator.clipboard.writeText(text);
    el.textContent = "✓ copied";
    setTimeout(() => (el.textContent = restoreLabel), 1200);
  } catch {}
}
el("clear").onclick = clearEvents;
el("open-tab").onclick = () => { if (current) window.open(frameUrl(), "_blank"); };
const copyLinkBtn = el("copy-link");
copyLinkBtn.onclick = () => copyToClipboard(copyLinkBtn, location.href, "link ⧉");

// search
el("story-search").oninput = debounce(() => renderStories(currentStoryList()), 120);

// keyboard nav
function moveStory(dir) {
  const btns = [...qsa(".story")];
  if (!btns.length) return;
  let i = btns.findIndex((b) => b.classList.contains("active"));
  i = i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length;
  btns[i].click();
}
document.addEventListener("keydown", (e) => {
  const active = /** @type {HTMLElement} */ (document.activeElement);
  const tag = active && active.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (e.key === "Escape" && typing) return active.blur();
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); return el("story-search").focus(); }
  if (e.key === "j") { e.preventDefault(); return moveStory(1); }
  if (e.key === "k") { e.preventDefault(); return moveStory(-1); }
  if (e.key >= "1" && e.key <= "3") return setWidth(WIDTHS[+e.key - 1].label);
  if (e.key === "m") return setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

boot();
