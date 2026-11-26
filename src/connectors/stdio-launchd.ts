// macOS: start a stdio server as its own launchd job, so macOS privacy checks
// (Reminders, Calendar, Contacts, Photos) see the server, not pmcpg.
//
// macOS attributes privacy access to the "responsible process". A child of pmcpg has
// pmcpg as responsible; a program launchd starts is responsible for itself.
//
// Public mechanisms only (launchd.plist(5), launchctl(1), execve(2)):
// - One job per server start, loaded with `launchctl bootstrap gui/<uid>` and removed
//   with `launchctl bootout`.
// - `Sockets` + `inetdCompatibility`: launchd listens on a Unix socket in a 0700
//   directory and starts the program with the accepted connection as stdin and stdout.
// - The program is `pmcpg __launchd-exec <command>`. It reads the arguments, environment
//   and working directory from the socket, writes its pid back, then execve()s the
//   command. The pid stays the same, so the server is still the launchd-started process.
//
// The plist holds paths and the label only. Arguments and environment, which can carry
// vault secrets, go over the socket and never touch disk.
import {
  accessSync,
  closeSync,
  constants as fsc,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { type JSONRPCMessage, ReadBuffer, serializeMessage } from "@modelcontextprotocol/client";
import { GatewayError } from "../core/types.ts";

/** Hidden first argument of the pmcpg binary that runs the exec step inside the job. */
export const LAUNCHD_EXEC_ARG = "__launchd-exec";

const LAUNCHCTL = "/bin/launchctl";
const MKFIFO = "/usr/bin/mkfifo";
const LABEL_PREFIX = "io.github.baobab-tech.pmcpg.stdio";
/** Upper bound for the spec sent to the exec step. */
const MAX_SPEC_BYTES = 1024 * 1024;
/** Unix socket paths are limited to 104 bytes on macOS. */
const MAX_SOCKET_PATH = 103;

/**
 * True when stdio servers start as launchd jobs: on macOS, unless
 * `PMCPG_STDIO_LAUNCHD=0` turns it off.
 */
export function launchdAvailable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return platform === "darwin" && env.PMCPG_STDIO_LAUNCHD !== "0";
}

/** The command that starts this binary: the compiled binary, or bun plus `src/cli/main.ts`. */
export function defaultSelfProgram(execPath = process.execPath): string[] {
  if (/(^|[\\/])bun(\.exe)?$/i.test(execPath)) {
    return [execPath, path.join(import.meta.dir, "..", "cli", "main.ts")];
  }
  return [execPath];
}

