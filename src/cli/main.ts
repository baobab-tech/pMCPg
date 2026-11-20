#!/usr/bin/env bun
// Entry point for the pmcpg binary.
import { type Io, runCli } from "./cli.ts";
import { commands } from "./commands.ts";
import { VERSION } from "./version.ts";

const stdio: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export function run(argv: string[], io: Io = stdio): Promise<number> {
  return runCli(commands, argv, io, VERSION);
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2));
