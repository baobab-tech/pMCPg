// Client for the gateway's UI API (/api/ui). Same origin; the session cookie is HttpOnly.
// State-changing requests carry the CSRF token returned by /session and /login.

export type AccountState =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "connected" }
  | { status: "sign-in-needed"; reason: string }
  | { status: "unreachable"; reason: string; retryAt?: number }
  | { status: "error"; reason: string };

export interface Session {
  authenticated: boolean;
  passwordSet: boolean;
  passwordRequired: boolean;
  needsSetupCode: boolean;
  /** No password and no session: only a launch link from `pmcpg open` gets in. */
  needsLaunchLink?: boolean;
  setupDone: boolean;
  csrf?: string;
}

export interface Status {
  url: string;
  servers: number;
  accounts: { id: string; state: AccountState; tools: number }[];
  profiles: number;
  pendingApprovals: number | null;
  quarantined: number | null;
  /** Server skills waiting for review; null when skills are not available. */
  skillReviews?: number | null;
  features: { approvals: boolean; activity: boolean; pins: boolean; skills?: boolean };
}

export interface Server {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  target: string;
  allowInsecure: boolean;
  trust: string[];
  accounts: string[];
}

export interface Account {
  id: string;
  label: string | null;
  server: string;
  serverName: string;
  transport: "stdio" | "http" | "sse" | null;
  auth: "none" | "oauth" | "header";
  signedIn: boolean | null;
  headers: { name: string; set: boolean }[];
  env: { name: string; secret: boolean; set: boolean; value?: string }[];
  /** Secret URL query parameters (e.g. apiKey), stored in the vault. */
  params: { name: string; set: boolean }[];
  /** OAuth client ID when the provider needs one registered by hand. */
  clientId: string | null;
  /** Skills the server publishes: off, text (Markdown and plain text only) or all files. */
  skills: SkillMode;
  state: AccountState;
  tools: number;
  profiles: string[];
}

export type Privacy = "off" | "standard" | "strict";
export type Preset = "open" | "balanced" | "careful";

export interface Profile {
  id: string;
  name: string;
  builtIn: boolean;
  accounts: string[];
  privacy: Privacy;
  preset: Preset;
  customRules: number;
  readOnly: boolean;
  /** Library skills it serves. "all" serves every one. */
  skills: string[];
  url: string;
}

export interface Snippet {
  id: "claude-code" | "claude-desktop" | "vscode" | "http";
  title: string;
  hint: string;
  language: "bash" | "json" | "text";
  code: string;
}

export interface Settings {
  host: string;
  port: number;
  url: string;
  keySource: "keychain" | "env";
  passwordSet: boolean;
  passwordRequired: boolean;
}

export interface ApprovalRequest {
  id: string;
  createdAt: number;
  profileId: string;
  tool: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt?: number;
  /** The call's arguments as the AI sent them (placeholders, secrets redacted). Pending requests only. */
  preview?: string;
}

export interface ActivityEntry {
  id: number;
  at: number;
  event: { type: string; [k: string]: unknown };
}

export interface DownstreamTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** One tool as the "Show tools" view gets it (GET /accounts/:id/tools). */
export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface QuarantinedTool {
  accountId: string;
  toolName: string;
  reason: "new" | "changed";
  pinned?: DownstreamTool;
  current: DownstreamTool;
}

// ---- skills (src/api/skills.ts, docs/skills.md) ----

export type SkillMode = "off" | "text" | "all";

export interface SkillFileInfo {
  path: string;
  size: number;
  digest: string;
}

export interface LibrarySkill {
  name: string;
  description: string;
  files: SkillFileInfo[];
  profiles: string[];
}

export interface ServerSkill {
  accountId: string;
  path: string;
  id: string;
  name: string;
  description: string;
  /** held: waiting for review; the approved version, if any, is still served. */
  status: "active" | "held" | "rejected";
  served: boolean;
  files: SkillFileInfo[];
}

export interface SkillsOverview {
  available: boolean;
  library: LibrarySkill[];
  server: ServerSkill[];
  reviews: number;
}

