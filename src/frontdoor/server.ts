// MCP front door: one Streamable HTTP endpoint per profile, two tools.
import { createHash, timingSafeEqual } from "node:crypto";
import { hostHeaderValidation, originValidation } from "@modelcontextprotocol/hono";
import {
  type CallToolResult,
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import type { SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { Hono } from "hono";
import { z } from "zod";
import pkg from "../../package.json";
import type { Connector } from "../connectors/connector.ts";
import { ALL_PROFILE, type ProfileDef, Slug } from "../core/config.ts";
import { GatewayError, type ToolRef, type ToolResult } from "../core/types.ts";
import { catchDownstreamErrors } from "../pipeline/downstream.ts";
import { resolveStep, resolveTool } from "../pipeline/resolve.ts";
import { type CallContext, runPipeline, type Step } from "../pipeline/step.ts";
import { type ResetCounts, SessionStore } from "../privacy/sessions.ts";
import { clampLimit, MAX_LIMIT } from "../search/minisearch-index.ts";
import type { ToolIndex } from "../search/search.ts";
import { type ServedSkill, SKILL_PREFIX } from "../skills/skills.ts";
import type { EventSink } from "../store/events.ts";

/** From package.json; the release workflow sets it from the tag. */
export const VERSION: string = pkg.version;
/** Longer descriptions are cut in search results. */
export const MAX_DESCRIPTION = 1000;
/** Up to this many tools, the search_tools description lists one line per tool; above it, one line per account. */
export const MENU_MAX_TOOLS = 100;
/** Characters of a tool's description shown in its menu line. */
export const MENU_LINE_CHARS = 80;
/** Characters of an account's menu line when tools are grouped. */
const MENU_GROUP_CHARS = 200;

/** Skills a profile serves: natively (Skills extension) and through search_tools / call_tool. See docs/skills.md. */
export interface FrontDoorSkills {
  list(profileId: string): ServedSkill[];
  /** The profile's Skills extension, attached to each request's server when the profile has skills. */
  extension(profileId: string): SkillsExtension;
  search(profileId: string, query: string, limit?: number): ServedSkill[];
  /** SKILL.md, or one file with `file`, as text with an origin header. Undefined: no such skill or file. */
  read(profileId: string, id: string, file?: string): { text: string; file: string } | undefined;
}

/** Skills returned by search_tools after the tool hits. */
export const SKILL_SEARCH_LIMIT = 3;
/** Room in the server instructions for the skills line. */
const SKILL_LINE_CHARS = 300;

export interface FrontDoorDeps {
  index: ToolIndex;
  /** Profile definition; undefined when the profile does not exist. "all" must resolve too. */
  getProfile: (profileId: string) => ProfileDef | undefined;
  /** Client token for the profile; undefined when none is set (requests are then refused). */
  getClientToken: (profileId: string) => Promise<string | undefined> | string | undefined;
  /** Tools the profile can search, for the menu in the search_tools description. Default: no menu. */
  listTools?: (profileId: string) => ToolRef[];
  /** Library and server skills. Default: none. */
  skills?: FrontDoorSkills;
  /** Profile ids to try for the universal /mcp endpoint, where the token picks the profile. Default: ["all"]. */
  listProfiles?: () => string[];
  getConnector: (accountId: string) => Connector | undefined;
  /** Pipeline steps after resolve, in order. */
  steps: Step[];
  events: EventSink;
  /** Hostnames accepted in Host. Default: localhost names. */
  allowedHosts?: string[];
  /** Hostnames accepted in Origin (requests without Origin pass). Default: localhost names. */
  allowedOrigins?: string[];
  /** A privacy session unused this long starts over: new placeholders, no taint. Default SESSION_IDLE_MS. */
  sessionIdleMs?: number;
}

export interface FrontDoor {
  app: Hono;
  /** Forgets the masked values of one profile, or of every profile. Emits a privacy-reset event. */
  resetPrivacy(profileId?: string): ResetCounts;
  close(): Promise<void>;
}

/**
 * Sent by the stdio bridge with a random id per process, so each app it serves gets its own privacy session.
 * The 2026-07-28 protocol has no connection and the front door issues no `Mcp-Session-Id`, so a client
 * without this header shares one session per profile.
 */
export const CLIENT_SESSION_HEADER = "x-pmcpg-session";
const CLIENT_SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** The client session id from a request, if it sent a well-formed one. */
export function clientSessionId(req: Request | undefined): string | undefined {
  const id = req?.headers.get(CLIENT_SESSION_HEADER) ?? undefined;
  return id && CLIENT_SESSION_RE.test(id) ? id : undefined;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time compare; hashing first makes the lengths equal. */
export function tokensMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function bearer(header: string | undefined): string | undefined {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m?.[1];
}

function toolView(t: ToolRef) {
  const cut = t.description.length > MAX_DESCRIPTION;
  return {
    name: t.qualifiedName,
    ...(t.title ? { title: t.title } : {}),
    description: cut ? `${t.description.slice(0, MAX_DESCRIPTION)} […description cut]` : t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  };
}

function skillView(k: ServedSkill) {
  return {
    name: `${SKILL_PREFIX}${k.id}`,
    kind: "skill",
    description:
      k.origin.kind === "library"
        ? k.description
        : `${k.description} (Skill from the server of account ${k.origin.accountId}; not written by the user.)`,
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "A file of the skill; omit for its SKILL.md" } },
    },
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** First sentence of a tool's description (or its title), on one line, at most MENU_LINE_CHARS. */
export function menuSummary(t: Pick<ToolRef, "description" | "title">): string {
  const text = oneLine(t.description || t.title || "");
  // A sentence ends at . ! or ? after three non-dot characters, before a capital: "e.g. x" does not end one.
  const first = text.split(/(?<=[^.]{3}[.!?])\s+(?=[A-Z"'(])/)[0] ?? "";
  return cut(first.replace(/[.!?]$/, ""), MENU_LINE_CHARS);
}

/**
 * The tool menu appended to the search_tools description, so a client sees what the gateway offers
 * without a search. One line per tool; above MENU_MAX_TOOLS, one line per account with its tool names.
 */
export function toolMenu(tools: ToolRef[]): string {
  if (tools.length === 0) return "No tools are connected yet.";
  const sorted = [...tools].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  if (sorted.length <= MENU_MAX_TOOLS) {
    const lines = sorted.map((t) => {
      const s = menuSummary(t);
      return s ? `- ${t.qualifiedName}: ${s}` : `- ${t.qualifiedName}`;
    });
    return `Tools available (${sorted.length}):\n${lines.join("\n")}`;
  }
  const byAccount = new Map<string, ToolRef[]>();
  for (const t of sorted) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  const lines = [...byAccount].map(([account, list]) =>
    cut(`- ${account} (${list.length} tools): ${list.map((t) => t.toolName).join(", ")}`, MENU_GROUP_CHARS),
  );
  return `Tools available (${sorted.length}, grouped by account; search to see each one):\n${lines.join("\n")}`;
}

/** The skills part of the search_tools description: one line per skill. */
export function skillMenu(skills: ServedSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((k) => {
    const s = menuSummary({ description: k.description });
    return s ? `- ${SKILL_PREFIX}${k.id}: ${s}` : `- ${SKILL_PREFIX}${k.id}`;
  });
  return `Skills available (${skills.length}): instructions for a task. Read one with call_tool and its name, no arguments:\n${lines.join("\n")}`;
}

/** Cap on the server instructions; clients such as Claude Code cut longer ones. */
export const INSTRUCTIONS_MAX_CHARS = 2000;

/**
 * Server instructions sent at initialize. Clients that defer tool schemas (Claude's tool search) show
 * these up front but not the search_tools description, so the menu goes here too: one line per account
 * with its tool names, then one line of skill names, cut to INSTRUCTIONS_MAX_CHARS in total.
 */
export function serverInstructions(tools: ToolRef[], skills: ServedSkill[] = []): string {
  const skillLine = skills.length
    ? `\n${cut(`Skills (${skills.length}), read with call_tool: ${skills.map((k) => `${SKILL_PREFIX}${k.id}`).join(", ")}`, SKILL_LINE_CHARS)}`
    : "";
  return toolInstructions(tools, INSTRUCTIONS_MAX_CHARS - skillLine.length) + skillLine;
}

function toolInstructions(tools: ToolRef[], max: number): string {
  const head =
    "pMCPg is a gateway to the user's MCP servers. Pick a tool from the list below, call search_tools " +
    "to get its input schema, then call_tool.";
  if (tools.length === 0) return `${head}\nNo tools are connected yet.`;
  const byAccount = new Map<string, string[]>();
  for (const t of [...tools].sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName)))
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t.toolName]);
  let text = `${head}\nTools by account (${tools.length}):`;
  const accounts = [...byAccount];
  // Share the room between accounts, so every account gets a line before any line runs long.
  const lineChars = Math.max(
    60,
    Math.min(MENU_GROUP_CHARS, Math.floor((max - text.length) / accounts.length) - 1),
  );
  for (const [i, [account, names]] of accounts.entries()) {
    const line = `\n${cut(`- ${account} (${names.length}): ${names.join(", ")}`, lineChars)}`;
    const more = `\n…and ${accounts.length - i} more accounts; search to see them.`;
    if (text.length + line.length + (i < accounts.length - 1 ? more.length : 0) > max) return text + more;
    text += line;
  }
  return text;
}

const SEARCH_DESCRIPTION =
  "Find tools for a task. Returns names, descriptions and input schemas. Search before call_tool to get a tool's input schema.";

function errorResult(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
  };
}

