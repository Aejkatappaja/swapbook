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
