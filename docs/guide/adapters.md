# Adapters

An adapter is the small piece in your app that answers the Swapbook protocol.
It is render-agnostic: a variant is a callable returning an HTML string, so an
adapter is decoupled from any specific template engine and works across
versions of a framework.

## Built-in adapters

| Stack | Import / require | Mount |
| --- | --- | --- |
| Go | `adapter "github.com/Aejkatappaja/swapbook/adapters/go"` | `mux.Handle(adapter.MountPath+"/", http.StripPrefix(adapter.MountPath, reg.Handler()))` |
| Django | `from swapbook_adapter import Registry` | `urlpatterns = reg.urls` |
| Rails | `require "swapbook"` | `mount REG => "/_swapbook"` |
| Laravel / PHP | `require "swapbook.php"` | route `/_swapbook/*` to `$sb->handle(...)` |

The adapter source lives under `adapters/{go,django,rails,php}/`. Runnable demos
for every stack are under `examples/`.

## Writing your own

You do not need an adapter at all: any server that answers four endpoints under
`/_swapbook` works. This is how the Python, Node and Ruby examples work with no
library.

| Endpoint | Purpose |
| --- | --- |
| `GET /manifest.json` | stories, variants, control schemas, asset hints |
| `GET /preview/{id}/{variant}` | render a component (accepts control args as query params) |
| `GET /mocks/{id}/{variant}` | list a variant's mocked routes |
| `ANY /mock/{id}/{variant}/{index}` | render a mock response |

Only the first two are required. The full schema, including the manifest shape
and how full-page vs fragment previews are detected, is in the
[protocol specification](../../SPEC.md).

A minimal, dependency-free reference implementation is
`examples/python/target.py` (about 140 lines of stdlib). Community adapters for
other stacks are welcome; implement the protocol and open a PR.
