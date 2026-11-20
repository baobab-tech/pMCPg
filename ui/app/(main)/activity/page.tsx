"use client";

import { useState } from "react";
import { ComingSoon, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContinuousTabs } from "@/components/watermelon/continuous-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActivityEntry, Listing } from "@/lib/api";
import { useApi } from "@/lib/hooks";

type Filter = "" | "call" | "search" | "account-state" | "tools-changed";

function describe(e: ActivityEntry["event"]): { what: string; detail: string } {
  const s = (k: string) => String(e[k] ?? "");
  switch (e.type) {
    case "call":
      return {
        what: s("tool"),
        detail: `${s("outcome")}${Number(e.masked) ? ` · ${s("masked")} masked` : ""} · ${s("ms")} ms · ${s("profileId")}`,
      };
    case "search":
      return { what: `“${s("query")}”`, detail: `${s("results")} results · ${s("profileId")}` };
    case "account-state":
      return { what: s("accountId"), detail: `${s("status")}${e.reason ? ` · ${s("reason")}` : ""}` };
    case "tools-changed":
      return { what: s("accountId"), detail: `+${s("added")} −${s("removed")} ~${s("changed")}` };
    case "token-rotated":
      return {
        what: e.token === "admin" ? "Admin token" : `Token of ${s("profileId")}`,
        detail: `replaced · ${s("via")}`,
      };
    case "privacy-reset":
      return {
        what: "Forgot masked values",
        detail: `${s("placeholders")} values · ${e.profileId ? s("profileId") : "every profile"}`,
      };
    default:
      return { what: s("accountId"), detail: e.type };
  }
}

export default function ActivityPage() {
  const [filter, setFilter] = useState<Filter>("");
  const { data, error } = useApi<Listing<ActivityEntry>>(`/activity?limit=200${filter ? `&type=${filter}` : ""}`, {
    pollMs: 5000,
  });

  return (
    <>
      <PageHeader
        title="Activity"
        description="What your AI clients did through pMCPg. Only names, counts and outcomes are kept, never the content of calls."
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-48" />
      ) : !data.available ? (
        <ComingSoon title="Activity log">Every search and tool call will be listed here, stored encrypted on this computer.</ComingSoon>
      ) : (
        <div className="grid gap-4">
          <ContinuousTabs
            aria-label="Filter"
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: "", label: "Everything" },
              { id: "call", label: "Tool calls" },
              { id: "search", label: "Searches" },
              { id: "account-state", label: "Connections" },
              { id: "tools-changed", label: "Tool changes" },
            ]}
          />
          {data.items.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => {
                  const d = describe(a.event);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={a.event.type === "call" && a.event.outcome !== "ok" ? "destructive" : "outline"}>
                          {a.event.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.what}</TableCell>
                      <TableCell className="text-muted-foreground">{d.detail}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </>
  );
}
