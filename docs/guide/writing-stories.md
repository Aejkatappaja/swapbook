# Writing stories

A **story** is one component. A **variant** is one rendered state of it (empty,
error, loading, and so on). A variant's render is just a callable that returns
an HTML string, so it is decoupled from any template engine or component
library. Stories are grouped by a label that becomes a section in the sidebar.

The concepts are identical across stacks; only the syntax changes.

## Go

The Go adapter takes any `Renderer` (`Render(ctx, io.Writer) error`), which
`templ`, `html/template` and gomponents all satisfy. The module has zero
dependencies.

```go
import adapter "github.com/Aejkatappaja/swapbook/adapters/go"

reg := adapter.New()
reg.CSSSrc = "/static/app.css" // injected into bare-fragment previews

reg.RegisterIn("actions", "Button",
    adapter.Var("primary",   Button("Save", "primary")),
    adapter.Var("secondary", Button("Cancel", "secondary")),
    adapter.Var("disabled",  Button("Save", "primary", Disabled())),
)
reg.DocStory("Button", "The button primitive. `variant` and `size` are props.")
```

- `RegisterIn(group, name, ...variants)` registers a story in a sidebar group.
- `Var(name, renderer)` is a static variant.
- `DocStory(name, markdown)` attaches a docs page to the story.

See [Controls, mocks and modes](controls-mocks-modes.md) for `VarC` (live
knobs) and `.Mock(...)` (canned responses).

## Django

A variant is a callable `(args) -> str`. Works with plain templates,
django-components or cotton. Django 3.2+.

```python
from swapbook_adapter import Registry, variant

reg = Registry(css_src="/static/app.css")
reg.register("Button", group="actions",
    docs="The button primitive.",
    variants=[
        variant("primary",   lambda a: render_button("Save", "primary")),
        variant("secondary", lambda a: render_button("Cancel", "secondary")),
    ],
)

urlpatterns = reg.urls  # mounts /_swapbook/*
```

## Rails

A variant's render is a proc `(args) -> HTML`. Works with ActionView partials,
ViewComponent or Phlex. Rails 6+.

```ruby
require_relative "swapbook"

REG = Swapbook::Registry.new(css_src: "/assets/app.css")
REG.register("Button", group: "actions", docs: "The button primitive.", variants: [
  Swapbook.variant("primary",   ->(a) { render_button("Save", "primary") }),
  Swapbook.variant("secondary", ->(a) { render_button("Cancel", "secondary") }),
])

# config/routes.rb
mount REG => "/_swapbook"
```

Note: pass the registry as a constant (`REG`) to `routes.append`; a local
variable is out of scope inside the routing block.

## Laravel / PHP

A variant render is a `callable(array $args): string`. Works with Blade or plain
PHP.

```php
require 'swapbook.php';

$sb = new Swapbook();
$sb->cssSrc = '/css/app.css';
$sb->register('Button', [
    sb_variant('primary',   fn($a) => view('button', ['variant' => 'primary'])->render()),
    sb_variant('secondary', fn($a) => view('button', ['variant' => 'secondary'])->render()),
], 'actions', 'The button primitive.');

// route every /_swapbook/* request to:
[$status, $contentType, $body] = $sb->handle($method, $path, $query);
```

## Any other stack

There is no adapter requirement. Answer the four endpoints under `/_swapbook`
in any language and Swapbook drives it. See the
[protocol spec](../../SPEC.md) and the stdlib examples in
`examples/{python,node,ruby}/`.

## Full-page vs fragment previews

- A **bare fragment** (the common case) is wrapped by Swapbook in a minimal
  document, and your `HTMXSrc` / `CSSSrc` / `JSSrc` are injected so it renders
  styled and interactive.
- A **full-page** component (one that already starts with `<!doctype>` or
  `<html>`) is detected and left intact; only the inspector is injected.
