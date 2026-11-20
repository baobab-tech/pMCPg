"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { ComingSoon, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ApprovalRequest, api, errorMessage, type Listing } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";

const when = (t: number) => new Date(t).toLocaleString();

export default function ApprovalsPage() {
  const { data, error, reload } = useApi<Listing<ApprovalRequest>>("/approvals", { pollMs: 3000 });
  const pending = data?.items.filter((i) => i.status === "pending") ?? [];
  const past = data?.items.filter((i) => i.status !== "pending") ?? [];

  async function decide(id: string, decision: "approved" | "denied") {
    try {
      await api.post(`/approvals/${id}`, { decision });
      toast.success(decision === "approved" ? "Approved" : "Denied");
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Approvals" description={
          <>
            Calls that wait for your OK before they run. The AI client waits while you decide. <LearnMore slug="approvals-presets" />
          </>
        } />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-32" />
      ) : !data.available ? (
        <ComingSoon title="Approvals">Profiles set to Balanced or Careful will ask you here before risky tool calls.</ComingSoon>
      ) : (
        <div className="grid gap-6">
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting">New requests appear here by themselves.</EmptyState>
          ) : (
            <div className="grid gap-3">
              {pending.map((r) => (
                <Card key={r.id}>
                  <CardHeader>
                    <CardTitle className="font-mono text-sm">{r.tool}</CardTitle>
                    <CardDescription>
                      {r.reason} · profile {r.profileId} · {when(r.createdAt)}
                    </CardDescription>
                    <CardAction className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => decide(r.id, "denied")}>
                        <XIcon />
                        Deny
                      </Button>
                      <Button size="sm" onClick={() => decide(r.id, "approved")}>
                        <CheckIcon />
                        Approve
                      </Button>
                    </CardAction>
                  </CardHeader>
                  {r.preview && (
                    <CardContent>
                      <p className="mb-1 text-xs text-muted-foreground">
                        What the AI wants to send. Masked values like [EMAIL_1] are filled in only if you approve.
                      </p>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
                        {r.preview}
                      </pre>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium">Recent decisions</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.tool}</TableCell>
                      <TableCell>{r.profileId}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "approved" ? "secondary" : "outline"}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{when(r.decidedAt ?? r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
