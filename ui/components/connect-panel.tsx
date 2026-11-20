"use client";

import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeBlock, ErrorNote, Field, RevealToken } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ContinuousTabs } from "@/components/watermelon/continuous-tabs";
import { api, errorMessage, type Snippet } from "@/lib/api";
import { CopyButton } from "./common";

interface ConnectInfo {
  url: string;
  token: string;
  snippets: Snippet[];
}

/** Copy-ready setup for each client, for one profile. */
export function ConnectPanel({ profileId }: { profileId: string }) {
  const [info, setInfo] = useState<ConnectInfo>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Snippet["id"]>("claude-code");
  const [rotating, setRotating] = useState(false);
  const [notes, setNotes] = useState<string[]>();

  useEffect(() => {
    setInfo(undefined);
    setNotes(undefined);
    api
      .post<ConnectInfo>(`/profiles/${profileId}/connect`)
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, [profileId]);

  if (error) return <ErrorNote error={error} />;
  if (!info) return <Skeleton className="h-48" />;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <ContinuousTabs
          aria-label="Client"
          tabs={info.snippets.map((s) => ({ id: s.id, label: s.title }))}
          value={tab}
          onChange={setTab}
        />
        {info.snippets
          .filter((s) => s.id === tab)
          .map((s) => (
            <div key={s.id} role="tabpanel" className="grid gap-2 pt-2">
              <p className="text-sm text-muted-foreground">{s.hint}</p>
              <CodeBlock code={s.code} />
            </div>
          ))}
      </div>
      <Card size="sm">
        <CardContent className="grid gap-3">
          <Field label="Address">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">{info.url}</code>
              <CopyButton value={info.url} />
            </div>
          </Field>
          <Field
            label="Token"
            hint="Only for clients that cannot run pmcpg connect. Treat it like a password: anyone with it can use this profile's tools."
          >
            <div className="grid gap-2">
              <RevealToken token={info.token} />
              <div>
                <Button variant="outline" size="sm" onClick={() => setRotating(true)}>
                  <RefreshCwIcon />
                  New token
                </Button>
              </div>
            </div>
          </Field>
          {notes && (
            <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={rotating}
        onOpenChange={setRotating}
        title="Replace this profile's token?"
        description="The old token stops working at once. Apps using pmcpg connect pick up the new one by themselves; apps with the token in their settings are updated where pMCPg finds them."
        confirmLabel="Replace token"
        onConfirm={async (password) => {
          const r = await api.post<ConnectInfo & { notes: string[] }>(`/profiles/${profileId}/token/rotate`, {
            password,
          });
          setInfo({ url: r.url, token: r.token, snippets: r.snippets });
          setNotes(r.notes);
          toast.success("New token created. The old one no longer works.");
        }}
      />
    </div>
  );
}
