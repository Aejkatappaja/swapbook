import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET_PORT = 8402;
const SB_PORT = 7008;

// Two Go processes: the target app running the adapter, and the Swapbook binary
// reverse-proxying it (which is what injects the real inspector we're testing).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${SB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `go run ./test/e2e/target -port ${TARGET_PORT}`,
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
