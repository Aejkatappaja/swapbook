# Getting started

Swapbook has two pieces:

1. The **binary**, which you run next to your app during development. It
   reverse-proxies the app and serves the gallery UI at `/__sb/`.
2. A tiny **adapter** in your app that answers four HTTP endpoints under
   `/_swapbook`, describing your components. There is a ready-made adapter for
   Go, Django, Rails and Laravel; any other stack can answer the endpoints
   directly (see [Adapters](adapters.md)).

## Install the binary

```
go install github.com/Aejkatappaja/swapbook/cmd/swapbook@latest
```

This drops a `swapbook` binary on your `PATH`. Check it:

```
swapbook --version
```

## Run it against your app

Start your app (say it listens on `:8080`), then:

```
swapbook --target :8080
```

Open `http://localhost:7007/__sb/`. If the gallery loads but says
"no swapbook adapter", your app is running but has not mounted the adapter yet.
That is the next step.

## Mount the adapter (Go example)

Register a component and mount the adapter on your router. Do this behind a
dev-only build tag or flag so it never ships to production.

```go
import adapter "github.com/Aejkatappaja/swapbook/adapters/go"

func Workbench() http.Handler {
    reg := adapter.New()
    reg.HTMXSrc = "/static/htmx.min.js" // your app's htmx build
    reg.CSSSrc = "/static/app.css"       // injected into bare-fragment previews
    reg.JSSrc = "/static/app.js"
    // optional: named preview widths on top of the built-in full/tablet/phone
    reg.Viewports = []adapter.Viewport{{Name: "wide", Width: "1440px"}}

    reg.RegisterIn("actions", "Button",
        adapter.Var("primary", Button("Save", "primary")),
    )
    return reg.Handler()
}

// in your dev router:
mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, Workbench()))
```

Reload `http://localhost:7007/__sb/`: the Button story appears. From here, see
[Writing stories](writing-stories.md) to add variants, controls and mocks, and
[Controls, mocks and modes](controls-mocks-modes.md) to drive interactions.

Any viewports set via `reg.Viewports` appear in the toolbar's width bar next to
the built-ins; the width you pick is remembered per story. Other stacks emit the
same `viewports` list in their manifest.

## How it works

Every request that is not part of the gallery UI is proxied to your app
unchanged, so htmx requests fired from inside a preview reach your app on the
same origin, with no CORS and no URL rewriting. Swapbook also strips
`X-Frame-Options` and CSP `frame-ancestors` from proxied responses so previews
can be framed.

```
browser  ->  swapbook :7007  ->  your app :8080
             (serves /__sb/,      (same origin,
              proxies the rest)     no CORS)
```