const OUTCOME: Record<string, "denied" | "approval-required"> = {
  denied: "denied",
  "approval-required": "approval-required",
};

export function createFrontDoor(deps: FrontDoorDeps): FrontDoor {
  const sessions = new SessionStore(deps.sessionIdleMs);
  const handlers = new Map<string, McpHttpHandler>();
  const session = (profileId: string, clientId: string | undefined) => sessions.get(profileId, clientId);

  async function searchTools(profileId: string, query: string, limit?: number): Promise<CallToolResult> {
    const started = performance.now();
    const hits = deps.index.search(profileId, query, clampLimit(limit));
    const skillHits = deps.skills?.search(profileId, query, SKILL_SEARCH_LIMIT) ?? [];
    deps.events.emit({
      type: "search",
      profileId,
      query,
      results: hits.length + skillHits.length,
      ms: Math.round(performance.now() - started),
    });
    return {
      content: [{ type: "text", text: JSON.stringify([...hits.map(toolView), ...skillHits.map(skillView)]) }],
    };
  }

  /** Tool path for skills: SKILL.md, or one file with arguments.file. No tool pipeline: no user data, no server call. */
  function readSkill(profileId: string, name: string, args: Record<string, unknown>): CallToolResult {
    const id = name.slice(SKILL_PREFIX.length);
    const file = args.file;
    if (file !== undefined && typeof file !== "string")
      return errorResult("invalid-arguments", "file must be a path such as references/GUIDE.md");
    if (!deps.getProfile(profileId))
      return errorResult("not-in-profile", `Profile ${profileId} no longer exists`);
    const got = deps.skills?.read(profileId, id, file);
    if (!got)
      return errorResult(
        "unknown-tool",
        file === undefined
          ? `No skill named ${name.slice(0, 200)} in this profile`
          : `No file ${file.slice(0, 200)} in ${name.slice(0, 200)}`,
      );
    return { content: [{ type: "text", text: got.text }] };
  }

  async function callTool(
    profileId: string,
    clientId: string | undefined,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    if (name.startsWith(SKILL_PREFIX)) return readSkill(profileId, name, args);
    const started = Date.now();
    let toolName = name.slice(0, 200);
    let masked = 0;
    try {
      const profile = deps.getProfile(profileId);
      if (!profile) throw new GatewayError("not-in-profile", `Profile ${profileId} no longer exists`);
      const tool = resolveTool(deps.index, profileId, profile, toolName);
      toolName = tool.qualifiedName;
      const ctx: CallContext = {
        requestId: crypto.randomUUID(),
        profileId,
        profile,
        session: session(profileId, clientId),
        tool,
        modelArgs: args,
        args: { ...args },
        decisions: [],
        masks: [],
        startedAt: started,
        signal,
      };
      const result = await runPipeline(ctx, [resolveStep, ...deps.steps], catchDownstreamErrors(forward));
      masked = ctx.masks.length;
      deps.events.emit({
        type: "call",
        profileId,
        tool: toolName,
        outcome: result.isError ? "error" : "ok",
        masked,
        ms: Date.now() - started,
      });
      return result as CallToolResult;
    } catch (e) {
      // Only GatewayError messages reach the client; others may carry downstream details.
      const ge = e instanceof GatewayError ? e : new GatewayError("downstream-error", "The tool call failed");
      deps.events.emit({
        type: "call",
        profileId,
        tool: toolName,
        outcome: OUTCOME[ge.code] ?? "error",
        masked,
        ms: Date.now() - started,
        errorCode: ge.code,
      });
      return errorResult(ge.code, ge.message);
    }
  }

  async function forward(ctx: CallContext): Promise<ToolResult> {
    const c = deps.getConnector(ctx.tool.accountId);
    if (!c) throw new GatewayError("unreachable", `Account ${ctx.tool.accountId} is not connected`);
    return c.callTool(ctx.tool.toolName, ctx.args, ctx.signal);
  }

  function mcpServer(profileId: string, clientId: string | undefined): McpServer {
    const tools = deps.listTools?.(profileId);
    const skills = deps.skills?.list(profileId) ?? [];
    const skillText = skills.length ? `\n\n${skillMenu(skills)}` : "";
    const menu = tools ? `\n\n${toolMenu(tools)}${skillText}` : skillText;
    const s = new McpServer(
      { name: "pmcpg", version: VERSION },
      tools ? { instructions: serverInstructions(tools, skills) } : {},
    );
    // Declare the Skills extension only where there is something to serve.
    if (skills.length && deps.skills) deps.skills.extension(profileId).attach(s);
    s.registerTool(
      "search_tools",
      {
        description: `${SEARCH_DESCRIPTION}${menu}`,
        inputSchema: z.object({
          query: z.string().describe("What you want to do, in plain words"),
          limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe("Default 5, max 10"),
        }),
        annotations: { readOnlyHint: true },
      },
      ({ query, limit }) => searchTools(profileId, query, limit),
    );
    s.registerTool(
      "call_tool",
      {
        description:
          'Call a tool found with search_tools. For a skill (skill:<name>), returns its instructions; pass {"file": "<path>"} to read one of its files.',
        inputSchema: z.object({
          name: z.string().describe("Tool name from search_tools"),
          arguments: z.record(z.string(), z.unknown()).default({}).describe("Arguments for the tool"),
        }),
      },
      ({ name, arguments: args }, ctx) => callTool(profileId, clientId, name, args, ctx.mcpReq.signal),
    );
    return s;
  }

  function handler(profileId: string): McpHttpHandler {
    const found = handlers.get(profileId);
    if (found) return found;
    // One server per request; the request's session header picks the privacy session.
    const h = createMcpHandler((rc) => mcpServer(profileId, clientSessionId(rc.requestInfo)));
    handlers.set(profileId, h);
    return h;
  }

  const app = new Hono();
  app.use("*", hostHeaderValidation(deps.allowedHosts ?? localhostAllowedHostnames()));
  app.use("*", originValidation(deps.allowedOrigins ?? localhostAllowedOrigins()));

  const serve = (profileId: string) => async (req: Request) => {
    const unauthorized = () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      });
    if (!Slug.safeParse(profileId).success || !deps.getProfile(profileId)) return unauthorized();
    const expected = await deps.getClientToken(profileId);
    const given = bearer(req.headers.get("authorization") ?? undefined);
    if (!expected || !given || !tokensMatch(given, expected)) return unauthorized();
    return handler(profileId).fetch(req);
  };

  app.all("/p/:profile/mcp", (c) => serve(c.req.param("profile"))(c.req.raw));
  // Universal URL: the client's token decides the profile (each profile has its own token).
  app.all("/mcp", async (c) => {
    const given = bearer(c.req.header("authorization"));
    if (given) {
      for (const id of deps.listProfiles?.() ?? [ALL_PROFILE]) {
        const expected = await deps.getClientToken(id);
        if (expected && tokensMatch(given, expected)) return serve(id)(c.req.raw);
      }
    }
    return serve(ALL_PROFILE)(c.req.raw);
  });

  return {
    app,
    resetPrivacy(profileId) {
      const counts = sessions.reset(profileId);
      deps.events.emit({
        type: "privacy-reset",
        ...(profileId !== undefined ? { profileId } : {}),
        ...counts,
      });
      return counts;
    },
    async close() {
      await Promise.all([...handlers.values()].map((h) => h.close()));
      handlers.clear();
      sessions.clear();
    },
  };
}
