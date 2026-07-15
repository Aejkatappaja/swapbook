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

### Registry-level mocks

Routes shared across many stories (an autocomplete endpoint, a token fetch) can
be declared once on the registry instead of repeated on every variant, like
Storybook's meta-level handlers. They are merged into every variant; a variant's
own mock for the same route takes precedence.

```go
reg.Mock("GET /app/exercises/search", ExerciseSuggestions())
reg.Mock("POST /app/workouts", Saved())
```

The same method exists on every adapter: `reg.mock(...)` in Django and Rails,
`$sb->mock(...)` in PHP.

### Error-status mocks

A mock serves `200` by default. Give it a non-2xx status to preview a component
reacting to a failure (`hx-target-error`, status-conditional swaps). Swapbook
proxies the status through unchanged, so the client library sees the real code.

**Go** uses `MockStatus("VERB /path", status, renderer)`:

```go
adapter.Var("invalid", SignupForm()).
    MockStatus("POST /signup", 422, ValidationErrors())
```

The other stacks take an optional status argument: `mock(route, render, status=422)`
in Django, `mock(route, render, status: 422)` in Rails, and
`sb_mock($route, $render, status: 422)` in PHP.

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

## Play (scripted interactions + assertions)

A variant can attach a **play**: a sequence of interactions and assertions so a
story drives and verifies a flow, not just renders a state. Hit **▶ play** in
the inspector and each step runs against the preview, reporting pass or fail.

Steps are declarative (`click`, `type`, `expect-text`, `expect-visible`,
`wait`), authored in your adapter's own language rather than JS, so there is no
`eval` and the same vocabulary works across stacks. In Go:

```go
reg.RegisterIn("interactive", "Todo list",
    adapter.Var("default", TodoList()).
        Mock("GET /ds/row", TodoRow()).
        Play(
            adapter.Click(`[hx-get="/ds/row"]`),
            adapter.ExpectText("#rows", "New task"),
        ),
)
```

The other stacks take a `play` list with matching step helpers: `play=[click(...),
expect_text(...)]` in Django, `play: [Swapbook.click(...), ...]` in Rails, and a
`$play` argument with `sb_click(...)` / `sb_expect_text(...)` in PHP.

Assertions wait: `ExpectText` / `ExpectVisible` / `Wait` poll for a few seconds,
so an assertion after a click sees the result of the htmx swap. A play stops at
the first failing step. It pairs naturally with mock mode, drive the flow with
canned responses, no auth or DB.
