# Swapbook Protocol

Swapbook is a component workbench for server-rendered / hypermedia apps. The
Swapbook binary is a transparent reverse proxy in front of a running app, with
a gallery UI mounted under `/__sb/`. It knows nothing about your language or
framework: it speaks the HTTP protocol below.

Any app that answers these endpoints works with Swapbook. A framework "adapter"
is just an ergonomic helper for producing them; it is optional (see
`examples/` for Python, Node and Ruby targets that implement the protocol by
hand in ~40 lines, no adapter).

## Terminology

- **Story**, a component, identified by a slug `id`, with a display `name` and
  an optional `group` for gallery organization.
- **Variant**, one rendered state of a story (`"empty"`, `"with-data"`, …).
- **Mock**, a canned HTML response for a route, served in *mock* mode instead
  of hitting the real app.

## Mount point

All protocol endpoints live under a fixed prefix on the target app:

```
/_swapbook
```

## Endpoints

### 1. Manifest (required)

```
GET /_swapbook/manifest.json
```

Returns the gallery contents and asset hints.

```jsonc
{
  "htmxSrc": "/static/htmx.min.js",  // app-relative htmx URL, or "" to use Swapbook's embedded htmx
  "cssSrc":  "/static/app.css",      // app-relative stylesheet injected into bare-fragment previews, or ""
  "stories": [
    {
      "id": "workout-form",          // slug, used in URLs
      "name": "Workout Form",        // display name
      "group": "forms",              // optional grouping label ("" for none)
      "variants": ["new", "edit", "error"]
    }
  ]
}
```

### 2. Preview (required)

```
GET /_swapbook/preview/{id}/{variant}
```

Returns the component's HTML with `Content-Type: text/html`. Two shapes are
accepted and auto-detected by Swapbook:

- **Full page**, response starts with `<!doctype` or `<html>`. Swapbook injects
  its inspector before `</head>` and serves it as-is (the page brings its own
  htmx and CSS).
- **Bare fragment**, anything else. Swapbook wraps it in a minimal document and
  injects htmx (`htmxSrc` or its embedded copy), the stylesheet (`cssSrc`), and
  the inspector.

### 3. Mocks list (optional)

```
GET /_swapbook/mocks/{id}/{variant}
```

Lists the routes this variant mocks. Return `[]` or `404` if none.

```jsonc
[
  { "verb": "GET",  "path": "/app/workouts/entry-row", "index": 0 },
  { "verb": "POST", "path": "/app/workouts",           "index": 1 }
]
```

### 4. Mock render (only when mocks are declared)

```
{ANY METHOD} /_swapbook/mock/{id}/{variant}/{index}
```

Returns the mock HTML fragment (`Content-Type: text/html`) for the given
`index`. Must accept any HTTP method (a mocked `POST` is rendered the same way).

## How Swapbook uses these

The binary reverse-proxies every non-`/__sb/` request straight to the target,
so htmx requests fired from a preview iframe (`hx-get="/app/..."`) reach the app
same-origin: no CORS, no URL rewriting.

Each preview runs in one of three **modes**, chosen in the UI and passed into the
frame as `window.__SB = { mode, mocks }`:

- **mock** (default), requests matching a declared mock are rerouted to the
  mock render endpoint, so the interaction plays out with no auth and no real
  backend. Unmocked mutating requests (POST/PUT/DELETE/PATCH) are blocked.
- **safe**, real requests, but mutating requests are intercepted and logged
  instead of sent.
- **live**, everything hits the real app.

## Conformance

