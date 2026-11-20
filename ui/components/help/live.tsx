"use client";

// Panels inside help articles that read this gateway's state through the UI API (/api/ui/*).
// Read-only, except the buttons that open the same dialogs the Accounts page uses.
import { ActivityIcon, ArrowRightIcon, CheckCircle2Icon, CircleIcon, KeyRoundIcon, LogInIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { ChoiceCards, CodeBlock, ErrorNote, StateBadge } from "@/components/common";
import { KeysDialog } from "@/components/keys-dialog";
import { Advanced } from "@/components/server-form";
import { useSession } from "@/components/session";
import { SignInDialog } from "@/components/signin-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingChecklist } from "@/components/watermelon/onboarding-checklist";
import { RunActionButton } from "@/components/watermelon/run-action-button";
import {
  type Account,
  type ActivityEntry,
  api,
  type ConnectAppId,
  type ConnectPlan,
  errorMessage,
  type ImportScan,
  type Listing,
  type Profile,
  type Settings,
  type Snippet,
  type Status,
} from "@/lib/api";
import { helpHref } from "@/lib/help-groups";
import type { LivePanel } from "@/lib/help";
import { useApi } from "@/lib/hooks";
import { diagnose } from "./diagnose";

/** GET /connect/status: which AI apps are on this computer and which point at this gateway. */
interface AppStatus {
  app: ConnectAppId;
  label: string;
  installed: boolean;
  connected: boolean;
  profiles: string[];
}

/** Frame that marks a block as live: it shows this gateway, not an example. */
function LiveFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border border-brand/40 bg-brand/[0.03] p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-brand uppercase">
        <ActivityIcon className="size-3.5" />
        {title}
      </p>
      {children}
    </section>
  );
}

function Check({ ok, children }: { ok: boolean | undefined; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-brand" />
      ) : (
        <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span>{children}</span>
    </li>
  );
}

// ---- Get started -------------------------------------------------------------------------------

function GetStarted() {
  const { session } = useSession();
  const status = useApi<Status>("/status");
  // Any search or call means an AI app has reached the gateway.
  const searches = useApi<Listing<ActivityEntry>>("/activity?type=search&limit=1");
  const calls = useApi<Listing<ActivityEntry>>("/activity?type=call&limit=1");
  const apps = useApi<AppStatus[]>("/connect/status");

  if (status.error) return <ErrorNote error={status.error} />;
  if (!status.data || searches.loading || calls.loading) return <Skeleton className="h-40" />;
  const s = status.data;
  const used = !!searches.data?.items.length || !!calls.data?.items.length;
  const connected = apps.data?.filter((x) => x.connected) ?? [];
  const steps = [
    { id: "server", title: "Add a server", href: "/servers/?add=1", done: s.servers > 0 },
    {
      id: "signin",
      title: "Sign in to your accounts",
      href: "/accounts/",
      done: s.accounts.length > 0 && s.accounts.every((a) => a.state.status !== "sign-in-needed"),
    },
    { id: "connect", title: "Connect your AI app", href: "/connect/", done: used || connected.length > 0 },
    { id: "password", title: "Protect this page with a password", href: "/settings/", done: session.passwordSet },
  ];
  return (
    <LiveFrame title="Your setup now">
      <OnboardingChecklist steps={steps} title="Getting started" />
      {connected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Connected: {connected.map((x) => x.label).join(", ")}.
        </p>
      )}
      {!used && !connected.length && searches.data?.available && (
        <p className="text-xs text-muted-foreground">
          “Connect your AI app” turns green after your app first uses pMCPg. Ask it something that needs a tool.
        </p>
      )}
    </LiveFrame>
  );
}

// ---- Connect one app ---------------------------------------------------------------------------

const APP_LABEL: Record<ConnectAppId, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  "lm-studio": "LM Studio",
  cursor: "Cursor",
  vscode: "VS Code",
};
const SNIPPET_FOR: Record<ConnectAppId, Snippet["id"]> = {
  "claude-desktop": "claude-desktop",
  "claude-code": "claude-code",
  "lm-studio": "http",
  cursor: "http",
  vscode: "vscode",
};

