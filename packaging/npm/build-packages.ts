// Builds the npm packages from release binaries: one @baobabtech/pmcpg-<os>-<arch> package per target,
// plus private-mcp-gateway, whose launcher picks the right one at run time.
//
//   bun packaging/npm/build-packages.ts --version 0.1.0 --bin-dir bin --out npm-out [--targets linux-x64,darwin-arm64]
//
// <bin-dir>/pmcpg-<target>/pmcpg[.exe] is the layout the release workflow downloads.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const SCOPE = "@baobabtech";
const REPO = "https://github.com/baobab-tech/pMCPg";

/** Release target name → npm os/cpu/libc. The package key matches process.platform-process.arch[-musl]. */
const TARGETS = [
  { target: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { target: "darwin-x64", os: "darwin", cpu: "x64" },
  { target: "windows-x64", os: "win32", cpu: "x64" },
  { target: "windows-arm64", os: "win32", cpu: "arm64" },
  { target: "linux-x64", os: "linux", cpu: "x64", libc: "glibc" },
  { target: "linux-arm64", os: "linux", cpu: "arm64", libc: "glibc" },
  { target: "linux-x64-musl", os: "linux", cpu: "x64", libc: "musl" },
  { target: "linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl" },
] as const;

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    "bin-dir": { type: "string" },
    out: { type: "string" },
    targets: { type: "string" },
  },
});
const version = values.version;
const binDir = values["bin-dir"];
const out = values.out;
if (!version || !binDir || !out || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: bun packaging/npm/build-packages.ts --version X.Y.Z --bin-dir <dir> --out <dir> [--targets a,b]");
  process.exit(2);
}
const only = values.targets?.split(",");
const targets = TARGETS.filter((t) => !only || only.includes(t.target));
if (only && targets.length !== only.length) {
  console.error(`unknown target in --targets ${values.targets}`);
  process.exit(2);
}

const root = join(import.meta.dir, "..", "..");
const license = join(root, "LICENSE");
rmSync(out, { recursive: true, force: true });

const optionalDependencies: Record<string, string> = {};
for (const t of TARGETS) {
  const key = `${t.os}-${t.cpu}${"libc" in t && t.libc === "musl" ? "-musl" : ""}`;
  const name = `${SCOPE}/pmcpg-${key}`;
  optionalDependencies[name] = version;
  if (!targets.includes(t)) continue;

  const exe = t.os === "win32" ? "pmcpg.exe" : "pmcpg";
  const src = join(binDir, `pmcpg-${t.target}`, exe);
  if (!existsSync(src)) throw new Error(`missing binary: ${src}`);
  const dir = join(out, `pmcpg-${key}`);
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(src, join(dir, "bin", exe));
  chmodSync(join(dir, "bin", exe), 0o755);
  copyFileSync(license, join(dir, "LICENSE"));
  writeFileSync(join(dir, "README.md"), `# ${name}\n\nThe \`pmcpg\` binary for ${key}. Install \`private-mcp-gateway\` instead.\n`);
  const pkg = {
    name,
    version,
    description: `pMCPg binary for ${key}`,
    license: "Apache-2.0",
    repository: { type: "git", url: `git+${REPO}.git` },
    os: [t.os],
    cpu: [t.cpu],
    ...("libc" in t ? { libc: [t.libc] } : {}),
    files: [`bin/${exe}`],
    preferUnplugged: true,
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${name}@${version}`);
}

const main = join(out, "private-mcp-gateway");
const template = join(import.meta.dir, "private-mcp-gateway");
mkdirSync(join(main, "bin"), { recursive: true });
copyFileSync(join(template, "bin", "pmcpg.js"), join(main, "bin", "pmcpg.js"));
chmodSync(join(main, "bin", "pmcpg.js"), 0o755);
copyFileSync(join(template, "README.md"), join(main, "README.md"));
copyFileSync(license, join(main, "LICENSE"));
const pkg = JSON.parse(readFileSync(join(template, "package.json"), "utf8"));
writeFileSync(join(main, "package.json"), `${JSON.stringify({ ...pkg, version, optionalDependencies }, null, 2)}\n`);
console.log(`private-mcp-gateway@${version}`);
