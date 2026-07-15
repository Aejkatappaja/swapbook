# Visual regression

The headless [`swapbook check`](cli.md#headless-check-ci) proves every component
still *renders*. Visual regression goes further: it screenshots each variant and
diffs it against a committed baseline, so a swap that changes how a component
*looks* fails the build.

Screenshots need a real browser, so this is a small [Playwright](https://playwright.dev)
harness rather than a binary command (the `swapbook` binary stays dependency-free).
The repo's own suite lives in `test/e2e/` and doubles as the pattern to copy for
your app.

## How it works

`test/e2e/visual/visual.spec.js` reads the manifest, navigates to every
`/__sb/frame/{id}/{variant}` preview, and calls Playwright's
`toHaveScreenshot()`. Baselines are committed under
`visual/visual.spec.js-snapshots/`; a mismatch beyond a small anti-aliasing
threshold fails.

Screenshots are pixel-sensitive to fonts and OS, so they run in a pinned Docker
image (`test/e2e/Dockerfile.visual`, the Playwright image plus Go) rather than a
bare runner. Local and CI renders are then byte-identical.

## Running it

```sh
# build the pinned image once (repo root)
docker build -f test/e2e/Dockerfile.visual -t swapbook-visual .

# compare against the committed baselines (what CI runs)
docker run --rm swapbook-visual

# refresh baselines after an intended visual change
docker run --rm -v "$PWD/test/e2e/visual:/work/test/e2e/visual" \
  swapbook-visual npm run test:visual:update
```

CI runs the compare on every push and pull request and uploads the diff images
as an artifact when a variant drifts.

## Notes

- Non-deterministic stories are excluded: anything time-based (a live SSE feed)
  or loaded from a CDN. Add such ids to the `EXCLUDE` set in the spec.
- To adopt it in your own project, copy `test/e2e/visual/`, the
  `playwright.visual.config.js` (point its target at your app), and the
  Dockerfile, then generate baselines once and commit them.
