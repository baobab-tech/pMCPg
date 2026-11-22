"use client";

import {
  ArrowLeftIcon,
  CheckCircle2Icon, CloudIcon, GlobeIcon, KeyRoundIcon, LogInIcon, MonitorIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorNote } from "@/components/common";
import { KeysDialog } from "@/components/keys-dialog";
import { Advanced } from "@/components/server-form";
import { SignInDialog } from "@/components/signin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Account,
  api,
  errorMessage,
  type ImportCandidate,
  type ImportOutcome,
  type ImportScan,
} from "@/lib/api";
import { helpHref } from "@/lib/help-groups";
import { cn } from "@/lib/utils";
import { useView } from "@/components/view";

const isRemote = (c: ImportCandidate) => c.server.transport !== "stdio";

function target(c: ImportCandidate): string {
  return c.server.transport === "stdio" ? [c.server.command, ...c.server.args].join(" ") : c.server.url;
}

/** "Claude Desktop", "Claude Code (project api)": one chip per place it was found. */
function foundChips(c: ImportCandidate): string[] {
  const out = new Set<string>();
  for (const f of c.foundIn) {
    const project = f.project ? ` (project ${f.project.split(/[\\/]/).filter(Boolean).pop()})` : "";
    out.add(`${f.appLabel}${project}${f.extension ? " extension" : ""}`);
  }
  return [...out];
}

function needsValues(c: ImportCandidate): string[] {
  return [...c.envNames, ...c.headerNames, ...c.secretParams.map((p) => `?${p}`)];
}

function CandidateRow({
  c,
  checked,
  onToggle,
}: {
  c: ImportCandidate;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const values = needsValues(c);
  const { advanced } = useView();
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
        c.alreadyAdded ? "opacity-55" : "cursor-pointer hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={c.alreadyAdded}
        onCheckedChange={(v) => onToggle(!!v)}
        className="mt-0.5"
      />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {isRemote(c) ? (
            <GlobeIcon className="size-4 text-muted-foreground" />
          ) : (
            <MonitorIcon className="size-4 text-muted-foreground" />
          )}
          <span className="font-medium">{c.foundIn[0]?.name ?? c.suggestedId}</span>
          {c.alreadyAdded && <Badge variant="secondary">Already added</Badge>}
          {values.length > 0 && !c.alreadyAdded && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
              Needs a value: {values.join(", ")}
            </Badge>
          )}
        </div>
        {advanced && <code className="truncate font-mono text-xs text-muted-foreground">{target(c)}</code>}
        <div className="flex flex-wrap gap-1">
          {foundChips(c).map((chip) => (
            <span key={chip} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Found in {chip}
            </span>
          ))}
        </div>
      </div>
    </label>
  );
}