/** What the exec step receives over the socket. */
export interface ExecSpec {
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface LaunchdTransportOptions {
  /** Absolute path of the server command. Fixed in the plist, not in the spec. */
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  /** Account id, used in the job label. */
  name: string;
  /** Called with each chunk the server writes to stderr. */
  onStderr?: (chunk: Buffer) => void;
  /** Command that starts pmcpg. Default `defaultSelfProgram()`. */
  selfProgram?: string[];
  /** Time allowed for the job to start and report its pid. Default 15 s. */
  startTimeoutMs?: number;
}

let counter = 0;

/** Job label: prefix, gateway pid, account id (safe characters only), counter. */
export function jobLabel(name: string, pid = process.pid): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "server";
  counter++;
  return `${LABEL_PREFIX}.${pid}.${safe}.${counter}`;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The job's plist. Holds the label, paths and the command; no arguments or environment. */
export function jobPlist(o: {
  label: string;
  program: string[];
  socketPath: string;
  stderrPath: string;
}): string {
  const args = o.program.map((a) => `<string>${xml(a)}</string>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(o.label)}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>inetdCompatibility</key><dict><key>Wait</key><false/></dict>
<key>Sockets</key><dict><key>stdio</key><dict>
<key>SockPathName</key><string>${xml(o.socketPath)}</string>
<key>SockPathMode</key><integer>384</integer>
</dict></dict>
<key>StandardErrorPath</key><string>${xml(o.stderrPath)}</string>
<key>ProcessType</key><string>Standard</string>
<key>ExitTimeOut</key><integer>5</integer>
</dict></plist>
`;
}

/** Runs launchctl without a shell and with a fixed environment. */
async function launchctl(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn([LAUNCHCTL, ...args], {
    env: { PATH: "/usr/bin:/bin" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr: stderr.trim() };
}

/**
 * MCP client transport to a server running as a launchd job.
 * Implements the SDK's `Transport` interface; framing is the SDK's stdio framing.
 */
export class LaunchdTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  /** PID of the server, known once `start()` resolves. */
  pid: number | undefined;

  private readonly opts: LaunchdTransportOptions;
  readonly label: string;
  private readonly uid = process.getuid?.() ?? 0;
  private dir: string | undefined;
  private socket: net.Socket | undefined;
  private stderrFds: number[] = [];
  private readonly readBuffer = new ReadBuffer();
  private loaded = false;
  private closed = false;

  constructor(opts: LaunchdTransportOptions) {
    this.opts = opts;
    this.label = jobLabel(opts.name);
  }

  async start(): Promise<void> {
    if (this.socket) throw new Error("LaunchdTransport already started");
    try {
      await this.startJob();
    } catch (e) {
      await this.cleanup();
      throw new GatewayError(
        "unreachable",
        `could not start server as a launchd job: ${(e as Error).message}`,
      );
    }
  }

  private async startJob(): Promise<void> {
    const dir = mkdtempSync(path.join(tmpdir(), "pmcpg-"));
    this.dir = dir;
    const socketPath = path.join(dir, "s");
    const stderrPath = path.join(dir, "e");
    const plistPath = path.join(dir, "job.plist");
    if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH)
      throw new Error(`socket path too long: ${socketPath}`);

    // stderr: a FIFO. Holding a read-write descriptor keeps launchd's open from failing
    // or blocking; a separate non-blocking reader feeds onStderr.
    const mk = Bun.spawnSync([MKFIFO, "-m", "600", stderrPath], { env: { PATH: "/usr/bin:/bin" } });
    if (!mk.success) throw new Error("mkfifo failed");
    this.stderrFds.push(openSync(stderrPath, fsc.O_RDWR));
    const stderrRead = openSync(stderrPath, fsc.O_RDONLY | fsc.O_NONBLOCK);
    this.stderrFds.push(stderrRead);
    void this.pumpStderr(stderrRead);

    const program = [...(this.opts.selfProgram ?? defaultSelfProgram()), LAUNCHD_EXEC_ARG, this.opts.command];
    writeFileSync(plistPath, jobPlist({ label: this.label, program, socketPath, stderrPath }), {
      mode: 0o600,
    });
    const boot = await launchctl(["bootstrap", `gui/${this.uid}`, plistPath]);
    rmSync(plistPath, { force: true });
    if (boot.code !== 0) throw new Error(`launchctl bootstrap failed (${boot.code}): ${boot.stderr}`);
    this.loaded = true;

    const socket = await connect(socketPath, this.opts.startTimeoutMs ?? 15_000);
    this.socket = socket;
    // Nobody else needs to reach the job: remove the path once connected.
    rmSync(socketPath, { force: true });

    const spec: ExecSpec = { args: this.opts.args, env: this.opts.env, cwd: this.opts.cwd };
    const body = Buffer.from(JSON.stringify(spec), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    socket.write(Buffer.concat([header, body]));

    this.pid = await readPid(socket, this.opts.startTimeoutMs ?? 15_000);
    socket.on("data", (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      this.drain();
    });
    socket.on("error", (e) => this.onerror?.(e));
    socket.on("close", () => void this.finish());
  }

  private drain(): void {
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.readBuffer.readMessage();
      } catch (e) {
        this.onerror?.(e as Error);
        continue;
      }
      if (message === null) return;
      this.onmessage?.(message);
    }
  }

  private async pumpStderr(fd: number): Promise<void> {
    try {
      for await (const chunk of Bun.file(fd).stream()) this.opts.onStderr?.(Buffer.from(chunk));
    } catch {
      // descriptor closed at shutdown
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.destroyed) return reject(new Error("Not connected"));
      socket.write(serializeMessage(message), (e) => (e ? reject(e) : resolve()));
    });
  }

  /** Ends the server's stdin. The server should exit on its own. */
  endInput(): void {
    this.socket?.end();
  }

  /** Closes the connection and removes the job. The caller kills the process tree. */
  async close(): Promise<void> {
    this.socket?.end();
    this.socket?.destroy();
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cleanup();
    this.onclose?.();
  }

  private async cleanup(): Promise<void> {
    this.socket?.destroy();
    this.readBuffer.clear();
    for (const fd of this.stderrFds.splice(0)) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
    if (this.loaded) {
      this.loaded = false;
      await launchctl(["bootout", `gui/${this.uid}/${this.label}`]).catch(() => {});
    }
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = undefined;
  }
}

