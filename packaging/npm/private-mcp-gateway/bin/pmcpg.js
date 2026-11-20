#!/usr/bin/env node
// Runs the pmcpg binary from the platform package npm installed as an optional dependency.
"use strict";
const { spawnSync } = require("node:child_process");

function isMusl() {
  if (process.platform !== "linux") return false;
  try {
    const header = process.report.getReport().header;
    return !header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

const key = `${process.platform}-${process.arch}${isMusl() ? "-musl" : ""}`;
const pkg = `@baobabtech/pmcpg-${key}`;
const exe = process.platform === "win32" ? "pmcpg.exe" : "pmcpg";

let bin;
try {
  bin = require.resolve(`${pkg}/bin/${exe}`);
} catch {
  process.stderr.write(
    `pmcpg: no binary for ${key} (package ${pkg} is not installed).\n` +
      "Reinstall without --omit=optional, or download pmcpg from " +
      "https://github.com/baobab-tech/pMCPg/releases\n",
  );
  process.exit(1);
}

const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (r.error) {
  process.stderr.write(`pmcpg: ${r.error.message}\n`);
  process.exit(1);
}
if (r.signal) process.kill(process.pid, r.signal);
process.exit(r.status ?? 1);
