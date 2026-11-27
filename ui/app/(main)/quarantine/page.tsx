"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { ComingSoon, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type DownstreamTool, errorMessage, type Listing, type QuarantinedTool } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";
import { LineDiff } from "@/components/line-diff";

function show(t: DownstreamTool | undefined): string {
  if (!t) return "";
  return JSON.stringify(
    {
      title: t.title ?? "",
      description: t.description ?? "",
      inputSchema: t.inputSchema,
      annotations: t.annotations ?? {},
    },
    null,
    2,
  );
}

function Diff({ item }: { item: QuarantinedTool }) {
  return <LineDiff before={show(item.pinned)} after={show(item.current)} />;
}

export default function QuarantinePage() {
  const { data, error, reload } = useApi<Listing<QuarantinedTool>>("/quarantine", { pollMs: 10000 });

  async function decide(t: QuarantinedTool, decision: "approve" | "reject") {
    try {
      await api.post(`/quarantine/${encodeURIComponent(t.accountId)}/${encodeURIComponent(t.toolName)}`, { decision });
      toast.success(decision === "approve" ? "Approved: the tool is available again" : "Rejected: the old version stays pinned");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Tool review"
        description={
          <>
            When a server adds a tool or changes what a tool says it does, pMCPg holds it back until you check it. This blocks servers that quietly change their instructions. <LearnMore slug="tool-review" />
          </>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-32" />
      ) : !data.available ? (
        <ComingSoon title="Tool review">Changed or new tools will wait here for your review before AI clients can use them.</ComingSoon>
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing to review">All tools match what you approved.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {data.items.map((t) => (
            <Card key={`${t.accountId}/${t.toolName}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-mono text-sm">
                  {t.accountId}__{t.toolName}
                  <Badge variant={t.reason === "new" ? "secondary" : "destructive"}>{t.reason === "new" ? "New tool" : "Changed"}</Badge>
                </CardTitle>
                <CardDescription>{t.current.title ?? t.current.description?.slice(0, 120)}</CardDescription>
                <CardAction className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => decide(t, "reject")}>
                    <XIcon />
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => decide(t, "approve")}>
                    <CheckIcon />
                    Approve
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Diff item={t} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
