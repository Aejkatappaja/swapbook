# Controls, mocks and modes

Three features turn a static preview into a workbench: editable controls, mocked
routes, and the interaction mode that gates real requests.

## Controls (live knobs)

A control adds a form input to the toolbar; changing it re-renders the variant
with the new prop. A control has a `name`, a `type` (`text`, `number`, `bool`
or `select`), a default, and options for `select`.

**Go** uses `VarC(name, controls, build)`, where `build` receives typed `Args`:

```go
reg.RegisterIn("actions", "Button",
    adapter.VarC("controls", []adapter.Control{
        {Name: "label",   Type: "text",   Default: "Save"},
        {Name: "variant", Type: "select", Default: "primary", Options: []string{"primary", "secondary", "danger"}},
        {Name: "size",    Type: "select", Default: "md", Options: []string{"sm", "md", "lg"}},
        {Name: "disabled", Type: "bool",  Default: false},
    }, func(a adapter.Args) adapter.Renderer {
        return Button(a.String("label"), a.String("variant"), a.String("size"), a.Bool("disabled"))
    }),
)
```

`Args` exposes `String`, `Int` and `Bool`. In Django, Rails and Laravel the
control list is passed alongside the render callable, and the coerced args are
handed to it as a dict / hash / array.

An absent control falls back to its default; a present-but-empty value is a real
value (so you can clear a text field).

## Mocks (canned responses)

A mock declares a canned response for a route a variant's interactions will hit,
so htmx works with no auth and no database. Swapbook rewrites the matching
request to the mock before it leaves the browser.

**Go** chains `.Mock("VERB /path", renderer)` onto a variant:

```go
reg.RegisterIn("interactive", "Todo list",
    adapter.Var("default", TodoList()).
        Mock("GET /ds/row", TodoRow()).
        Doc("Click **+ add row**: the mock returns a new `<li>` htmx appends."),
)
```

Other stacks pass a `mocks` list on the variant, e.g. Django:

```python
variant("default", todo,
    mocks=[mock("GET /ds/row", lambda a: "<li>New task</li>")])
```

## Interaction modes

The toolbar has three modes, passed into every preview. They decide what happens
to htmx requests fired from inside a story:

| Mode | Behavior |
| --- | --- |
| `mock` (default) | Declared mocks are served from the mock endpoint; unmocked **mutating** requests (POST/PUT/DELETE/PATCH) are blocked. Full interaction, no auth, no DB. |
| `safe` | Real requests hit your app, but mutating requests are blocked. Good for previewing against real read data. |
| `live` | Everything is real, including mutations. Use against a throwaway/dev database. |

The gating runs in the injected inspector, which normalizes htmx (and, best
effort, Turbo / Unpoly / Datastar) request lifecycles. A request already
rerouted to a mock is never blocked; a non-mutating `GET` is never blocked.