export interface SkillReview {
  accountId: string;
  path: string;
  reason: "new" | "changed";
  status: "pending" | "rejected";
  pinnedSkillMd?: string;
  currentSkillMd: string;
  pinnedFiles?: SkillFileInfo[];
  currentFiles: SkillFileInfo[];
}

/** A file sent to create or replace a library skill: text, or base64 for binary files. */
export type SkillFileBody = { path: string; text: string } | { path: string; base64: string };

export interface SkillFileContent {
  path: string;
  size: number;
  text?: string;
  base64?: string;
}

export interface Listing<T> {
  available: boolean;
  items: T[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let csrf = "";
let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function remember(s: Session): Session {
  csrf = s.csrf ?? "";
  return s;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    init.headers = { "content-type": "application/json", "x-csrf-token": csrf };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api/ui${path}`, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/login") && !path.startsWith("/session")) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),

  session: async () => remember(await request<Session>("GET", "/session")),
  login: async (password: string) => remember(await request<Session>("POST", "/login", { password })),
  logout: () => request<{ ok: true }>("POST", "/logout"),
  setupPassword: async (password: string, setupCode?: string) =>
    remember(await request<Session>("POST", "/setup/password", { password, setupCode })),
  changePassword: async (current: string | undefined, password: string) =>
    remember(await request<Session>("POST", "/password", { current, password })),
  removePassword: async (password: string | undefined) =>
    remember(await request<Session>("DELETE", "/password", { password })),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Lowercase slug from a display name: "Work Gmail" → "work-gmail". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// ---- onboarding (src/api/onboarding.ts) ----

export type ProbeAuth =
  | { type: "none" }
  | {
      type: "oauth";
      issuer: string;
      registration: "dcr" | "cimd" | "manual";
      scopes?: string[];
      /** One-click app creation for a known provider (src/onboarding/app-setup.ts). */
      setup?: AppSetup;
    }
  | { type: "header"; hint: string };

export type AppSetup = { provider: string; createUrl: string; steps: string[]; secretNeeded: boolean };

export type ProbeResult =
  | { ok: true; url: string; transport: "http" | "sse"; auth: ProbeAuth; serverName?: string; suggestedId: string }
  | { ok: false; url: string; error: string };

export type ConnectAppId = "claude-desktop" | "claude-code" | "lm-studio" | "cursor" | "vscode";

export type FoundServer =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http" | "sse"; url: string };

export interface ImportCandidate {
  key: string;
  suggestedId: string;
  server: FoundServer;
  envNames: string[];
  headerNames: string[];
  secretParams: string[];
  foundIn: {
    app: ConnectAppId;
    appLabel: string;
    name: string;
    file: string;
    project?: string;
    viaMcpRemote?: boolean;
    extension?: boolean;
  }[];
  alreadyAdded: boolean;
}

export interface ImportScan {
  apps: { id: ConnectAppId; label: string; servers: number }[];
  candidates: ImportCandidate[];
  note: string;
}

export interface ImportOutcome {
  key: string;
  status: "added" | "already-added" | "skipped-self" | "skipped-secret";
  accountId?: string;
  needsSignIn?: boolean;
  missingValues?: string[];
  probeError?: string;
}

export interface ConnectPlan {
  app: ConnectAppId;
  /** "stdio": the app runs `pmcpg connect`, no token in its settings. "http": fallback, the token is written. */
  transport: "stdio" | "http";
  file?: string;
  entryName: string;
  remove: string[];
  suggestedRemove: string[];
  preview?: string;
  commands?: string[];
  after: string[];
}

export interface ConnectResult {
  file?: string;
  backup?: string;
  ran?: { command: string; code: number }[];
}

export interface AppConnectStatus {
  app: ConnectAppId;
  label: string;
  /** The app's settings folder or file exists on this computer. */
  installed: boolean;
  /** The app has an entry pointing at this gateway. */
  connected: boolean;
  /** Profiles its gateway entries use ("all" for the universal URL). */
  profiles: string[];
}
