import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Visual regression: screenshot every story/variant of the examples/go demo and
// diff against committed baselines. Baselines are generated in the pinned Docker
// image (see Dockerfile.visual) so local and CI renders are byte-identical;
// running this config directly on macOS produces throwaway -darwin snapshots.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET_PORT = 8412;
const SB_PORT = 7018;

export default defineConfig({
  testDir: "./visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // HTML report gives an interactive expected/actual/diff viewer (with a slider)
  // for any drifted variant; uploaded as a CI artifact on failure.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${SB_PORT}`,
  },
  expect: {
    toHaveScreenshot: {
      // absorb sub-pixel anti-aliasing noise without hiding real swaps
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `go run ./examples/go -port ${TARGET_PORT}`,
      cwd: repoRoot,
      url: `http://localhost:${TARGET_PORT}/_swapbook/manifest.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
      command: `go run ./cmd/swapbook --target :${TARGET_PORT} --port ${SB_PORT}`,
      cwd: repoRoot,
      url: `http://localhost:${SB_PORT}/__sb/`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
});
