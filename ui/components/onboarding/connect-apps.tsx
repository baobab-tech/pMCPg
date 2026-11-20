"use client";

import {
  CheckCircle2Icon,
  CirclePlayIcon,
  CloudOffIcon,
  FileCogIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppLogo, type LogoId } from "@/components/app-logos";
import { ChoiceCards, CodeBlock, CopyButton, ErrorNote, Field, RevealToken } from "@/components/common";
import { ConnectPanel } from "@/components/connect-panel";
import { AppTour, type TourApp, useConnectInfo } from "@/components/onboarding/app-tours";
import { Advanced } from "@/components/server-form";
import { PASSWORD_HINT, PASSWORD_LABEL, PasswordHelp } from "@/components/info-tip";
import { useSession } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type AppConnectStatus, api, type ConnectAppId, type ConnectPlan, type ConnectResult, errorMessage, type Profile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AdvancedOnly, useView } from "@/components/view";

/** Apps set up by hand: pMCPg shows where to paste a snippet that runs `pmcpg connect <profile>`. */
type ManualApp = {
  id: string;
  label: string;
  sub: string;
  /** Letters on the neutral tile (no bundled logo). */
  mono: string;
  /** Where to paste it, in the app's own words. */
  where: string;
  snippet: (profile: string) => string;
};