function ConnectApp({ app }: { app: ConnectAppId }) {
  const label = APP_LABEL[app];
  const profiles = useApi<Profile[]>("/profiles");
  const scan = useApi<ImportScan>("/import/scan");
  const [profile, setProfile] = useState("all");
  const plan = useApi<ConnectPlan>(`/connect/${app}/plan?profile=${profile}`);
  const [snippet, setSnippet] = useState<Snippet>();

  useEffect(() => {
    setSnippet(undefined);
    api
      .post<{ snippets: Snippet[] }>(`/profiles/${profile}/connect`)
      .then((r) => setSnippet(r.snippets.find((s) => s.id === SNIPPET_FOR[app])))
      .catch(() => {});
  }, [app, profile]);

  const found = scan.data?.apps.find((a) => a.id === app);
  const status = useApi<AppStatus[]>("/connect/status").data?.find((x) => x.app === app);
  const many = (profiles.data?.length ?? 0) > 1;

  return (
    <LiveFrame title={`${label} on this computer`}>
      {scan.loading || plan.loading ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="grid gap-2">
          {status && (
            <Check ok={status.installed}>
              {status.installed
                ? `${label} is installed on this computer.`
                : `${label} doesn't seem to be installed for this user. Install it first, or connect by hand below.`}
            </Check>
          )}
          {status && (
            <Check ok={status.connected}>
              {status.connected
                ? `${label} already uses pMCPg (profile: ${status.profiles.join(", ")}). Connecting again updates the entry.`
                : `${label} doesn't use pMCPg yet.`}
            </Check>
          )}
          <Check ok={!!found?.servers}>
            {found?.servers
              ? `${label}'s settings list ${found.servers} MCP server${found.servers === 1 ? "" : "s"}. You can import them into pMCPg.`
              : `No MCP servers found in ${label}'s settings. That is fine: connecting adds the first one.`}
          </Check>
          {plan.data?.file && (
            <Check ok>
              pMCPg will add <b className="font-medium">{plan.data.entryName}</b> to{" "}
              <code className="font-mono text-xs break-all">{plan.data.file}</code> and keep a backup.
            </Check>
          )}
          {plan.data?.commands && (
            <Check ok>
              pMCPg will run <code className="font-mono text-xs">claude mcp add</code> for you, without a shell.
            </Check>
          )}
          {plan.error && <ErrorNote error={plan.error} />}
        </ul>
      )}
      {many && profiles.data && (
        <ChoiceCards
          value={profile}
          onChange={setProfile}
          columns={3}
          options={profiles.data.map((p) => ({
            value: p.id,
            title: p.name,
            description: p.builtIn ? "Every account" : `${p.accounts.length} account${p.accounts.length === 1 ? "" : "s"}`,
          }))}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/connect/?${new URLSearchParams({ app, profile })}`}
          className={buttonVariants({ size: "sm" })}
        >
          Connect {label}
          <ArrowRightIcon />
        </Link>
        {!!found?.servers && (
          <Link href="/import/" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Import its servers
          </Link>
        )}
      </div>
      {snippet && (
        <Advanced label="Do it by hand instead">
          <p className="text-sm text-muted-foreground">{snippet.hint}</p>
          <CodeBlock code={snippet.code} />
          {snippet.code.includes("Bearer") && (
            <p className="text-xs text-muted-foreground">
              This holds the profile's token. Treat it like a password.
            </p>
          )}
        </Advanced>
      )}
    </LiveFrame>
  );
}

// ---- Account doctor ------------------------------------------------------------------------------

function AccountDoctor() {
  const params = useSearchParams();
  const { data, error, reload } = useApi<Account[]>("/accounts");
  const [picked, setPicked] = useState<string | null>(params.get("account"));
  const [signingIn, setSigningIn] = useState(false);
  const [keys, setKeys] = useState(false);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Skeleton className="h-40" />;
  if (!data.length)
    return (
      <LiveFrame title="Your accounts">
        <p className="text-sm text-muted-foreground">No accounts yet. Add a server first; it creates one.</p>
        <Link href="/servers/?add=1" className={buttonVariants({ size: "sm", className: "w-fit" })}>
          Add a server
        </Link>
      </LiveFrame>
    );

  const troubled = data.filter((a) => !["connected", "stopped", "starting"].includes(a.state.status));
  const id = picked ?? troubled[0]?.id ?? data[0]?.id;
  const account = data.find((a) => a.id === id);
  const d = account && diagnose(account);

  return (
    <LiveFrame title="Check an account">
      <div className="flex flex-wrap gap-1.5">
        {data.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setPicked(a.id)}
            aria-pressed={a.id === id}
            className={
              a.id === id
                ? "rounded-full border border-brand bg-brand/10 px-2.5 py-0.5 text-xs font-medium"
                : "rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            {a.id}
          </button>
        ))}
      </div>
      {!account || !d ? (
        <p className="text-sm text-muted-foreground">No account named “{id}”.</p>
      ) : (
        <div className="grid gap-3 rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{account.id}</span>
            <StateBadge state={account.state} />
            <span className="text-xs text-muted-foreground">
              {account.serverName} · {account.tools} {account.tools === 1 ? "tool" : "tools"}
            </span>
          </div>
          {"reason" in account.state && (
            <p className="font-mono text-xs break-words text-muted-foreground">{account.state.reason}</p>
          )}
          <div className="grid gap-1">
            <p className="text-sm font-medium">{d.title}</p>
            <p className="text-sm text-muted-foreground">{d.detail}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.fix === "signin" && (
              <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => setSigningIn(true)}>
                <LogInIcon />
                {account.signedIn === false ? "Sign in" : "Sign in again"}
              </button>
            )}
            {d.fix === "keys" && (
              <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => setKeys(true)}>
                <KeyRoundIcon />
                Add the missing key
              </button>
            )}
            <RunActionButton
              label="Test now"
              action={async () => {
                const r = await api.post<{ tools: number; error?: string; state: Account["state"] }>(
                  `/accounts/${account.id}/test`,
                );
                void reload();
                if (r.error || r.state.status !== "connected") return { ok: false, label: "Still not working" };
                return { ok: true, label: `${r.tools} ${r.tools === 1 ? "tool" : "tools"} found` };
              }}
            />
            {d.article && (
              <Link href={helpHref(d.article)} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                Read more
                <ArrowRightIcon />
              </Link>
            )}
          </div>
          {account.profiles.length > 0 && (
            <p className="text-xs text-muted-foreground">In profiles: {account.profiles.join(", ")}</p>
          )}
        </div>
      )}
      {account && (
        <>
          <SignInDialog accountId={account.id} open={signingIn} onOpenChange={setSigningIn} onSignedIn={reload} />
          <KeysDialog account={account} open={keys} onOpenChange={setKeys} onSaved={reload} />
        </>
      )}
    </LiveFrame>
  );
}

// ---- Small status panels -------------------------------------------------------------------------

function PasswordStatus() {
  const { session } = useSession();
  return (
    <LiveFrame title="This gateway">
      <ul className="grid gap-2">
        <Check ok={session.passwordSet}>
          {session.passwordSet ? "A password protects this page." : "No password is set. Anyone who can use this computer can open this page."}
        </Check>
        {session.passwordRequired && <Check ok={session.passwordSet}>A password is required here, because pMCPg listens beyond this computer.</Check>}
      </ul>
      <Link href="/settings/" className={buttonVariants({ size: "sm", variant: "outline", className: "w-fit" })}>
        {session.passwordSet ? "Change it in Settings" : "Set one in Settings"}
      </Link>
    </LiveFrame>
  );
}

function KeySource() {
  const { data } = useApi<Settings>("/settings");
  if (!data) return <Skeleton className="h-16" />;
  return (
    <LiveFrame title="This gateway">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Master key:
        <Badge variant="outline">{data.keySource === "keychain" ? "OS keychain" : "Environment variable"}</Badge>
      </p>
      <p className="text-sm text-muted-foreground">
        {data.keySource === "keychain"
          ? "The key that unlocks your stored keys and tokens is in this computer's keychain."
          : "The key comes from PMCPG_MASTER_KEY or PMCPG_MASTER_KEY_FILE, as in Docker. Keep a copy somewhere safe."}
      </p>
    </LiveFrame>
  );
}

export function LiveBlock({ name, arg }: { name: LivePanel; arg?: string }) {
  switch (name) {
    case "get-started":
      return <GetStarted />;
    case "connect-app":
      return <ConnectApp app={(arg ?? "claude-desktop") as ConnectAppId} />;
    case "account-doctor":
      return <AccountDoctor />;
    case "password-status":
      return <PasswordStatus />;
    case "key-source":
      return <KeySource />;
  }
}
