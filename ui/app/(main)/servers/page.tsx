"use client";

import { GlobeIcon, KeyRoundIcon, LogInIcon, MonitorIcon, PencilIcon, PlusIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, Field, PageHeader, StateBadge } from "@/components/common";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { CatalogSoon } from "@/components/catalog-soon";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InfoTip } from "@/components/info-tip";
import { KeysDialog } from "@/components/keys-dialog";
import { AddByUrl } from "@/components/onboarding/add-by-url";
import { SignInDialog } from "@/components/signin-dialog";
import { ToolsDialog } from "@/components/tools-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RunActionButton } from "@/components/watermelon/run-action-button";
import { StarterTiles } from "@/components/onboarding/starters";
import { AdvancedOnly, MoreInAdvanced, useView } from "@/components/view";
import { type Account, type AccountState, api, errorMessage, type Server } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";
import { HelpTip, ServerAccountTable } from "@/components/help/help-tip";

interface TestResult {
  account: string;
  state: AccountState;
  tools: number;
  error?: string;
}

function EditServer({ server, onDone }: { server: Server; onDone: () => void }) {
  const [name, setName] = useState(server.name);
  const [target, setTarget] = useState(server.target);
  const [error, setError] = useState<string>();
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.patch(`/servers/${server.id}`, {
            name,
            ...(server.transport === "stdio" ? { command: target } : { url: target }),
          });
          toast.success("Server saved");
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field label="Name" htmlFor="edit-name">
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={server.transport === "stdio" ? "Command" : "URL"} htmlFor="edit-target">
        <Input id="edit-target" value={target} onChange={(e) => setTarget(e.target.value)} className="font-mono" />
      </Field>
      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

/** One login (account) of a server: state, tools, and what it needs next. */
function LoginRow({ account, result, onChanged }: { account: Account; result?: TestResult; onChanged: () => void }) {
  const [signingIn, setSigningIn] = useState(false);
  const [keys, setKeys] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const missing = [...account.headers, ...account.env, ...account.params].some((x) => !x.set);
  const { advanced } = useView();
  const name = advanced ? (account.label ? `${account.id} · ${account.label}` : account.id) : (account.label ?? (account.auth === "none" ? "No sign-in needed" : "Your login"));
  const problem = result?.error ?? ("reason" in account.state ? account.state.reason : undefined);

  return (
    <div className="grid gap-1 rounded-md bg-muted/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name}</span>
        <StateBadge state={account.state} />
        {missing && <Badge variant="destructive">A key is missing</Badge>}
        <span className="text-muted-foreground">
          {account.tools} {account.tools === 1 ? "tool" : "tools"}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          {account.auth === "oauth" && !account.signedIn && (
            <Button size="xs" onClick={() => setSigningIn(true)}>
              <LogInIcon />
              Sign in
            </Button>
          )}
          {account.auth !== "oauth" && (account.headers.length > 0 || account.env.length > 0 || account.params.length > 0) && (
            <Button size="xs" variant="outline" onClick={() => setKeys(true)}>
              <KeyRoundIcon />
              Keys
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => setShowTools(true)} disabled={account.tools === 0}>
            <WrenchIcon />
            Show tools
          </Button>
        </span>
      </div>
      {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
      <SignInDialog accountId={account.id} open={signingIn} onOpenChange={setSigningIn} onSignedIn={onChanged} />
      <KeysDialog account={account} open={keys} onOpenChange={setKeys} onSaved={onChanged} />
      <ToolsDialog accountId={account.id} title={name} open={showTools} onOpenChange={setShowTools} />
    </div>
  );
}

function ServerCard({
  server,
  servers,
  accounts,
  onChanged,
}: {
  server: Server;
  servers: Server[];
  accounts: Account[];
  onChanged: () => void;
}) {
  const [results, setResults] = useState<TestResult[]>();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [addingLogin, setAddingLogin] = useState(false);
  const { advanced } = useView();
  const local = server.transport === "stdio";
  const mine = accounts.filter((a) => a.server === server.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {local ? <MonitorIcon className="size-4 text-muted-foreground" /> : <GlobeIcon className="size-4 text-muted-foreground" />}
          {server.name}
          <Badge variant="outline">
            {local ? "On this computer" : advanced && server.transport === "sse" ? "Online (SSE)" : "Online"}
          </Badge>
        </CardTitle>
        {advanced && <CardDescription className="font-mono text-xs break-all">{server.target}</CardDescription>}
        <CardAction className="flex gap-1">
          <RunActionButton
            action={async () => {
              const r = await api.post<{ results: TestResult[] }>(`/servers/${server.id}/test`);
              setResults(r.results);
              onChanged();
              if (r.results.length === 0) return { ok: false, label: "No login yet" };
              const bad = r.results.find((x) => x.error || x.state.status !== "connected");
              if (bad) return { ok: false, label: "Problem found" };
              const tools = r.results.reduce((n, x) => n + x.tools, 0);
              return { ok: true, label: `${tools} ${tools === 1 ? "tool" : "tools"} found` };
            }}
          />
          <AdvancedOnly>
            <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(true)}>
              <PencilIcon />
            </Button>
          </AdvancedOnly>
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(true)}>
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className={`items-center gap-1 text-xs font-medium text-muted-foreground ${advanced || mine.length > 1 ? "flex" : "hidden"}`}>
          {mine.length === 1 ? "Login" : "Logins"}
          {advanced && (
          <InfoTip label="What is a login?">
            A login (also called an account) is one sign-in to this server. Most servers need one. Add another when you
            have two, like work and personal Gmail on the same Gmail server; each gets its own keys and tools.
          </InfoTip>
          )}
        </div>
        {mine.length === 0 && server.accounts.length === 0 && <p className="text-muted-foreground">No login yet.</p>}
        {mine.map((a) => (
          <LoginRow key={a.id} account={a} result={results?.find((r) => r.account === a.id)} onChanged={onChanged} />
        ))}
        {advanced ? (
          <Button variant="link" size="sm" className="w-fit px-0" onClick={() => setAddingLogin(true)}>
            <PlusIcon />
            Add another account for this service
          </Button>
        ) : (
          mine.length === 1 && <MoreInAdvanced label="Another login for this service? (Advanced view)" />
        )}
      </CardContent>

      <AddAccountDialog
        servers={servers}
        initialServer={server.id}
        open={addingLogin}
        onOpenChange={setAddingLogin}
        onAdded={(a) => {
          toast.success(`Added ${a.id}`);
          onChanged();
        }}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {server.name}</DialogTitle>
          </DialogHeader>
          <EditServer
            server={server}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${server.name}?`}
        description={
          server.accounts.length
            ? `Its logins (${server.accounts.join(", ")}) and their stored keys and sign-ins are removed too.`
            : "Clients will no longer see its tools."
        }
        onConfirm={async (password) => {
          await api.del(`/servers/${server.id}`, { password });
          toast.success(`Removed ${server.name}`);
          onChanged();
        }}
      />
    </Card>
  );
}

function ServersInner() {
  const { data, error, reload } = useApi<Server[]>("/servers");
  const accounts = useApi<Account[]>("/accounts", { pollMs: 10000 });
  const reloadAll = () => {
    void reload();
    void accounts.reload();
  };
  const params = useSearchParams();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [signIn, setSignIn] = useState<string>();
  const [starter, setStarter] = useState<string>();
  const { advanced } = useView();

  useEffect(() => {
    if (params.get("add")) setAdding(true);
  }, [params]);

  const add = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon />
      {advanced ? "Add server" : "Add a connection"}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={advanced ? "Servers" : "Connections"}
        description={
          advanced ? (
            <>
              A server is where tools come from: a web address for online services, or a command for tools that run on
              this computer. Each server has one or more logins (accounts), such as work and personal Gmail.{" "}
              <HelpTip title="Servers, accounts and profiles" slug="servers-accounts-profiles">
                <p>A server is where tools come from. An account is one sign-in to it. A profile picks accounts for one AI app.</p>
                <ServerAccountTable />
              </HelpTip>
            </>
          ) : (
            <>
              A connection is a service pMCPg reaches for you, signed in with one of your logins.{" "}
              <HelpTip title="Servers, accounts and profiles" slug="servers-accounts-profiles">
                <p>A server is where tools come from. An account is one sign-in to it. A profile picks accounts for one AI app.</p>
                <ServerAccountTable />
              </HelpTip>
            </>
          )
        }
        actions={data?.length ? add : undefined}
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-32" />
      ) : data.length === 0 ? (
        <EmptyState title={advanced ? "No servers yet" : "No connections yet"} action={add}>
          {advanced
            ? "Add a server by pasting its URL or the command from its instructions."
            : "Pick a service to start with, or paste the address its provider gives you."}{" "}
          <LearnMore slug="add-server-by-url" />
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {data.map((s) => (
            <ServerCard key={s.id} server={s} servers={data} accounts={accounts.data ?? []} onChanged={reloadAll} />
          ))}
        </div>
      )}

      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o && params.get("add")) router.replace("/servers/");
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{advanced ? "Add a server" : "Add a connection"}</DialogTitle>
            <DialogDescription>
              pMCPg checks the address and tells you what it needs. Or{" "}
              <a href="/import/" className="underline underline-offset-3">
                import from your AI apps
              </a>
              .
            </DialogDescription>
          </DialogHeader>
          {!advanced && <StarterTiles value={starter} onPick={setStarter} compact />}
          <AddByUrl
            url={starter}
            onAdded={(server, auth) => {
              setAdding(false);
              if (params.get("add")) router.replace("/servers/");
              reloadAll();
              toast.success(`Added ${server.name}`);
              if (auth === "oauth" && server.accounts[0]) setSignIn(server.accounts[0]);
            }}
          />
          <CatalogSoon />
        </DialogContent>
      </Dialog>
      {signIn && (
        <SignInDialog
          accountId={signIn}
          open={!!signIn}
          onOpenChange={(o) => !o && setSignIn(undefined)}
          onSignedIn={reloadAll}
        />
      )}
    </>
  );
}

export default function ServersPage() {
  return (
    <Suspense>
      <ServersInner />
    </Suspense>
  );
}
