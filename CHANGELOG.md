# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-15

### Added

- **Play functions.** A variant can attach a play, a sequence of scripted
  interactions and assertions (`click` / `type` / `expect-text` /
  `expect-visible` / `wait`) run on demand against the preview, so a story
  drives and verifies a flow, not just renders a state. Declarative steps
  authored in the adapter's own language (no `eval`); hit the ▶ play button and
  each step reports pass or fail.
- **Flask and Express adapters.** The protocol now has built-in adapters for
  Python's Flask (`app.register_blueprint(reg.blueprint)`) and Node's Express
  (`app.use(reg.router())`), bringing the built-in count to six and adding both
  to the protocol smoke suite.

### Changed

- **Adapter parity.** Custom viewports and play, first shipped on the Go
  adapter, are now available on Django, Rails and PHP too, so all built-in
  adapters expose the same feature set.

## [0.4.0] - 2026-07-15

### Added

- **SSE / WebSocket inspector.** The inspector wraps `EventSource` and
  `WebSocket` and logs a long-lived connection's lifecycle (open, each message
  with direction, close, error) in a dedicated lens, so streamed events are
  traceable even though there is no discrete request.
- **Headless `swapbook check`.** A CI gate that fetches the manifest, renders
  every story/variant, and exits non-zero on failure (unreachable target,
  missing adapter, non-2xx preview, or empty render). Previews are checked
  concurrently while the report stays in manifest order.
- **Visual regression.** A Playwright harness screenshots every variant and
  diffs it against a committed baseline, so a swap that changes rendering fails
  the build. Baselines and the comparison run in a pinned Docker image so local
  and CI renders match; the CI job uploads an interactive expected/actual/diff
  report on failure.

## [0.3.0] - 2026-07-13

### Added

- **Error-status mocks.** A mock can declare a non-2xx status (422, 500, ...) so
  a component's failure state (`hx-target-error`, status-conditional swaps) can
  be previewed. `MockStatus(route, status, renderer)` in Go, and an optional
  `status` argument on the Django, Rails and Laravel adapters. Swapbook proxies
  the status through unchanged.
- **Custom viewports.** A project can declare named preview widths in its
  manifest (`reg.Viewports` on the Go adapter), added to the built-in
  full/tablet/phone. The workbench also remembers the viewport last used per
  story, while an explicit URL width still wins for shared links.
- **Auth for protected previews.** A repeatable `--header 'Name: value'` flag
  injects headers (e.g. a session cookie) into every request forwarded to the
  target, so components behind auth render in safe/live mode.

### Changed

- **Verified hypermedia probes.** The Turbo, Unpoly and Datastar inspector
  probes are now exercised against the real libraries in a browser end-to-end
  test. This surfaced and fixed a navigation guard that shadowed the Unpoly
  probe, so mock rerouting and mutation blocking now work for all three.

### Documentation

- Added `CONTRIBUTING.md` and an authoring-an-adapter guide that derives a new
  adapter from the protocol, to seed community adapters.

## [0.2.0] - 2026-07-10

### Added

- **Registry-level shared mocks.** Declare a mock once on the registry with
  `reg.Mock(...)` (`$sb->mock(...)` in PHP) and it is merged into every variant,
  like Storybook's meta-level handlers. A variant's own mock for the same route
  still takes precedence. Available on the Go, Django, Rails and Laravel adapters.
- **Out-of-band swap logging.** The inspector now flashes and logs `hx-swap-oob`
  targets, not just the primary swap target.
- **`npx swapbook`.** Run without installing via a Node launcher that fetches the
  matching prebuilt binary.

### Fixed

- **Previews behind SSE / strict CSP.** The proxy now streams Server-Sent Events
  and strips `Content-Security-Policy` from proxied responses, so previews load
  on apps that ship a CSP.
- **Version reporting.** `swapbook --version` reports the module version for
  `go install` builds instead of `(devel)`.

### Documentation

- Documented registry-level mocks and htmx version coverage (previews run your
  app's own htmx, any 1.x / 2.x version).
- Added a Limitations section to the README and docs site.
- Noted the plain-JS + JSDoc `checkJs` choice (no TypeScript, to stay zero-build).

## [0.1.0] - 2026-07-09

- Initial release: reverse-proxy workbench, 4-endpoint protocol, htmx-aware
  inspector, mock / safe / live modes, live controls, a11y lint, adapters for
  Go/templ, Django, Rails and Laravel, and install via curl / npx / go install.

[0.5.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.5.0
[0.4.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.4.0
[0.3.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.3.0
[0.2.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.2.0
[0.1.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.1.0
