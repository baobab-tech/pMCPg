"use client";

import { KeyRoundIcon, LogInIcon, LogOutIcon, PlusIcon, Settings2Icon, Trash2Icon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, PageHeader, StateBadge } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RunActionButton } from "@/components/watermelon/run-action-button";
import { type Account, api, errorMessage, type Server } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { KeysDialog } from "@/components/keys-dialog";
import { SignInDialog } from "@/components/signin-dialog";
import { LearnMore } from "@/components/help/learn-more";
import { HelpTip, ServerAccountTable } from "@/components/help/help-tip";
import { ToolsDialog } from "@/components/tools-dialog";

const AUTH_LABEL: Record<Account["auth"], string> = {
  none: "No sign-in",
  oauth: "Browser sign-in",
  header: "API key",
};

function AccountCard({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [signingIn, setSigningIn] = useState(false);
  const [keys, setKeys] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const missing = [...account.headers, ...account.env, ...account.params].some((s) => !s.set);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {account.id}
          <StateBadge state={account.state} />
        </CardTitle>
        <CardDescription>
          {account.serverName}
          {account.label ? ` · ${account.label}` : ""} · {account.tools} {account.tools === 1 ? "tool" : "tools"}
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-1">
          {account.auth === "oauth" &&
            (account.signedIn ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await api.post(`/accounts/${account.id}/signout`);
                    toast.success(`Signed out: ${account.id}`);
                    onChanged();
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                <LogOutIcon />
                Sign out
              </Button>
            ) : (
              <Button size="sm" onClick={() => setSigningIn(true)}>
                <LogInIcon />
                Sign in
              </Button>
            ))}
          {account.auth !== "oauth" ? (
            <Button variant="outline" size="sm" onClick={() => setKeys(true)}>
              <KeyRoundIcon />
              Keys
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Sign-in settings" onClick={() => setKeys(true)}>
              <Settings2Icon />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowTools(true)}>
            <WrenchIcon />
            Show tools
          </Button>
          <RunActionButton
            action={async () => {
              const r = await api.post<{ tools: number; error?: string; state: Account["state"] }>(`/accounts/${account.id}/test`);
              onChanged();
              if (r.error || r.state.status !== "connected") return { ok: false, label: r.error ?? "Problem found" };
              return { ok: true, label: `${r.tools} ${r.tools === 1 ? "tool" : "tools"} found` };
            }}
          />
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(true)}>
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{AUTH_LABEL[account.auth]}</Badge>
        {account.auth === "oauth" && <Badge variant="outline">{account.signedIn ? "Signed in" : "Not signed in"}</Badge>}
        {missing && <Badge variant="destructive">A key is missing</Badge>}
        <span className="text-muted-foreground">In profiles: {account.profiles.join(", ")}</span>
        {"reason" in account.state && <span className="w-full text-muted-foreground">{account.state.reason}</span>}
        {(missing || ["sign-in-needed", "unreachable", "error"].includes(account.state.status)) && (
          <LearnMore slug="account-not-working" query={{ account: account.id }}>
            Why isn't this working?
          </LearnMore>
        )}
      </CardContent>

      <SignInDialog accountId={account.id} open={signingIn} onOpenChange={setSigningIn} onSignedIn={onChanged} />
      <KeysDialog account={account} open={keys} onOpenChange={setKeys} onSaved={onChanged} />
      <ToolsDialog accountId={account.id} title={account.label ?? account.id} open={showTools} onOpenChange={setShowTools} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${account.id}?`}
        description="Its stored keys and sign-in are deleted, and it leaves every profile."
        onConfirm={async (password) => {
          await api.del(`/accounts/${account.id}`, { password });
          toast.success(`Removed ${account.id}`);
          onChanged();
        }}
      />
    </Card>
  );
}

export default function AccountsPage() {
  const { data, error, reload } = useApi<Account[]>("/accounts", { pollMs: 10000 });
  const servers = useApi<Server[]>("/servers");
  const [adding, setAdding] = useState(false);
  const hasServers = !!servers.data?.length;

  return (
    <>
      <PageHeader
        title="Accounts"
        description={
          <>
            Every login, across all your servers, in one list. A server is how pMCPg reaches a tool provider (a web
            address or a command); an account is one login to it, like work and personal Gmail on the same Gmail server.
            Most people manage logins from <Link href="/servers/" className="underline underline-offset-3">Servers</Link>;
            this page is for finer control. Keys and tokens are stored encrypted on this computer and never shown again.{" "}
            <HelpTip title="Servers, accounts and profiles" slug="servers-accounts-profiles">
              <p>A server is where tools come from. An account is one sign-in to it. A profile picks accounts for one AI app.</p>
              <ServerAccountTable />
            </HelpTip>
          </>
        }
        actions={
          hasServers ? (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon />
              Add login
            </Button>
          ) : undefined
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-32" />
      ) : data.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          action={
            <Link href="/servers/?add=1" className={buttonVariants()}>
              Add a server
            </Link>
          }
        >
          Adding a server creates its first account. <LearnMore slug="servers-accounts-profiles" />
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {data.map((a) => (
            <AccountCard key={a.id} account={a} onChanged={reload} />
          ))}
        </div>
      )}
      {servers.data && (
        <AddAccountDialog
          servers={servers.data}
          open={adding}
          onOpenChange={setAdding}
          onAdded={(a) => {
            toast.success(`Added ${a.id}`);
            void reload();
          }}
        />
      )}
    </>
  );
}