- **Minimal target**: `manifest.json` + `preview`. The gallery works; previews
  render; interactions run in *safe*/*live* mode.
- **Full target**: add `mocks` + `mock` to enable *mock* mode (interactions with
  no auth/DB).

All responses are HTML fragments or JSON as specified. No websocket, no
streaming, no auth is required by the protocol itself.

## Hypermedia libraries

The protocol is independent of the client-side hypermedia library. Preview HTML
may use htmx, and Swapbook's request interception (mock/safe modes) and inspector
currently target htmx's event model. Support for other libraries (Turbo, Unpoly,
Datastar, Alpine-AJAX) is a Swapbook-side concern (inspector probes) and does not
change this protocol.

## Versioning

This document describes protocol **v0**. Breaking changes will bump a
`protocolVersion` field added to the manifest.

## Roadmap

Shipped: manifest/preview/mocks/mock protocol · mock/safe/live modes · htmx
inspector with Turbo/Unpoly/Datastar probes · controls/knobs · response viewer ·
a11y lint · story search · framing-header strip · fragment head assets
(htmx/css/js) · zero-dep Go adapter (Renderer interface).

**A. Power-user DX (building now):**
- Deep-link URL state (story + variant + mode + width + control args in the URL; shareable, survives reload).
- Keyboard nav (`/` search, `j`/`k` stories, `1`–`3` widths, `m` modes).
- Open preview in a new tab / fullscreen.

**B. htmx-native (building now):**
- Swap-target highlight (flash the element a response landed in).
- Copy-as-curl per request (with `HX-Request` header).
- Request timing (ms) in the inspector.

**C. Parity (planned):**
- Canvas background toggle (light / dark / checker).
- Per-story docs / notes (new optional manifest field on a story or variant).
- Custom viewport sizes.

**D. Heavy (later):**
- Visual regression: screenshot each variant, diff vs a committed baseline (needs headless browser).
- Auto-reload the preview when the target rebuilds (HMR-style; needs a change signal from the target).
- Play / interaction functions: scripted interactions + assertions per story.

## Launch checklist (next session)

The product is built and proven across seven stacks; what remains is packaging
and distribution. Ordered by launch priority.

**Blockers (nothing ships without these):**

1. **Git + GitHub.** The project is not a git repo yet and is not published.
   `git init`, first commit, push to a public GitHub repo. This gates every
   other launch step (stars, issues, CI, GH Pages). Do not commit without the
   maintainer's explicit go.
2. **Distribution.** No install path exists beyond `go build`. Add, in rough
   order of value: `go install github.com/Aejkatappaja/swapbook/cmd/swapbook@latest`,
   a `goreleaser` config (prebuilt binaries per OS/arch on GitHub Releases), a
   one-line `install.sh`, then optionally Homebrew tap and an `npx swapbook`
   shim for the JS crowd.
3. **Demo GIF.** The README has a placeholder. Record the inspector + controls +
   mock flow against one demo. This is the single strongest asset for GitHub,
   Reddit and X.
4. **Doc-site / landing.** Static, sora-themed, home-first, served from GitHub
   Pages. Hero + live-ish demo + quickstart per stack + link to SPEC. The README
   links to it.

**Test coverage today:**
- **Go** adapter + proxy binary: unit tests (`go test ./...`).
- **PHP** adapter: unit test (`php adapters/php/swapbook_test.php`, or via a
  `php:8.3-cli` container without a local PHP).
- **Python / Node / Ruby** targets: e2e via `examples/smoke.sh`.
- **Django / Rails / Laravel**: e2e via `examples/smoke-docker.sh`.
- **Browser UI** (`test/ui/`, jsdom; `npm --prefix test/ui install` once, then
  `npm --prefix test/ui test`): `app.js` first-run states + inspector "ready"
  line, and `inspector.js` mock/safe/live gating for all four probes (htmx,
  Turbo, Unpoly, Datastar) driven through faked library lifecycle events.

Only the Django/Rails adapters lack dedicated unit tests (they are covered e2e).

**Post-launch (not blocking):**

- CI: GitHub Actions running `go test ./...`, `npm --prefix test/ui test`, the
  PHP adapter test, `smoke.sh` and `smoke-docker.sh`.
- `CONTRIBUTING.md` + an "authoring an adapter" guide derived from this spec, to
  seed community adapters (Flask, Phoenix, Spring, Express, …).
- Verify the Turbo / Unpoly / Datastar inspector probes end-to-end (only htmx is
  confirmed against a live app today).
- Auth helper for live-mode previews of protected routes (inject cookie/session).
- The heavy items above (visual regression, custom viewports, play functions).
