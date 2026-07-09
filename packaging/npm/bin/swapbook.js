#!/usr/bin/env node
// Thin launcher for `npx swapbook`. On first run it downloads the prebuilt
// binary matching this package version + the host platform from GitHub
// Releases, caches it, and execs it. No build, no postinstall.
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { version } = require("../package.json");

const REPO = "Aejkatappaja/swapbook";

function target() {
  const p = process.platform;
  const a = process.arch;
  const goos = p === "darwin" ? "darwin" : p === "linux" ? "linux" : p === "win32" ? "windows" : null;
  const goarch = a === "x64" ? "amd64" : a === "arm64" ? "arm64" : null;
  if (!goos || !goarch) {
    console.error(`swapbook: unsupported platform ${p}/${a}`);
    process.exit(1);
  }
  return {
    goos,
    goarch,
    ext: goos === "windows" ? "zip" : "tar.gz",
    bin: goos === "windows" ? "swapbook.exe" : "swapbook",
  };
}

async function ensureBinary() {
  const { goos, goarch, ext, bin } = target();
  const cacheDir = path.join(os.homedir(), ".cache", "swapbook", version);
  const binPath = path.join(cacheDir, bin);
  if (fs.existsSync(binPath)) return binPath;

  fs.mkdirSync(cacheDir, { recursive: true });
  const asset = `swapbook_${version}_${goos}_${goarch}.${ext}`;
  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  process.stderr.write(`swapbook: downloading v${version} (${goos}/${goarch})\n`);

  const res = await fetch(url); // Node 18+ follows the release redirect for us
  if (!res.ok) {
    console.error(`swapbook: download failed (${res.status}): ${url}`);
    process.exit(1);
  }
  const archive = path.join(cacheDir, asset);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  // bsdtar (the system `tar` on macOS, Linux and Windows 10+) extracts both
  // .tar.gz and .zip, so we avoid an npm dependency.
  const r = spawnSync("tar", ["-xf", archive, "-C", cacheDir], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("swapbook: extraction failed (a `tar` on PATH is required)");
    process.exit(1);
  }
  fs.unlinkSync(archive);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

ensureBinary()
  .then((binPath) => {
    const r = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
    process.exit(r.status === null ? 1 : r.status);
  })
  .catch((err) => {
    console.error("swapbook:", err && err.message ? err.message : err);
    process.exit(1);
  });
