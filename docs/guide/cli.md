# CLI reference

The `swapbook` binary runs a reverse proxy in front of your app and serves the
gallery UI under `/__sb/`.

```
swapbook [flags]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--target` | `:8080` | Address of the running app to proxy. Accepts `:8080`, `localhost:8080` or a full URL like `http://127.0.0.1:3000`. |
| `--port` | `7007` | Port the Swapbook UI is served on. |
| `--header` | | Header injected into every request forwarded to the target, as `Name: value`. Repeatable. |
| `--insecure` | | Skip TLS certificate verification for the target, for a dev app behind a self-signed certificate. Also accepted by `swapbook check`. |
| `--version` | | Print the version and exit. |

## Headless check (CI)

`swapbook check` renders every story and variant once and exits non-zero if any
fail, so you can gate a build on it without opening the gallery:

```
swapbook check --target :8080
swapbook check --target https://app.localhost --insecure   # self-signed dev cert
```

It fetches the manifest, requests each `preview`, and reports one line per
variant, failing on an unreachable target, a missing adapter, a non-2xx preview,
or an empty render:

```
swapbook check → http://localhost:8080
  ok   Button · primary
  FAIL Card · empty: preview 500
29 preview(s), 1 failed
```

In CI, start your app (with the adapter mounted under a dev flag), then run the
check against it. This is a render + reachability smoke; screenshot/visual-diff
and an a11y gate are tracked separately.

## Auth for protected routes

In `safe` and `live` mode a preview's requests hit your real app, so components
behind auth get a `401`/redirect. Pass the credential your app expects with
`--header` and Swapbook injects it into every request it forwards to the target:

```
swapbook --target :8080 --header 'Cookie: session=<a-valid-dev-session>'
# repeatable, and works for any header
swapbook --target :8080 --header 'Authorization: Bearer <token>' --header 'X-Tenant: acme'
```

The gallery's own `/_swapbook` calls are not proxied, so they are unaffected;
only requests to your app carry the header. Because the value is a real
credential and appears in your shell history and process list, use a throwaway
dev session and never a production token. This is a local dev tool only.

## Targets behind a self-signed certificate

If your app is served over TLS with a certificate nothing trusts (a local
reverse proxy like Traefik or Caddy, `mkcert`, a company CA), the handshake
fails and the gallery stays empty. `--insecure` skips the verification:

```
swapbook --target https://app.localhost --insecure
```

**Pass the scheme.** A target with no scheme is treated as `http://`, where
skipping certificate verification does nothing at all. Swapbook says so on
startup rather than pretend the flag worked.

Unlike `--header`, this does apply to the gallery's own `/_swapbook` calls: a
handshake is a property of the connection, so every path to your app needs it or
none of them work.

## Examples

```
# app on :8080, UI on the default :7007
swapbook --target :8080

# app on a non-default host/port, UI on :9000
swapbook --target http://127.0.0.1:3000 --port 9000
```

Then open `http://localhost:<port>/__sb/`.

## Notes

- The UI auto-reloads when your app rebuilds: it polls the manifest and
  reloads the preview on change, and reconnects if the target goes down.
- All UI assets are served with `Cache-Control: no-store`, so a rebuilt binary
  never serves a stale gallery.
- If the target is reachable but nothing answers under `/_swapbook`, the UI
  says "no swapbook adapter" rather than reporting the app as down. Mount the
  adapter (see [Getting started](getting-started.md)).
