<p align="center">
  <img src="assets/logo-wordmark.svg" width="300" alt="Swapbook">
</p>

<p align="center">
  <b>Storybook for htmx &amp; hypermedia.</b> One binary, zero JS toolchain.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#try-the-demos">Demos</a> ·
  <a href="docs/guide/">Docs</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="SPEC.md">Protocol</a> ·
  <a href="examples/">Examples</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

---

Swapbook is a component workbench for server-rendered apps. Point it at your
running app and it renders your components in isolation, with an htmx-aware
inspector, live controls, and mocked interactions, so you can build and review
UI without clicking through the whole app.

It is **framework-agnostic**: the binary speaks a tiny HTTP protocol, so it works
with Go/templ, Django, Rails, Laravel, Flask, Phoenix, or a plain server, with
no per-framework requirement and no Node build step.

```
swapbook --target :8080
# open http://localhost:7007/__sb/
```

<!-- TODO(launch): replace with a real demo.gif (inspector + controls + mock in action) -->
<p align="center"><i>Demo gif coming soon. In the meantime, <a href="#try-the-demos">run the demos locally</a>.</i></p>

## Install

```
# prebuilt binary (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/Aejkatappaja/swapbook/main/install.sh | sh

# or run without installing (Node)
npx swapbook --target :8080

# or with Go
go install github.com/Aejkatappaja/swapbook/cmd/swapbook@latest
```

