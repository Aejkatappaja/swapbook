# Contributing to Swapbook

Thanks for helping out. Swapbook is small and deliberately scoped, so most
changes are easy to reason about. This guide covers the layout, how to run the
tests, and the conventions the repo follows.

## The one idea to keep in mind

Swapbook is a protocol, not a framework. The binary reverse-proxies your app and
speaks the HTTP contract in [SPEC.md](SPEC.md); it knows nothing about your
language. Adapters are optional ergonomic helpers that produce those responses.
So when a change touches behavior on the wire, [SPEC.md](SPEC.md) is the source
of truth and must be updated alongside it, and every adapter should stay
consistent with the spec.

## Project layout

| Path | What lives there |
| --- | --- |
| `cmd/swapbook/` | the binary's entry point and the embedded gallery UI (`ui/`) |
| `internal/server/` | the reverse proxy, frame injection, mock wiring |
| `adapters/{go,django,rails,php}/` | the built-in adapters |
| `examples/` | runnable demo targets per stack, including dependency-free `python`/`node`/`ruby` |
| `docs/` | the guide (`guide/*.md`) and the hosted site (`docs.html`, `index.html`) |
| `test/ui/` | jsdom tests for the browser UI and inspector |
| `test/e2e/` | Playwright tests driving the real hypermedia libraries |
| `SPEC.md` | the protocol contract |

## Prerequisites

- **Go** (stable) for the binary, the Go adapter, and building.
- **Node** (20+) only if you touch the UI (`cmd/swapbook/ui/`) or the e2e tests.
- **PHP / Ruby / Python** only if you touch those adapters or example targets.

You do not need all of them. Install what the code you are changing needs.

## Running the tests

Mirror what CI runs (`.github/workflows/ci.yml`). Run the subset for what you
touched:

```sh
# Go: format, vet, build, test with the race detector
gofmt -l .            # must print nothing
go vet ./...
go build ./...
go test -race ./...

# Browser UI (jsdom) + type-check the // @ts-check UI
cd test/ui && npm ci && npm test
npx -y -p typescript tsc -p cmd/swapbook/ui/jsconfig.json

# PHP adapter (no framework needed)
php adapters/php/swapbook_test.php

# Protocol smoke across the stdlib targets (python/node/ruby)
bash examples/smoke.sh

# End-to-end probes against real Turbo/Unpoly/Datastar (needs a browser)
cd test/e2e && npm ci && npx playwright install chromium && npm test
```

The Go code is also linted with `golangci-lint run ./...`.

## Conventions

- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): subject`, e.g. `feat(adapters): optional status code per mock`.
  Common types here: `feat`, `fix`, `docs`, `test`, `chore`, `ci`.
- **Keep it small.** Prefer the minimum change that solves the problem. The
  adapters are intentionally tiny and dependency-free; new abstractions need a
  clear reason.
- **Match the surrounding style** rather than reformatting nearby code.
- **Update docs and `SPEC.md`** when behavior or the protocol changes. The site
  page `docs/docs.html` mirrors the guide, so update both.
- Fill in the pull request template: what changed, how you verified it, and the
  checklist.

## Adding a new adapter

New adapters (Flask, Phoenix, Express, Spring, and others) are welcome. You do
not need to modify the binary: implement the protocol and open a PR. Start with
[Authoring an adapter](docs/guide/authoring-adapters.md), which derives an
adapter from `SPEC.md` step by step, and use `examples/python/target.py` as a
dependency-free reference.

## Reporting bugs and ideas

Open an issue. For roadmap items, see the
[`roadmap` label](https://github.com/Aejkatappaja/swapbook/labels/roadmap).
