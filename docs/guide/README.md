# Swapbook documentation

Swapbook is a component workbench for htmx and hypermedia apps. It runs as a
single binary that reverse-proxies your running app and serves a gallery UI
under `/__sb/`, so you can build and review server-rendered components in
isolation with an htmx-aware inspector, live controls and mocked interactions.

## Guides

- [Getting started](getting-started.md): install, run, and mount the adapter.
- [Writing stories](writing-stories.md): register components and variants in Go, Django, Rails, Laravel or any stack.
- [Controls, mocks and modes](controls-mocks-modes.md): live knobs, canned responses, and the mock / safe / live gates.
- [CLI reference](cli.md): flags and usage of the `swapbook` binary.
- [Adapters](adapters.md): the built-in adapters and how to write your own.

## Reference

- [Protocol specification](../../SPEC.md): the four HTTP endpoints an app implements.
- [Project README](../../README.md): overview and comparison.
