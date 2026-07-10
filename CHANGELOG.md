# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.2.0
[0.1.0]: https://github.com/Aejkatappaja/swapbook/releases/tag/v0.1.0
