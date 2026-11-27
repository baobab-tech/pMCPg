// Stdio connector: one local server process per account, started on first use.
import type { ChildProcess } from "node:child_process";
import { Client, ProtocolError, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { AccountDef, ServerDef } from "../core/config.ts";
import { type AccountState, GatewayError, type ToolResult } from "../core/types.ts";
import type { Connector, ConnectorDeps, DownstreamSkill, DownstreamTool } from "./connector.ts";
import { listServerSkills, readServerSkillFile, SKILLS_CLIENT_CAPABILITIES } from "./skills.ts";
import { buildEnv, effectivePath, resolveArgs, resolveCommand } from "./stdio-env.ts";
import { descendants, killAll, taskkillTree } from "./stdio-tree.ts";

export interface StdioOptions {
  /** Stop the process after this long without calls. Default 10 min. */
  idleMs?: number;
  /** Timeout for the first start (npx and uvx download). Default 120 s. */
  firstStartTimeoutMs?: number;
  /** Timeout for later starts. Default 30 s. */
  startTimeoutMs?: number;
  /** Lines of stderr kept for diagnostics. Default 200. */
  stderrLines?: number;
}

export interface StdioConnector extends Connector {
  /** Absolute path of the server command, or undefined if it was not found. For the UI. */
  resolvedCommand(): Promise<string | undefined>;
  /** Last lines the server wrote to stderr, with vault secrets redacted. */
  stderrTail(): string[];
  /** PID of the running server process, if any. */
  pid(): number | undefined;
}

type StdioServerDef = Extract<ServerDef, { transport: "stdio" }>;

const CLIENT_INFO = { name: "pmcpg", version: "0.0.0" };

export function createStdioConnector(
  accountId: string,
  account: AccountDef,
  server: ServerDef,
  deps: ConnectorDeps,
  options: StdioOptions = {},
): StdioConnector {
  if (server.transport !== "stdio") throw new Error(`server for ${accountId} is not a stdio server`);
  return new Stdio(accountId, account, server, deps, options);
}

interface Running {
  client: Client;
  transport: StdioClientTransport;
  pid: number;
}

class Stdio implements StdioConnector {
  private current: AccountState = { status: "stopped" };
  private running: Running | undefined;
  private starting: Promise<Running> | undefined;
  private stopping: Promise<void> | undefined;
  private started = false;
  private active = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private secrets: string[] = [];
  private stderr: string[] = [];
  private partial = "";
  private readonly toolListeners = new Set<() => void>();
  private readonly stateListeners = new Set<(s: AccountState) => void>();
  private readonly idleMs: number;
  private readonly firstStartTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly stderrLines: number;

  constructor(
    readonly accountId: string,
    private readonly account: AccountDef,
    private readonly server: StdioServerDef,
    private readonly deps: ConnectorDeps,
    options: StdioOptions,
  ) {
    this.idleMs = options.idleMs ?? 10 * 60_000;
    this.firstStartTimeoutMs = options.firstStartTimeoutMs ?? 120_000;
    this.startTimeoutMs = options.startTimeoutMs ?? 30_000;
    this.stderrLines = options.stderrLines ?? 200;
  }

  state(): AccountState {
    return this.current;
  }

  pid(): number | undefined {
    return this.running?.pid;
  }

  stderrTail(): string[] {
    return this.partial ? [...this.stderr, this.redact(this.partial)] : [...this.stderr];
  }

  async resolvedCommand(): Promise<string | undefined> {
    return resolveCommand(this.server.command, {
      PATH: await effectivePath(),
      PATHEXT: process.env.PATHEXT,
      cwd: this.server.cwd,
    });
  }

  onToolsChanged(listener: () => void): () => void {
    this.toolListeners.add(listener);
    return () => this.toolListeners.delete(listener);
  }

  onStateChange(listener: (s: AccountState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async listTools(signal?: AbortSignal): Promise<DownstreamTool[]> {
    return this.use(signal, async (client) => {
      const tools: DownstreamTool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { signal, cacheMode: "bypass" });
        for (const t of page.tools) {
          tools.push({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            annotations: t.annotations as Record<string, unknown> | undefined,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    });
  }

  listSkills(signal?: AbortSignal): Promise<DownstreamSkill[]> {
    return this.use(signal, (client) => listServerSkills(client, signal));
  }

  readSkillFile(skill: DownstreamSkill, uri: string, signal?: AbortSignal): Promise<Uint8Array> {
    return this.use(signal, (client) => readServerSkillFile(client, skill, uri, signal));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    return this.use(signal, async (client) => {
      const result = await client.callTool({ name, arguments: args }, { signal });
      return {
        content: (result.content ?? []) as ToolResult["content"],
        structuredContent: result.structuredContent as Record<string, unknown> | undefined,
        isError: result.isError,
      };
    });
  }

  async close(): Promise<void> {
    this.clearIdle();
    await this.starting?.catch(() => {});
    await this.stop();
  }

  // --- lifecycle ---

  private async use<T>(signal: AbortSignal | undefined, fn: (client: Client) => Promise<T>): Promise<T> {
    this.active++;
    this.clearIdle();
    try {
      const running = await this.ensureStarted(signal);
      return await fn(running.client);
    } catch (e) {
      throw this.mapError(e, signal);
    } finally {
      this.active--;
      this.armIdle();
    }
  }

  private async ensureStarted(signal?: AbortSignal): Promise<Running> {
    if (this.stopping) await this.stopping;
    if (this.running) return this.running;
    this.starting ??= this.start(signal).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(signal?: AbortSignal): Promise<Running> {
    this.setState({ status: "starting" });
    const PATH = await effectivePath();
    const command = resolveCommand(this.server.command, {
      PATH,
      PATHEXT: process.env.PATHEXT,
      cwd: this.server.cwd,
    });
    if (!command) {
      const reason = `command not found: ${this.server.command}`;
      this.setState({ status: "unreachable", reason });
      throw new GatewayError("unreachable", reason);
    }
    const { env, secrets } = await buildEnv(this.server.env, this.account.env, this.deps.vault, PATH);
    const resolved = await resolveArgs(this.server.args, this.deps.vault);
    this.secrets = [...secrets, ...resolved.secrets];
    this.stderr = [];
    this.partial = "";

    const transport = new StdioClientTransport({
      command,
      args: resolved.args,
      env,
      cwd: this.server.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => this.captureStderr(chunk));

    const client = new Client(CLIENT_INFO, {
      capabilities: SKILLS_CLIENT_CAPABILITIES,
      listChanged: {
        tools: { autoRefresh: false, debounceMs: 100, onChanged: () => this.emitToolsChanged() },
      },
    });

    const timeout = this.started ? this.startTimeoutMs : this.firstStartTimeoutMs;
    let exitCode: number | null = null;
    try {
      await client.connect(transport, { timeout, signal });
    } catch (e) {
      const pid = transport.pid;
      if (pid) await killTree(pid, transport);
      else await transport.close().catch(() => {});
      const err = this.mapError(e, signal);
      this.setState({ status: "unreachable", reason: err.message });
      throw err;
    }

    const pid = transport.pid ?? 0;
    // The SDK keeps the ChildProcess private; read it only to learn the exit code.
    const child = (transport as unknown as { _process?: ChildProcess })._process;
    child?.once("exit", (code) => {
      exitCode = code;
    });
    const running: Running = { client, transport, pid };
    client.onclose = () => {
      if (this.running !== running) return;
      this.running = undefined;
      this.deps.events.emit({
        type: "server-exited",
        accountId: this.accountId,
        code: exitCode ?? child?.exitCode ?? null,
      });
      this.setState({
        status: "error",
        reason: `server exited (code ${exitCode ?? child?.exitCode ?? "unknown"})`,
      });
    };

    this.running = running;
    this.started = true;
    this.deps.events.emit({ type: "server-spawned", accountId: this.accountId, pid });
    this.setState({ status: "connected" });
    return running;
  }

  private async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const running = this.running;
    if (!running) return;
    this.running = undefined;
    this.stopping = (async () => {
      await killTree(running.pid, running.transport, running.client);
      this.deps.events.emit({ type: "server-exited", accountId: this.accountId, code: null });
      this.setState({ status: "stopped" });
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  private armIdle(): void {
    if (this.active > 0 || !this.running) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.active === 0) void this.stop();
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // --- helpers ---

  private setState(s: AccountState): void {
    this.current = s;
    for (const l of this.stateListeners) {
      try {
        l(s);
      } catch {
        // a listener must not break the connector
      }
    }
  }

  private emitToolsChanged(): void {
    for (const l of this.toolListeners) {
      try {
        l();
      } catch {
        // a listener must not break the connector
      }
    }
  }

  private captureStderr(chunk: Buffer): void {
    const lines = (this.partial + chunk.toString("utf8")).split(/\r?\n/);
    this.partial = lines.pop() ?? "";
    for (const line of lines) this.stderr.push(this.redact(line));
    if (this.stderr.length > this.stderrLines) this.stderr.splice(0, this.stderr.length - this.stderrLines);
  }

  private redact(text: string): string {
    let out = text;
    for (const s of this.secrets) out = out.split(s).join("[redacted]");
    return out;
  }

  private mapError(e: unknown, signal?: AbortSignal): Error {
    if (e instanceof GatewayError) return e;
    if (signal?.aborted) return e instanceof Error ? e : new Error(String(e));
    const msg = this.redact(e instanceof Error ? e.message : String(e));
    if (e instanceof SdkError) {
      if (e.code === SdkErrorCode.RequestTimeout)
        return new GatewayError("timeout", `${this.accountId}: ${msg}`);
      if (
        e.code === SdkErrorCode.ConnectionClosed ||
        e.code === SdkErrorCode.NotConnected ||
        e.code === SdkErrorCode.SendFailed
      ) {
        return new GatewayError("unreachable", `${this.accountId}: server not reachable (${msg})`);
      }
      return new GatewayError("downstream-error", `${this.accountId}: ${msg}`);
    }
    if (e instanceof ProtocolError) return new GatewayError("downstream-error", `${this.accountId}: ${msg}`);
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPIPE") {
      return new GatewayError("unreachable", `${this.accountId}: could not start server (${code})`);
    }
    return new GatewayError("downstream-error", `${this.accountId}: ${msg}`);
  }
}

/** Stops the server and everything it started. */
async function killTree(pid: number, transport: StdioClientTransport, client?: Client): Promise<void> {
  if (process.platform === "win32") {
    await taskkillTree(pid);
    await (client ?? transport).close().catch(() => {});
    return;
  }
  // List descendants first: once the server exits they are re-parented and untraceable.
  const tree = descendants(pid);
  await (client ?? transport).close().catch(() => {});
  killAll(tree);
}