/** After import: what is left to do per account. */
function TodoList({
  outcomes,
  onDone,
  onBack,
}: {
  outcomes: ImportOutcome[];
  onDone?: () => void;
  onBack?: () => void;
}) {
  const { advanced } = useView();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [signIn, setSignIn] = useState<string>();
  const [keys, setKeys] = useState<Account>();
  const reload = () =>
    api
      .get<Account[]>("/accounts")
      .then(setAccounts)
      .catch(() => {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void reload();
  }, []);

  const added = outcomes.filter((o) => o.status === "added" && o.accountId);
  const skipped = outcomes.length - added.length;
  const account = (id: string) => accounts.find((a) => a.id === id);
  const left = added.filter((o) => {
    if (o.probeError) return true;
    const a = account(o.accountId as string);
    if (!a) return !!o.needsSignIn || !!o.missingValues?.length;
    return (a.auth === "oauth" && a.signedIn === false) || [...a.headers, ...a.env, ...a.params].some((x) => !x.set);
  }).length;

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <span className="font-medium">
          Brought in {added.length} {advanced ? "server" : "connection"}
          {added.length === 1 ? "" : "s"}.
        </span>{" "}
        {skipped > 0 && <span className="text-muted-foreground">{skipped} were already here.</span>}
      </p>
      <ul className="grid gap-2">
        {added.map((o) => {
          const id = o.accountId as string;
          const a = account(id);
          const signedIn = a?.signedIn === true;
          const missing = a
            ? [
                ...a.params.filter((p) => !p.set).map((p) => `?${p.name}`),
                ...[...a.headers, ...a.env].filter((s) => !s.set).map((s) => s.name),
              ]
            : (o.missingValues ?? []);
          const done = !o.probeError && (!o.needsSignIn || signedIn) && missing.length === 0;
          return (
            <li key={o.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                {done ? (
                  <CheckCircle2Icon className="size-4 text-brand" />
                ) : (
                  <span className="size-4 rounded-full border-2 border-border" />
                )}
                <span className="font-medium">{id}</span>
                {o.probeError && advanced && <span className="text-xs text-muted-foreground">Couldn't check it: {o.probeError}</span>}
              </span>
              <span className="flex gap-2">
                {o.needsSignIn && !signedIn && (
                  <Button size="sm" onClick={() => setSignIn(id)}>
                    <LogInIcon />
                    Sign in
                  </Button>
                )}
                {missing.length > 0 && a && (
                  <Button size="sm" variant="outline" onClick={() => setKeys(a)}>
                    <KeyRoundIcon />
                    Add value{missing.length > 1 ? "s" : ""}: {missing.join(", ")}
                  </Button>
                )}
                {done && <span className="text-xs text-muted-foreground">Ready</span>}
                {o.probeError && !o.needsSignIn && missing.length === 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">Couldn't reach it; check its address later</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {signIn && (
        <SignInDialog
          accountId={signIn}
          open={!!signIn}
          onOpenChange={(o) => !o && setSignIn(undefined)}
          onSignedIn={() => void reload()}
        />
      )}
      {keys && (
        <KeysDialog
          account={keys}
          open={!!keys}
          onOpenChange={(o) => !o && setKeys(undefined)}
          onSaved={() => void reload()}
        />
      )}
      {added.length > 0 && left > 0 && (
        <p className="text-sm text-muted-foreground">
          {left} still need{left === 1 ? "s" : ""} attention. You can do it now or later from{" "}
          {advanced ? "Servers" : "Connections"}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onBack && <BackButton onClick={onBack} />}
        {onDone && (
          <Button variant={left ? "outline" : "default"} onClick={onDone}>
            {left ? "Do this later" : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Find servers already set up in Claude Desktop, Claude Code, LM Studio, Cursor and VS Code, and import them. */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" onClick={onClick}>
      <ArrowLeftIcon />
      Back
    </Button>
  );
}

export function ImportPanel({
  onPasteUrl,
  onDone,
  onBack,
}: {
  onPasteUrl?: () => void;
  /** Shows a Back button beside the panel's main action. */
  onBack?: () => void;
  /** Called with the AI apps the imported servers came from. */
  onDone?: (apps: ImportCandidate["foundIn"][number]["app"][]) => void;
}) {
  const [scan, setScan] = useState<ImportScan>();
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [perProject, setPerProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>();

  async function load() {
    setError(undefined);
    try {
      const s = await api.get<ImportScan>("/import/scan");
      setScan(s);
      // Remote servers are pre-ticked: they need no install and usually just a sign-in.
      setPicked(new Set(s.candidates.filter((c) => isRemote(c) && !c.alreadyAdded).map((c) => c.key)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const c = scan?.candidates ?? [];
    return [
      { title: "Online servers", items: c.filter(isRemote) },
      { title: "On this computer", items: c.filter((x) => !isRemote(x)) },
    ].filter((g) => g.items.length > 0);
  }, [scan]);

  const hasProjects = scan?.candidates.some((c) => c.foundIn.some((f) => f.project)) ?? false;

  async function apply() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ outcomes: ImportOutcome[] }>("/import/apply", {
        keys: [...picked],
        profilePerProject: perProject,
      });
      setOutcomes(r.outcomes);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const cloudNote = scan && (
    <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
      <CloudIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="grid gap-1.5">
        <p className="font-medium">Can't see your Claude or ChatGPT MCPs in the list?</p>
        <p className="text-muted-foreground">
          {scan.note} Copy each one's URL from the app's settings (
          <Link href={helpHref("move-claude-connectors")} className="font-medium text-foreground underline underline-offset-3">
            how, for Claude
          </Link>
          ){onPasteUrl ? (
            <>
              , then{" "}
              <button type="button" className="font-medium text-foreground underline underline-offset-3" onClick={onPasteUrl}>
                paste it here
              </button>
              .
            </>
          ) : (
            " and add it under Servers."
          )}
        </p>
      </div>
    </div>
  );

  if (outcomes) {
    const from = [
      ...new Set(
        (scan?.candidates ?? [])
          .filter((c) => picked.has(c.key))
          .flatMap((c) => c.foundIn.filter((f) => !f.project && !f.extension).map((f) => f.app)),
      ),
    ];
    return <TodoList outcomes={outcomes} onDone={onDone && (() => onDone(from))} onBack={onBack} />;
  }
  if (error && !scan)
    return (
      <div className="grid gap-4">
        <ErrorNote error={error} />
        {onBack && <BackButton onClick={onBack} />}
      </div>
    );
  if (!scan) return <Skeleton className="h-40" />;

  const found = scan.apps.filter((a) => a.servers > 0);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {found.length
          ? `Found servers in ${found.map((a) => `${a.label} (${a.servers})`).join(", ")}. Nothing is changed in those apps.`
          : "Looked in Claude Desktop, Claude Code, LM Studio, Cursor and VS Code."}
      </p>
      {scan.candidates.length === 0 ? (
        <EmptyState title="No servers found in your AI apps">
          If you set up servers in claude.ai, ChatGPT or Gemini, paste their URLs instead.
        </EmptyState>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.title} className="grid gap-2">
              <h3 className="text-sm font-medium">{g.title}</h3>
              {g.items.map((c) => (
                <CandidateRow
                  key={c.key}
                  c={c}
                  checked={picked.has(c.key)}
                  onToggle={(v) => {
                    const next = new Set(picked);
                    if (v) next.add(c.key);
                    else next.delete(c.key);
                    setPicked(next);
                  }}
                />
              ))}
            </div>
          ))}
          {hasProjects && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={perProject} onCheckedChange={(v) => setPerProject(!!v)} />
              Create a profile for each Claude Code project
            </label>
          )}
          <ErrorNote error={error} />
          <div className="flex flex-wrap items-center gap-2">
            {onBack && <BackButton onClick={onBack} />}
            <Button onClick={apply} disabled={busy || picked.size === 0}>
              {busy ? "Importing…" : `Import ${picked.size} server${picked.size === 1 ? "" : "s"}`}
            </Button>
            <Button variant="ghost" onClick={() => void load()}>
              <RefreshCwIcon />
              Look again
            </Button>
          </div>
        </>
      )}
      {cloudNote}
      <Advanced label="What is read">
        <p className="text-sm text-muted-foreground">
          Names, commands and URLs from each app's config file. Environment and header values are never read; their
          names show as “Needs a value” and you type them here. Entries that already point at pMCPg are skipped.
        </p>
      </Advanced>
      {scan.candidates.length === 0 && onBack && <BackButton onClick={onBack} />}
    </div>
  );
}