Prebuilt binaries for macOS, Linux and Windows (amd64 / arm64) are attached to
every [release](https://github.com/Aejkatappaja/swapbook/releases).

## Why

Storybook is built around JS components; its HTML/Server modes are awkward and
drag in a JS toolchain, the opposite of why you reached for htmx. The good
server-rendered tools that exist are locked to one framework: Lookbook (Rails),
phoenix_storybook (LiveView), django-lookbook (Django).

Swapbook fills the gap: a single tool for any hypermedia backend, with the parts
a hand-rolled `/preview` page can't give you.

- **One binary.** Static assets embedded. No `node_modules`, no config file.
- **htmx-aware inspector.** See every request, its params, status, timing, the
  swap target highlighted in the preview, and the returned HTML.
- **Three interaction modes.** `mock` (serve canned responses, no auth/DB),
  `safe` (real requests, mutations blocked), `live` (everything real).
- **Live controls.** Edit a component's props from the toolbar and re-render.
- **a11y lint, search, deep-links, keyboard-driven.**

The gallery UI is plain JavaScript, type-checked with JSDoc and `checkJs` in CI,
not TypeScript: the whole tool is zero-build, so a compile step would defeat the
point. The binary itself is Go with no dependencies.

## Quickstart

### Go / templ

Add the adapter and register your components:

```go
import adapter "github.com/Aejkatappaja/swapbook/adapters/go"

func Workbench() http.Handler {
    reg := adapter.New()
    reg.HTMXSrc = "/static/htmx.min.js" // your app's htmx
    reg.CSSSrc = "/static/app.css"       // injected into bare-fragment previews
    reg.JSSrc = "/static/app.js"

    reg.RegisterIn("forms", "Workout Form",
        adapter.Var("new", WorkoutForm(user, store.Workout{}, "", "/app/workouts", "new")),
        // live controls: edit props from the UI
        adapter.VarC("controls", []adapter.Control{
            {Name: "heading", Type: "text", Default: "new workout"},
            {Name: "errMsg", Type: "text", Default: ""},
        }, func(a adapter.Args) adapter.Renderer {
            return WorkoutForm(user, store.Workout{}, a.String("errMsg"), "/app/workouts", a.String("heading"))
        }),
        // mock a route so interactions run with no auth/DB
        adapter.Var("empty", WorkoutForm(...)).
            Mock("GET /app/workouts/entry-row", EntryRow(store.WorkoutEntry{})),
    )
    return reg.Handler()
}
```

Mount it (dev only) and run Swapbook against your app:

```go
mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, Workbench()))
```

```
swapbook --target :8080
```

The Go adapter takes any `Renderer` (`Render(ctx, io.Writer) error`), so templ,
`html/template`, and gomponents all work. The Swapbook module itself has zero
dependencies.

### Django

```python
from swapbook_adapter import Registry, control, variant

reg = Registry(css_src="/static/app.css")
reg.register("Button", group="actions", variants=[
    variant("primary", lambda a: render_button("Save", "primary")),
    variant("controls", lambda a: render_button(a["label"], a["variant"]), controls=[
        control("label", "text", "Save"),
        control("variant", "select", "primary", options=["primary", "secondary"]),
    ]),
])

urlpatterns = reg.urls  # mounts /_swapbook/*
```

A variant is any callable `(args) -> html str`, so plain templates,
django-components and cotton all work. Django 3.2+.

### Rails

```ruby
require_relative "swapbook"

REG = Swapbook::Registry.new(css_src: "/assets/app.css")
REG.register("Button", group: "actions", variants: [
  Swapbook.variant("primary", ->(a) { render_button("Save", "primary") }),
  Swapbook.variant("controls", ->(a) { render_button(a["label"], a["variant"]) }, controls: [
    Swapbook.control("label", default: "Save"),
    Swapbook.control("variant", type: "select", default: "primary", options: %w[primary secondary]),
  ]),
])

# in config/routes.rb:  mount REG => "/_swapbook"
```

A variant's render is a proc `(args) -> HTML`, so ActionView partials,
ViewComponent and Phlex all work. Rails 6+.

### Laravel / Blade

```php
require 'swapbook.php';

$sb = new Swapbook();
$sb->cssSrc = '/css/app.css';
$sb->register('Button', [
    sb_variant('primary', fn($a) => view('button', ['variant' => 'primary'])->render()),
    sb_variant('controls', fn($a) => view('button', $a)->render(), [
        sb_control('label', 'text', 'Save'),
        sb_control('variant', 'select', 'primary', ['primary', 'secondary']),
    ]),
], 'actions');

// route all of /_swapbook/* to:  $sb->handle($method, $path, $query)
```

### Web Components

Any custom element renders as-is: return the element's HTML (plus its script
tag) from a variant. The demos use [@aejkatappaja/phantom-ui](https://www.npmjs.com/package/@aejkatappaja/phantom-ui)
loaded from a CDN.

### Any other stack

There is no adapter requirement. Answer four HTTP endpoints and you are done,
in any language. `examples/{python,node,ruby}/` are dependency-free stdlib
targets that implement the protocol by hand. See [SPEC.md](SPEC.md).

```
examples/smoke.sh   # boots Python/Node/Ruby targets behind Swapbook and checks them
```

## Try the demos

Every stack ships a runnable demo of the same component design system, so you
can see Swapbook drive each one. Bring them all up with Docker:

```
docker compose -f examples/docker-compose.yml up --build
swapbook --target :8000            # then point the binary at any target
```

| Stack | Container port | Demo |
| --- | --- | --- |
| Django | `:8000` | full design system |
| Rails | `:8001` | full design system |
| Go | `:8002` | full design system |
| Laravel | `:8003` | full design system |
| Python / Node / Ruby | `:9101` / `:9102` / `:9103` | stdlib subset |

Or run a single stdlib target with no Docker: `go run ./examples/go` (then
`swapbook --target :8000`).

## How it works

Swapbook runs as a transparent reverse proxy in front of your app, with its UI
mounted under `/__sb/`. Any request that isn't part of the UI is proxied to your
app unchanged, so htmx requests fired from a preview reach your app same-origin,
with no CORS and no URL rewriting. It also strips `X-Frame-Options` /
`frame-ancestors` from proxied responses so previews can be framed.

The protocol is four endpoints on your app under `/_swapbook`:

| Endpoint | Purpose |
| --- | --- |
| `GET /manifest.json` | stories, variants, control schemas, asset hints |
| `GET /preview/{id}/{variant}` | render a component (accepts control args) |
| `GET /mocks/{id}/{variant}` | list a variant's mocked routes |
| `ANY /mock/{id}/{variant}/{i}` | render a mock response |

Only the first two are required. Full details in [SPEC.md](SPEC.md).

## Documentation

Full guides live in [`docs/guide/`](docs/guide/):

- [Getting started](docs/guide/getting-started.md): install, run, mount the adapter.
- [Writing stories](docs/guide/writing-stories.md): register components in Go, Django, Rails, Laravel or any stack.
- [Controls, mocks and modes](docs/guide/controls-mocks-modes.md): live knobs, canned responses, the mock / safe / live gates.
- [CLI reference](docs/guide/cli.md): flags and usage.
- [Adapters](docs/guide/adapters.md): built-in adapters and writing your own.
- [Authoring an adapter](docs/guide/authoring-adapters.md): derive a new adapter for any stack from the protocol.

The [protocol spec](SPEC.md) documents the four endpoints an app implements.
Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Compared to

| | Swapbook | Storybook (server) | Lookbook | phoenix_storybook |
| --- | :---: | :---: | :---: | :---: |
| Framework-agnostic | ✅ | partial | Rails | LiveView |
| No JS toolchain | ✅ | ❌ | ✅ | ✅ |
| Single binary | ✅ | ❌ | ❌ | ❌ |
| htmx-aware inspector | ✅ | ❌ | ❌ | ❌ |
| Mocked interactions | ✅ | via MSW | ❌ | ❌ |

## Roadmap

Shipped: protocol · mock/safe/live modes · htmx inspector (with Turbo, Unpoly and
Datastar probes, verified end to end) · error-status mocks · controls · response
viewer · a11y lint · search · deep-links · keyboard nav · copy-as-curl ·
swap-target and out-of-band highlight · canvas background toggle · custom
viewports · per-component autodocs · auto-reload · install via curl / npx /
go install.

Planned: visual regression, play/interaction functions, Homebrew. Tracked in the
[roadmap](https://github.com/Aejkatappaja/swapbook/labels/roadmap).

## Status

Early. The protocol is proven across seven stacks with tests: Go/templ, Django,
Rails and Laravel via adapters, plus dependency-free Python, Node and Ruby
targets. Interfaces may still shift before a tagged release.

## Limitations

Swapbook is early and deliberately scoped. Known edges:

- **htmx is the verified path, any version.** Previews load your app's own htmx
  via `htmxSrc`, so they run whatever version you ship (1.x or 2.x); the embedded
  fallback used when `htmxSrc` is unset is htmx 2.0.4. The Turbo, Unpoly and
  Datastar inspector probes are best-effort; they are exercised against the real
  libraries in a browser end-to-end test, but htmx remains the most complete path.
- **Auto-triggering components.** A preview with `hx-trigger="load"` or polling
  (`every 2s`) fires real GET requests to your app in mock and safe mode; only
  mutations are blocked. Mock those routes, or run against a dev database.
- **SSE and WebSocket** connections are proxied through, but the inspector does
  not visualize their events (there is no discrete request to trace).
- **Mocks are stateless.** A declared route returns a fixed response (a mock may
  set a non-2xx status like 422/500 to exercise error swaps), so multi-step
  stateful flows are out of scope.
- **CSS.** Bare-fragment previews load your app's declared `cssSrc`. If your
  styles are code-split or purged per route, point `cssSrc` at the full
  stylesheet so previews match the app. Full-page components bring their own.
- **Relative asset paths** inside a bare fragment may not resolve; prefer
  app-absolute paths like `/static/...`.

Swapbook strips security headers and proxies your app, so it is a local
development tool only. Never run it in production or expose it publicly.

## License

MIT.