/** Pretty JSON with short string arrays kept on one line. */
const json = (o: unknown) =>
  JSON.stringify(o, null, 2).replace(/\[\s+((?:"[^"]*",?\s*)+)\]/g, (_, items: string) =>
    `[${items.trim().split(/,\s*/).join(", ")}]`,
  );
const stdio = (profile: string) => ({ command: "pmcpg", args: ["connect", profile] });
const mcpServers = (profile: string) => json({ mcpServers: { pmcpg: stdio(profile) } });

const MANUAL: ManualApp[] = [
  {
    id: "windsurf",
    label: "Windsurf",
    sub: "Editor, by hand",
    mono: "W",
    where: "Windsurf Settings → Cascade → MCP Servers → View raw config (~/.codeium/windsurf/mcp_config.json). Add:",
    snippet: mcpServers,
  },
  {
    id: "zed",
    label: "Zed",
    sub: "Editor, by hand",
    mono: "Z",
    where: "Zed Settings → AI → MCP Servers → Add Custom Server, or add this to Zed's settings.json:",
    snippet: (p) => json({ context_servers: { pmcpg: { ...stdio(p), env: {} } } }),
  },
  {
    id: "jetbrains",
    label: "JetBrains IDEs",
    sub: "Editor, by hand",
    mono: "JB",
    where: "Settings → Tools → AI Assistant → Model Context Protocol (MCP) → Add, then paste:",
    snippet: mcpServers,
  },
  {
    id: "kiro",
    label: "Kiro",
    sub: "Editor, by hand",
    mono: "K",
    where: "Add this to ~/.kiro/settings/mcp.json:",
    snippet: mcpServers,
  },
  {
    id: "cline",
    label: "Cline",
    sub: "VS Code extension, by hand",
    mono: "Cl",
    where: "In Cline: MCP Servers → Configure MCP Servers, then add:",
    snippet: mcpServers,
  },
  {
    id: "codex",
    label: "Codex CLI",
    sub: "Terminal, by hand",
    mono: "Cx",
    where: "Run this in a terminal:",
    snippet: (p) => `codex mcp add pmcpg -- pmcpg connect ${p}`,
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    sub: "Terminal, by hand",
    mono: "G",
    where: "Add this to ~/.gemini/settings.json:",
    snippet: mcpServers,
  },
  {
    id: "opencode",
    label: "OpenCode",
    sub: "Terminal, by hand",
    mono: "OC",
    where: "Add this to opencode.json (~/.config/opencode/opencode.json for every project):",
    snippet: (p) => json({ mcp: { pmcpg: { type: "local", command: ["pmcpg", "connect", p], enabled: true } } }),
  },
  {
    id: "goose",
    label: "Goose",
    sub: "Terminal or desktop, by hand",
    mono: "Go",
    where: "Run goose configure → Add Extension → Command-line Extension. Name it pmcpg and use this command:",
    snippet: (p) => `pmcpg connect ${p}`,
  },
  {
    id: "pi",
    label: "Pi",
    sub: "Terminal, by hand",
    mono: "π",
    where:
      "Pi has no MCP support built in. Install an MCP extension (for example pi install npm:pi-mcp-adapter), then add this to ~/.pi/agent/mcp.json:",
    snippet: mcpServers,
  },
  {
    id: "other",
    label: "Other MCP app",
    sub: "Any app that runs MCP servers",
    mono: "",
    where: "Most apps take a JSON list of servers. Add pmcpg as a local (stdio) server:",
    snippet: mcpServers,
  },
];

type TileId = ConnectAppId | "perplexity" | "chatgpt" | "cloud" | `manual:${string}`;

type Tile = { id: TileId; label: string; sub: string; logo?: LogoId; mono?: string };

const TILES: Tile[] = [
  { id: "claude-desktop", label: "Claude Desktop", sub: "Desktop app", logo: "claude-desktop" },
  { id: "chatgpt", label: "ChatGPT", sub: "Desktop app", logo: "chatgpt" },
  { id: "claude-code", label: "Claude Code", sub: "Terminal", logo: "claude-code" },
  { id: "cursor", label: "Cursor", sub: "Editor", logo: "cursor" },
  { id: "vscode", label: "VS Code", sub: "Editor", logo: "vscode" },
  { id: "lm-studio", label: "LM Studio", sub: "Local models", logo: "lm-studio" },
  { id: "perplexity", label: "Perplexity", sub: "Mac app, by hand", logo: "perplexity" },
  ...MANUAL.map((m): Tile => ({ id: `manual:${m.id}`, label: m.label, sub: m.sub, mono: m.mono })),
  { id: "cloud", label: "Web apps", sub: "Not supported yet" },
];

/** Apps pMCPg sets up itself (plan, confirm, apply). */
function isPlanApp(t: TileId | undefined): t is ConnectAppId {
  return !!t && !t.startsWith("manual:") && t !== "perplexity" && t !== "chatgpt" && t !== "cloud";
}

/** Tiles shown before "Show all apps". */
const FIRST = 9;

function TileIcon({ t }: { t: Tile }) {
  if (t.logo) return <AppLogo app={t.logo} />;
  const box = "flex size-9 shrink-0 items-center justify-center rounded-lg";
  if (t.id === "cloud")
    return (
      <span className={cn(box, "bg-muted text-muted-foreground")}>
        <CloudOffIcon className="size-4" />
      </span>
    );
  if (!t.mono)
    return (
      <span className={cn(box, "border border-dashed text-muted-foreground")}>
        <PlugIcon className="size-4" />
      </span>
    );
  return <span className={cn(box, "border bg-background text-xs font-semibold text-foreground")}>{t.mono}</span>;
}

function Tiles({
  value,
  onChange,
  onTour,
  connected,
}: {
  value?: TileId;
  onChange: (t: TileId) => void;
  onTour: (t: TourApp) => void;
  connected: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(() => TILES.findIndex((t) => t.id === value) >= FIRST);
  const q = query.trim().toLowerCase();
  const shown = q
    ? TILES.filter((t) => `${t.label} ${t.sub}`.toLowerCase().includes(q))
    : all
      ? TILES
      : TILES.slice(0, FIRST);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${TILES.length} apps`}
          aria-label="Search AI apps"
          className="pl-8"
        />
      </div>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
        {shown.map((t) => (
          <div key={t.id} className="relative">
            <button
              type="button"
              aria-pressed={value === t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3 pr-9 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                value === t.id ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/50",
              )}
            >
              <TileIcon t={t} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{t.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {connected.has(t.id) ? (
                    <span className="inline-flex items-center gap-1 font-medium text-brand">
                      <CheckCircle2Icon className="size-3" />
                      Connected
                    </span>
                  ) : (
                    t.sub
                  )}
                </span>
              </span>
            </button>
            {t.logo && (
              <button
                type="button"
                onClick={() => t.logo && onTour(t.logo)}
                aria-label={`Show me how: ${t.label}`}
                title="Show me how"
                className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <CirclePlayIcon className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {q && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No app called “{query.trim()}”. Pick <b className="font-medium">Other MCP app</b>: most apps take the same
          setup.
        </p>
      )}
      {!q && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setAll(!all)}>
          {all ? "Show fewer apps" : `Show all ${TILES.length} apps`}
        </Button>
      )}
    </div>
  );
}

function TourLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="outline" size="sm" className="w-fit" onClick={onClick}>
      <CirclePlayIcon />
      Show me how in {label}
    </Button>
  );
}

/** Plan, confirm, apply for one app. */
function AppPlan({
  app,
  profile,
  onTour,
  onConnected,
}: {
  app: ConnectAppId;
  profile: string;
  onTour: () => void;
  onConnected?: (app: ConnectAppId) => void;
}) {
  const { session } = useSession();
  const { advanced } = useView();
  const [plan, setPlan] = useState<ConnectPlan>();
  // Old entries are offered for removal, never ticked by default (docs/plans/onboarding-v2.md, decision 3).
  const [remove, setRemove] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ConnectResult>();

  useEffect(() => {
    const q = new URLSearchParams({ profile, remove: remove.join(",") });
    api
      .get<ConnectPlan>(`/connect/${app}/plan?${q}`)
      .then(setPlan)
      .catch((e) => setError(errorMessage(e)));
  }, [app, profile, remove]);

  async function apply() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(
        await api.post<ConnectResult>(`/connect/${app}`, {
          profile,
          remove,
          ...(session.passwordSet ? { password } : {}),
        }),
      );
      setPassword("");
      onConnected?.(app);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !plan) return <ErrorNote error={error} />;
  if (!plan) return <Skeleton className="h-40" />;

  if (result) {
    const failed = result.ran?.filter((r) => r.code !== 0) ?? [];
    return (
      <div className="grid gap-3 rounded-xl border p-4">
        <p className="flex items-center gap-2 font-medium">
          {failed.length ? (
            <TriangleAlertIcon className="size-4 text-destructive" />
          ) : (
            <CheckCircle2Icon className="size-4 text-brand" />
          )}
          {failed.length ? "Some commands failed" : "Connected"}
        </p>
        {result.file && !advanced && (
          <p className="text-sm text-muted-foreground">
            {result.backup ? "The app's old settings were saved as a backup." : "The app's settings were updated."}
          </p>
        )}
        {result.file && advanced && (
          <p className="text-sm text-muted-foreground">
            Changed <code className="font-mono text-xs">{result.file}</code>
            {result.backup && (
              <>
                . The old version is saved as <code className="font-mono text-xs">{result.backup}</code>
              </>
            )}
            .
          </p>
        )}
        {advanced && result.ran?.map((r) => (
          <p key={r.command} className="font-mono text-xs text-muted-foreground">
            {r.code === 0 ? "✓" : `✗ exit ${r.code}`} {r.command}
          </p>
        ))}
        {plan.after.length > 0 && (
          <div className="grid gap-1">
            <p className="text-sm font-medium">Next</p>
            <ol className="list-decimal pl-5 text-sm">
              {plan.after.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          </div>
        )}
        <TourLink onClick={onTour} label={TILES.find((t) => t.id === app)?.label ?? app} />
      </div>
    );
  }

  const removable = [...new Set([...plan.suggestedRemove, ...remove])];
  const appLabel = TILES.find((t) => t.id === app)?.label ?? app;
  return (
    <div className="grid gap-4 rounded-xl border p-4">
      <p className="flex items-start gap-2 text-sm">
        {plan.file ? (
          <FileCogIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <TerminalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <span>
          {plan.file ? (
            <>
              Adds <b className="font-medium">{plan.entryName}</b> to{" "}
              {advanced ? <code className="font-mono text-xs">{plan.file}</code> : `${appLabel}'s settings`}. A backup is
              saved first.
            </>
          ) : (
            <>
              Runs {plan.commands?.length === 1 ? "this command" : "these commands"} to add{" "}
              <b className="font-medium">{plan.entryName}</b>.
            </>
          )}{" "}
          {plan.transport === "http" ? (
            <b className="font-medium">
              Fallback: {appLabel}'s settings will hold this profile's token in plain text. Anyone who can read that file
              can use the profile's tools.
            </b>
          ) : (
            `${appLabel} starts pMCPg as a local program, so no token is written to its settings.`
          )}
        </span>
      </p>

      {removable.length > 0 && (
        <Field
          label={`Also remove these from ${appLabel}?`}
          hint="pMCPg now provides them. Removing them avoids having each tool twice; the backup keeps the old list."
        >
          <div className="grid gap-1.5">
            {removable.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={remove.includes(name)}
                  onCheckedChange={(v) => setRemove((r) => (v ? [...r, name] : r.filter((x) => x !== name)))}
                />
                <span className="font-mono text-xs">{name}</span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Advanced label={plan.preview ? "Show the change" : "Show the command"}>
        {plan.preview && <CodeBlock code={plan.preview} copy={false} />}
        {plan.commands?.map((c) => (
          <CodeBlock key={c} code={c} copy={false} />
        ))}
        {plan.transport === "http" && (
          <p className="text-xs text-muted-foreground">The token is hidden here (•••); the real one is written.</p>
        )}
      </Advanced>

      {session.passwordSet && (
        <Field
          label={PASSWORD_LABEL}
          htmlFor="connect-pw"
          hint={`${PASSWORD_HINT} Needed because this changes another app's settings.`}
          info={<PasswordHelp />}
        >
          <Input
            id="connect-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="max-w-xs"
          />
        </Field>
      )}
      <ErrorNote error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={apply} disabled={busy || (session.passwordSet && !password)}>
          {busy ? "Connecting…" : remove.length ? `Replace in ${appLabel}` : `Connect ${appLabel}`}
        </Button>
        <TourLink onClick={onTour} label={TILES.find((t) => t.id === app)?.label ?? app} />
      </div>
    </div>
  );
}

function Perplexity({ profile, onTour }: { profile: string; onTour: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border p-4 text-sm">
      <p>
        Perplexity's Mac app can run local MCP servers. Add a connector by hand, with this command. pMCPg passes its token
        for you.
      </p>
      <CodeBlock code={`pmcpg connect ${profile}`} />
      <p className="text-muted-foreground">If Perplexity asks for a name, use “pmcpg”.</p>
      <TourLink onClick={onTour} label="Perplexity" />
    </div>
  );
}

function Manual({ app, profile }: { app: ManualApp; profile: string }) {
  return (
    <div className="grid gap-3 rounded-xl border p-4 text-sm">
      <p>{app.where}</p>
      <CodeBlock code={app.snippet(profile)} />
      <p className="text-muted-foreground">
        {app.label} starts pMCPg as a local program, so no token goes into its settings. If it can't find pmcpg, put the
        full path instead (run <code className="font-mono text-xs">which pmcpg</code> in a terminal).
      </p>
    </div>
  );
}

function ChatGpt({ profile, onTour }: { profile: string; onTour: () => void }) {
  const { info, error } = useConnectInfo(profile);
  return (
    <div className="grid gap-3 rounded-xl border p-4 text-sm">
      <p>
        In the ChatGPT app on your computer: <b className="font-medium">Customize → Plugins → Add → Add custom MCP server</b>.
        Name it pmcpg and paste this address and token.
      </p>
      <ErrorNote error={error} />
      {info ? (
        <div className="grid gap-2">
          <Field label="Address">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">{info.url}</code>
              <CopyButton value={info.url} />
            </div>
          </Field>
          <Field label="Token" hint="Treat it like a password: anyone with it can use this profile's tools.">
            <RevealToken token={info.token} />
          </Field>
        </div>
      ) : (
        !error && <Skeleton className="h-24" />
      )}
      <TourLink onClick={onTour} label="ChatGPT Desktop" />
    </div>
  );
}

function Cloud() {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
      <CloudOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Not yet.</span> claude.ai, chatgpt.com and gemini.google.com call
        MCP servers from their own clouds, so they can't reach this computer. Use their desktop apps instead. A later
        version may offer a secure tunnel: off by default, with a clear indicator while it is on.
      </p>
    </div>
  );
}

/** Where pMCPg can and can't connect, in plain words. */
export function WhereItWorks() {
  return (
    <p className="max-w-2xl text-sm text-muted-foreground">
      pMCPg runs on your computer (or on your network with the Enterprise option), so it works with AI apps installed on
      your computer, like Claude Desktop or ChatGPT Desktop. The web versions (claude.ai, chatgpt.com,
      gemini.google.com) can't reach it.
    </p>
  );
}

/** Tiles for each AI app, then a plan to confirm and apply. */
export function ConnectApps({
  initialProfile = "all",
  initialApp,
  onConnected,
}: {
  initialProfile?: string;
  initialApp?: string;
  onConnected?: (app: ConnectAppId) => void;
}) {
  const [tile, setTile] = useState<TileId | undefined>(TILES.find((t) => t.id === initialApp)?.id);
  const [status, setStatus] = useState<AppConnectStatus[]>([]);
  const [profile, setProfile] = useState(initialProfile);
  const [profiles, setProfiles] = useState<Profile[]>();
  const [tour, setTour] = useState<TourApp>();

  const loadStatus = () =>
    api
      .get<AppConnectStatus[]>("/connect/status")
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    api
      .get<Profile[]>("/profiles")
      .then(setProfiles)
      .catch(() => {});
    void loadStatus();
  }, []);

  const connected = new Set(status.filter((s) => s.connected).map((s) => s.app as string));
  const manual = MANUAL.find((m) => tile === `manual:${m.id}`);
  const planApp = isPlanApp(tile) ? tile : undefined;

  return (
    <div className="grid gap-5">
      <Tiles value={tile} onChange={setTile} onTour={setTour} connected={connected} />

      <AdvancedOnly>
      {profiles && profiles.length > 1 && tile && tile !== "cloud" && (
        <Field label="Profile" hint="The app sees only the MCPs in this profile.">
          <ChoiceCards
            value={profile}
            onChange={setProfile}
            columns={3}
            options={profiles.map((p) => ({
              value: p.id,
              title: p.name,
              description: p.builtIn ? "All your MCPs" : `${p.accounts.length} MCP${p.accounts.length === 1 ? "" : "s"}`,
            }))}
          />
        </Field>
      )}
      </AdvancedOnly>

      {tile === "perplexity" && <Perplexity profile={profile} onTour={() => setTour("perplexity")} />}
      {tile === "chatgpt" && <ChatGpt profile={profile} onTour={() => setTour("chatgpt")} />}
      {tile === "cloud" && <Cloud />}
      {manual && <Manual app={manual} profile={profile} />}
      {planApp && (
        <AppPlan
          key={`${planApp}:${profile}`}
          app={planApp}
          profile={profile}
          onTour={() => setTour(planApp)}
          onConnected={(a) => {
            void loadStatus();
            onConnected?.(a);
          }}
        />
      )}
      {tour && <AppTour app={tour} profile={profile} open={!!tour} onOpenChange={(o) => !o && setTour(undefined)} />}

      <Advanced label="Other apps: one URL and a token">
        <p className="text-sm text-muted-foreground">
          Any app that supports MCP over HTTP can use <Badge variant="outline">/mcp</Badge> with a profile's token; the
          token picks the profile.
        </p>
        <ConnectPanel profileId={profile} />
      </Advanced>
    </div>
  );
}
