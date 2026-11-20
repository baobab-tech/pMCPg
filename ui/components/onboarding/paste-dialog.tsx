"use client";

import { BanIcon, GlobeIcon, LinkIcon, Loader2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ErrorNote } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CopyConfirm } from "@/components/watermelon/copy-confirm";
import { api, errorMessage, type ImportOutcome, type ProbeResult } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One entry from POST /import/paste. */
interface PastedServer {
  name: string;
  url?: string;
  auth: "oauth" | "key" | "none" | "unknown";
  status: "ready" | "url-needed" | "built-in" | "rejected";
  note?: string;
  knownUrl?: boolean;
  secretParams: string[];
  suggestedId: string;
  key?: string;
  alreadyAdded: boolean;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/** Light check before the server's own: https, or http to localhost. */
function usableUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
    return u.protocol === "https:" || (u.protocol === "http:" && local);
  } catch {
    return false;
  }
}

function ProbeBadge({ probe }: { probe?: ProbeResult | "busy" }) {
  if (!probe) return null;
  if (probe === "busy")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2Icon className="size-3 animate-spin" />
        Checking
      </Badge>
    );
  if (!probe.ok)
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Couldn't reach it
      </Badge>
    );
  const a = probe.auth;
  if (a.type === "oauth") return <Badge variant="outline">Needs sign-in with {hostOf(a.issuer)}</Badge>;
  if (a.type === "header")
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        Needs a key
      </Badge>
    );
  return <Badge variant="outline">No sign-in</Badge>;
}

function Row({
  s,
  url,
  onUrl,
  checked,
  onToggle,
  probe,
}: {
  s: PastedServer;
  url: string;
  onUrl: (v: string) => void;
  checked: boolean;
  onToggle: (v: boolean) => void;
  probe?: ProbeResult | "busy";
}) {
  const movable = s.status === "ready" || s.status === "url-needed";
  const selectable = movable && !s.alreadyAdded && usableUrl(url);
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm",
        (!movable || s.alreadyAdded) && "opacity-60",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={!selectable}
        onCheckedChange={(v) => onToggle(!!v)}
        aria-label={`Import ${s.name}`}
        className="mt-0.5"
      />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {movable ? (
            <GlobeIcon className="size-4 text-muted-foreground" />
          ) : (
            <BanIcon className="size-4 text-muted-foreground" />
          )}
          <span className="font-medium break-all">{s.name}</span>
          {s.alreadyAdded && <Badge variant="secondary">Already added</Badge>}
          {s.status === "built-in" && <Badge variant="secondary">Not an MCP server</Badge>}
          {s.status === "rejected" && <Badge variant="secondary">Can't use this URL</Badge>}
          {checked && <ProbeBadge probe={probe} />}
        </div>
        {s.status === "url-needed" ? (
          <Input
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="URL needed: paste the server's URL"
            className="h-8 font-mono text-xs"
            aria-label={`URL for ${s.name}`}
          />
        ) : (
          s.url && <code className="truncate font-mono text-xs text-muted-foreground">{s.url}</code>
        )}
        {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
        {s.secretParams.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Removed from the URL for safety: {s.secretParams.join(", ")}. You can add the value after import.
          </p>
        )}
      </div>
    </div>
  );
}

/** Import Claude and ChatGPT cloud connectors from the chatbot's own list, pasted by the user. */
export function PasteDialog({
  onImported,
  children,
}: {
  onImported: (outcomes: ImportOutcome[]) => void;
  /** The link text that opens the dialog. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [text, setText] = useState("");
  const [servers, setServers] = useState<PastedServer[]>();
  const [truncated, setTruncated] = useState(false);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [probes, setProbes] = useState<Record<number, ProbeResult | "busy">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function openDialog() {
    setOpen(true);
    if (!prompt)
      api
        .get<{ prompt: string }>("/import/paste")
        .then((r) => setPrompt(r.prompt))
        .catch((e) => setError(errorMessage(e)));
  }

  async function find() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ servers: PastedServer[]; truncated: boolean }>("/import/paste", { text });
      setServers(r.servers);
      setTruncated(r.truncated);
      setUrls(Object.fromEntries(r.servers.map((s, i) => [i, s.url ?? ""])));
      // Nothing is pre-ticked: a server is contacted only after the user picks it.
      setPicked(new Set());
      setProbes({});
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(i: number, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(i);
    else next.delete(i);
    setPicked(next);
    const url = urls[i]?.trim();
    if (!on || !url) return;
    setProbes((p) => ({ ...p, [i]: "busy" }));
    api
      .post<ProbeResult>("/probe", { url })
      .then((r) => setProbes((p) => ({ ...p, [i]: r })))
      .catch((e) => setProbes((p) => ({ ...p, [i]: { ok: false, url, error: errorMessage(e) } })));
  }

  async function importPicked() {
    if (!servers) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = [...picked].map((i) => ({
        name: servers[i]?.name ?? "",
        url: (urls[i] ?? "").trim(),
        secretParams: servers[i]?.secretParams ?? [],
      }));
      const r = await api.post<{ outcomes: ImportOutcome[] }>("/import/paste/apply", { servers: body });
      setOpen(false);
      onImported(r.outcomes);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    servers?.filter((s) => (s.status === "ready" || s.status === "url-needed") && !s.alreadyAdded) ?? [];

  return (
    <>
      <button
        type="button"
        className="font-medium text-foreground underline underline-offset-3 hover:text-brand"
        onClick={openDialog}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bring over your Claude or ChatGPT connectors</DialogTitle>
            <DialogDescription>
              Claude and ChatGPT keep the connectors you add on their websites in their own cloud, not on this
              computer. pMCPg can't read them or move them by itself. The chatbot can list them for you, though.
            </DialogDescription>
          </DialogHeader>

          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">1. Ask your chatbot to list them</h3>
              {prompt && <CopyConfirm value={prompt} copyText="Copy to clipboard" copiedText="Copied" />}
            </div>
            <p className="text-sm text-muted-foreground">
              Start a new chat in Claude or ChatGPT with your connectors turned on, and send this message.
            </p>
            <pre className="max-h-40 overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {prompt || "Loading…"}
            </pre>
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">2. Paste the answer here</h3>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the whole answer. Only names and web addresses are read from it."
              className="min-h-28 font-mono text-xs"
              aria-label="Chatbot answer"
            />
            <Button variant="outline" className="w-fit" onClick={find} disabled={busy || !text.trim()}>
              <LinkIcon />
              Find servers
            </Button>
          </section>

          {servers && (
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">
                {servers.length
                  ? `Found ${ready.length} server${ready.length === 1 ? "" : "s"} you can bring over`
                  : "No servers found in that text"}
              </h3>
              {truncated && (
                <p className="text-xs text-muted-foreground">The text was long, so only the first part was read.</p>
              )}
              {servers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tick the ones to import. Each one you tick is checked to see if it needs a sign-in or a key.
                </p>
              )}
              {servers.map((s, i) => (
                <Row
                  // biome-ignore lint/suspicious/noArrayIndexKey: list is replaced as a whole
                  key={i}
                  s={s}
                  url={urls[i] ?? ""}
                  onUrl={(v) => {
                    setUrls((u) => ({ ...u, [i]: v }));
                    if (picked.has(i)) toggle(i, false);
                  }}
                  checked={picked.has(i)}
                  onToggle={(v) => toggle(i, v)}
                  probe={probes[i]}
                />
              ))}
            </section>
          )}

          <ErrorNote error={error} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={importPicked} disabled={busy || picked.size === 0}>
              {busy && servers ? "Importing…" : `Import ${picked.size} server${picked.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
