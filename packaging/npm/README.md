# swapbook

Run [Swapbook](https://github.com/Aejkatappaja/swapbook), the component workbench for htmx and hypermedia, without installing anything:

```
npx swapbook --target :8080
# then open http://localhost:7007/__sb/
```

This package is a thin launcher: on first run it downloads the prebuilt Swapbook
binary for your platform from the matching GitHub Release, caches it, and runs
it. There is no build step and no postinstall.

See the [documentation](https://aejkatappaja.github.io/swapbook/) for the full
guide.
