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
| `--version` | | Print the version and exit. |

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