/** Connects to the job's socket, retrying while launchd sets it up. */
async function connect(socketPath: string, timeoutMs: number): Promise<net.Socket> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect(socketPath);
        s.once("connect", () => {
          s.removeAllListeners("error");
          resolve(s);
        });
        s.once("error", reject);
      });
    } catch (e) {
      if (Date.now() > end) throw new Error(`launchd job did not open its socket: ${(e as Error).message}`);
      await Bun.sleep(25);
    }
  }
}

/** Reads the 4-byte pid the exec step writes before execve. */
function readPid(socket: net.Socket, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => fail(new Error("launchd job did not report its pid")), timeoutMs);
    const fail = (e: Error) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("close", onClose);
      reject(e);
    };
    const onClose = () => fail(new Error("launchd job exited before starting the server"));
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("close", onClose);
      const rest = buf.subarray(4);
      resolve(buf.readUInt32BE(0));
      // Bytes after the pid are the server's first output.
      if (rest.length > 0) queueMicrotask(() => socket.emit("data", rest));
    };
    socket.on("data", onData);
    socket.once("close", onClose);
  });
}

// --- exec step, runs inside the launchd job ---

/** Reads exactly `n` bytes from fd 0. launchd may hand over a non-blocking socket. */
function readExact(n: number): Buffer {
  const buf = Buffer.alloc(n);
  let off = 0;
  while (off < n) {
    let r: number;
    try {
      r = readSync(0, buf, off, n - off, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EAGAIN") {
        Bun.sleepSync(2);
        continue;
      }
      throw e;
    }
    if (r === 0) throw new Error("connection closed before the spec was read");
    off += r;
  }
  return buf;
}

/** Validates the spec read from the socket. */
export function parseSpec(raw: unknown): ExecSpec {
  const s = raw as Partial<ExecSpec> | null;
  if (!s || typeof s !== "object") throw new Error("spec is not an object");
  if (!Array.isArray(s.args) || !s.args.every((a) => typeof a === "string")) throw new Error("bad args");
  if (!s.env || typeof s.env !== "object" || Array.isArray(s.env)) throw new Error("bad env");
  for (const v of Object.values(s.env)) if (typeof v !== "string") throw new Error("bad env");
  if (s.cwd !== undefined && typeof s.cwd !== "string") throw new Error("bad cwd");
  return { args: s.args, env: s.env, cwd: s.cwd };
}

/**
 * `pmcpg __launchd-exec <command>`: reads the spec from stdin, writes the pid to stdout,
 * then replaces itself with `<command>`. Exits 70 on any failure.
 */
export function launchdExec(argv: string[]): never {
  try {
    const command = argv[0];
    if (!command || !path.isAbsolute(command)) throw new Error("command must be an absolute path");
    const len = readExact(4).readUInt32BE(0);
    if (len > MAX_SPEC_BYTES) throw new Error("spec too large");
    const spec = parseSpec(JSON.parse(readExact(len).toString("utf8")));
    if (spec.cwd) process.chdir(spec.cwd);
    // Fail before reporting the pid, so the gateway sees a start failure, not an exit.
    accessSync(command, fsc.X_OK);
    const pid = Buffer.alloc(4);
    pid.writeUInt32BE(process.pid);
    let off = 0;
    while (off < 4) {
      try {
        off += writeSync(1, pid, off, 4 - off);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
        Bun.sleepSync(2);
      }
    }
    if (!process.execve) throw new Error("execve is not available");
    process.execve(command, [command, ...spec.args], spec.env);
  } catch (e) {
    process.stderr.write(`pmcpg launchd exec: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  process.exit(70);
}
