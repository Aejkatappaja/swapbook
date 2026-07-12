# Authoring an adapter

An adapter is the small piece in your app that answers the Swapbook protocol.
There is nothing special about the built-in ones: they are just ergonomic
wrappers around the four HTTP endpoints in the [protocol specification](../../SPEC.md).
This guide derives an adapter from that spec so you can add one for any stack
(Flask, Phoenix, Express, Spring, and so on).

The reference to read alongside this is `examples/python/target.py`: a complete,
dependency-free implementation in ~150 lines of stdlib. Everything below maps to
a piece of it.

## What you are building

Swapbook mounts your responses under a fixed prefix on your app:

```
/_swapbook
```

Every non-`/__sb/` request is proxied straight to your app, so htmx requests
fired from a preview reach it same-origin. Your adapter only has to answer these
four routes:

| Endpoint | Required | Purpose |
| --- | --- | --- |
| `GET /_swapbook/manifest.json` | yes | the gallery: stories, variants, control schemas, asset hints |
| `GET /_swapbook/preview/{id}/{variant}` | yes | render one component as HTML |
| `GET /_swapbook/mocks/{id}/{variant}` | for mock mode | list the routes a variant mocks |
| `ANY /_swapbook/mock/{id}/{variant}/{index}` | for mock mode | render a mock response |

Two conformance levels:

- **Minimal**: `manifest.json` + `preview`. The gallery works and previews
  render; interactions run in *safe*/*live* mode.
- **Full**: add `mocks` + `mock` to enable *mock* mode (interactions with no
  auth and no database).

## 1. Model a story

A **story** is one component with a slug `id`, a display `name`, an optional
`group`, and one or more **variants**. A variant is a name plus a render
function that returns an HTML string. That render function is the only thing
coupling the adapter to your templating, so keep it a plain callable:

```
variant = { name, render(args) -> html, controls?, docs?, mocks? }
story   = { id, name, group?, docs?, variants[] }
```

Keep a registry of stories in memory. Slugify the display name into the `id` the
same way across endpoints (lowercase, non-alphanumeric to `-`) so URLs are
stable.

## 2. Serve the manifest

`GET /_swapbook/manifest.json` returns the gallery contents and asset hints.
Emit only metadata here, not rendered HTML:

```jsonc
{
  "htmxSrc": "/static/htmx.min.js", // your app's htmx URL, or "" for the embedded fallback
  "cssSrc":  "/static/app.css",     // stylesheet injected into bare-fragment previews, or ""
  "jsSrc":   "/static/app.js",      // optional behavior script, or ""
  "viewports": [                    // optional named preview widths, added to full/tablet/phone
    { "name": "wide", "w": "1440px" }
  ],
  "stories": [
    {
      "id": "button",
      "name": "Button",
      "group": "actions",
      "variants": [
        { "name": "primary", "controls": [], "docs": "" }
      ]
    }
  ]
}
```

Content type is `application/json`.

## 3. Render a preview

`GET /_swapbook/preview/{id}/{variant}` returns the component's HTML with
`Content-Type: text/html`. Two shapes are auto-detected by Swapbook:

- **Full page** (response starts with `<!doctype` or `<html>`): served as-is,
  Swapbook only injects its inspector. The page brings its own htmx and CSS.
- **Bare fragment** (anything else): Swapbook wraps it in a minimal document and
  injects htmx (`htmxSrc` or its embedded copy), the stylesheet (`cssSrc`) and
  the inspector.

If the variant has controls, coerce the query-string values into typed args
before rendering. The rule: an absent control falls back to its default; a
present-but-empty value is a real value (so a text field can be cleared).

## 4. Coerce controls

A control has a `name`, a `type` (`text`, `number`, `bool`, `select`), a
`default`, and `options` for `select`. Coercion is the same in every adapter:

```
number -> parse, fall back to default on failure
bool   -> true for "true" / "1" / "on"
text/select -> the raw string
```

## 5. List and render mocks

For mock mode, add the last two endpoints.

`GET /_swapbook/mocks/{id}/{variant}` lists the routes a variant mocks. Return
`[]` or `404` if none. The `index` is the position Swapbook will use to fetch
the render:

```jsonc
[
  { "verb": "GET",  "path": "/app/rows", "index": 0 },
  { "verb": "POST", "path": "/app/save", "index": 1 }
]
```

`ANY /_swapbook/mock/{id}/{variant}/{index}` renders the mock HTML for that
index. It must accept any HTTP method (a mocked `POST` renders the same way). A
mock serves `200` by default; you may return a non-2xx status (422, 500) so a
component can be previewed reacting to a failure. Swapbook proxies the status
through unchanged.

## 6. (Optional) niceties the built-ins share

- **Registry-level mocks**: routes shared across stories declared once and
  merged into every variant, with a variant's own mock winning on a duplicate.
- **Per-component docs**: a `docs` markdown string on a story or variant, shown
  in the autodocs tab.

These are conveniences, not protocol requirements.

## Checklist

- [ ] `manifest.json` lists every story and variant with correct slugs.
- [ ] `preview` returns `text/html` and coerces controls (absent vs empty).
- [ ] Unknown story/variant returns `404`.
- [ ] `mocks` lists routes with stable `index` values; `mock` renders any method.
- [ ] Mock status is honored if you support error-state previews.
- [ ] The mount prefix is exactly `/_swapbook` and nothing else is intercepted.

## Test it

Point the binary at your app and open the gallery:

```sh
swapbook --target :8080
# open http://localhost:7007/__sb/
```

Check the gallery lists your stories, previews render, controls re-render, and
(for a full adapter) an interaction in mock mode is served from your mock
endpoint. When it works, open a PR: see [Contributing](../../CONTRIBUTING.md).
The dependency-free targets under `examples/{python,node,ruby}` are the smallest
working references.
