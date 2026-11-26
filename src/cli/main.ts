#!/usr/bin/env bun
// Entry point for the pmcpg binary.
import { type Io, runCli } from "./cli.ts";
import { commands } from "./commands.ts";
import { launchFromApp } from "./launch.ts";
import { launchedFromApp } from "./launcher.ts";
import { VERSION } from "./version.ts";

const stdio: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export function run(argv: string[], io: Io = stdio): Promise<number> {
  return runCli(commands, argv, io, VERSION);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  process.exitCode = launchedFromApp(argv) ? await launchFromApp() : await run(argv);
}
