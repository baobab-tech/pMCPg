"use client";

import { EyeIcon, PencilLineIcon, SearchIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNote } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, type Listing, type QuarantinedTool, type ToolInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

type Kind = "reads" | "changes" | "deletes" | "unknown";

/** What a tool does to your data, from the server's own hints (MCP tool annotations). */
export function toolKind(t: ToolInfo): Kind {
  const a = t.annotations ?? {};
  if (a.readOnlyHint === true) return "reads";
  if (a.destructiveHint === true) return "deletes";
  if (a.readOnlyHint === false) return "changes";
  return "unknown";
}

const KIND: Record<Kind, { label: string; tip: string; className: string; icon: typeof EyeIcon }> = {
  reads: {
    label: "Only reads",
    tip: "The server says this tool only looks things up.",
    className: "bg-brand/10 text-brand",
    icon: EyeIcon,
  },
  changes: {
    label: "Changes data",
    tip: "The server says this tool can create or change things.",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    icon: PencilLineIcon,
  },
  deletes: {
    label: "Can delete",
    tip: "The server says this tool can delete or overwrite things.",
    className: "bg-destructive/15 text-destructive",
    icon: TriangleAlertIcon,
  },
  unknown: {
    label: "Not stated",
    tip: "The server doesn't say whether this tool changes anything. Treat it as if it might.",
    className: "bg-muted text-muted-foreground",
    icon: PencilLineIcon,
  },
};

/** "search_issues" → "Search issues", unless the server gave a title. */
export function toolTitle(t: ToolInfo): string {
  const given = t.title ?? (typeof t.annotations?.title === "string" ? t.annotations.title : undefined);
  if (given) return given;
  const words = t.name.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** First sentence, without markdown noise. */
function shortDescription(d?: string): string | undefined {
  if (!d) return undefined;
  const plain = d.replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
  const m = plain.match(/^.{20,}?[.!?](\s|$)/);
  const first = m ? m[0].trim() : plain;
  return first.length > 180 ? `${first.slice(0, 177)}…` : first;
}

function ToolRow({ tool, held }: { tool: ToolInfo; held?: QuarantinedTool["reason"] }) {
  const [open, setOpen] = useState(false);
  const kind = KIND[toolKind(tool)];
  const short = shortDescription(tool.description);
  const more = !!tool.description && tool.description.trim() !== short;
  const Icon = kind.icon;
  return (
    <li className="grid gap-1 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{toolTitle(tool)}</span>
        <Badge variant="secondary" className={cn("gap-1", kind.className)} title={kind.tip}>
          <Icon className="size-3" />
          {kind.label}
        </Badge>
        {held && (
          <a href="/quarantine/" title="Open Tool review">
            <Badge variant="secondary" className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <ShieldAlertIcon className="size-3" />
              {held === "new" ? "New: waiting for your review" : "Changed: waiting for your review"}
            </Badge>
          </a>
        )}
      </div>
      {short ? (
        <p className="text-sm text-muted-foreground">{open ? tool.description : short}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No description from the server.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <code className="font-mono">{tool.name}</code>
        {more && (
          <button type="button" className="underline underline-offset-3 hover:text-foreground" onClick={() => setOpen((o) => !o)}>
            {open ? "Less" : "More"}
          </button>
        )}
      </div>
    </li>
  );
}

/** "4 tools: 1 only reads, 2 can change data (1 can delete), 1 not stated." Zero counts are left out. */
function summary(total: number, c: Record<Kind, number>): string {
  const parts = [
    c.reads && `${c.reads} only ${c.reads === 1 ? "reads" : "read"}`,
    c.changes + c.deletes && `${c.changes + c.deletes} can change data${c.deletes ? ` (${c.deletes} can delete)` : ""}`,
    c.unknown && `${c.unknown} not stated`,
  ].filter(Boolean);
  return `${total} ${total === 1 ? "tool" : "tools"}: ${parts.join(", ")}.`;
}

/** Friendly list of one account's tools. */
export function ToolsDialog({
  accountId,
  title,
  open,
  onOpenChange,
}: {
  accountId: string;
  title: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [tools, setTools] = useState<ToolInfo[]>();
  const [error, setError] = useState<string>();
  const [held, setHeld] = useState<Map<string, QuarantinedTool["reason"]>>(new Map());
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setTools(undefined);
    setError(undefined);
    api
      .get<{ tools: ToolInfo[] }>(`/accounts/${encodeURIComponent(accountId)}/tools`)
      .then((r) => setTools(r.tools))
      .catch((e) => setError(errorMessage(e)));
    // Tools held in Tool review are listed too; mark them. Optional: absent before the pins module is wired.
    api
      .get<Listing<QuarantinedTool>>("/quarantine")
      .then((q) =>
        setHeld(new Map(q.items.filter((x) => x.accountId === accountId).map((x) => [x.toolName, x.reason]))),
      )
      .catch(() => setHeld(new Map()));
  }, [accountId, open]);

  const needle = q.trim().toLowerCase();
  const shown = tools?.filter(
    (t) => !needle || `${t.name} ${t.title ?? ""} ${t.description ?? ""}`.toLowerCase().includes(needle),
  );
  const counts = tools?.reduce(
    (c, t) => {
      c[toolKind(t)]++;
      return c;
    },
    { reads: 0, changes: 0, deletes: 0, unknown: 0 } as Record<Kind, number>,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tools from {title}</DialogTitle>
          <DialogDescription>
            What your AI apps can ask this login to do. The labels come from the server's own description of each tool.
          </DialogDescription>
        </DialogHeader>
        <ErrorNote error={error} />
        {!tools && !error && <Skeleton className="h-40" />}
        {tools && tools.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tools listed yet. pMCPg lists them the first time this login connects; click Test on the server to do it now.
          </p>
        )}
        {tools && tools.length > 0 && counts && (
          <>
            <p className="text-sm text-muted-foreground">
              {summary(tools.length, counts)}
              {held.size > 0 && ` ${held.size} waiting in Tool review: AI apps can't use ${held.size === 1 ? "it" : "them"} until you approve.`}
            </p>
            {tools.length > 8 && (
              <div className="relative">
                <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" className="pl-8" aria-label="Find a tool" />
              </div>
            )}
            <ul className="grid gap-2">
              {shown?.map((t) => (
                <ToolRow key={t.name} tool={t} held={held.get(t.name)} />
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
