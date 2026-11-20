"use client";

import { ArrowRightIcon, BoxesIcon, CableIcon, KeyRoundIcon, LayersIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { CopyButton, ErrorNote, PageHeader, StateBadge } from "@/components/common";
import { useSession } from "@/components/session";
import { OnboardingChecklist } from "@/components/watermelon/onboarding-checklist";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account, ActivityEntry, AppConnectStatus, Listing, Status } from "@/lib/api";
import { AdvancedOnly, useView } from "@/components/view";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";

function Stat({ href, icon: Icon, label, value }: { href: string; icon: typeof BoxesIcon; label: string; value: number | string }) {
  return (
    <Link href={href} className="group">
      <Card className="transition-colors group-hover:bg-muted/40">
        <CardContent className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Icon className="size-4" />
          </span>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

const CHECKLIST_KEY = "pmcpg.checklist.hidden";

export default function HomePage() {
  const { data, error } = useApi<Status>("/status", { pollMs: 5000 });
  const { session } = useSession();
  const { advanced } = useView();
  const accounts = useApi<Account[]>("/accounts", { pollMs: 10000 });
  const apps = useApi<AppConnectStatus[]>("/connect/status", { pollMs: 15000 });
  const calls = useApi<Listing<ActivityEntry>>("/activity?type=call&limit=1", { pollMs: 10000 });
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(CHECKLIST_KEY) === "1");
    } catch {}
  }, []);

  const unfinished = (accounts.data ?? []).filter(
    (a) => (a.auth === "oauth" && a.signedIn === false) || [...a.headers, ...a.env, ...a.params].some((x) => !x.set),
  );
  const checklist = data && [
    { id: "server", title: advanced ? "Add a server" : "Add a connection", href: "/servers/?add=1", done: data.servers > 0 },
    {
      id: "signin",
      title: "Finish signing in",
      href: "/servers/",
      done: data.servers > 0 && !!accounts.data && unfinished.length === 0,
    },
    {
      id: "connect",
      title: "Connect an AI app",
      href: "/connect/",
      done: !!apps.data?.some((a) => a.connected),
    },
    ...(calls.data?.available
      ? [{ id: "used", title: "Ask your AI app to use a tool", href: "/activity/", done: calls.data.items.length > 0 }]
      : []),
    { id: "password", title: "Protect this page with a password", href: "/settings/", done: session.passwordSet },
  ];
  const attention = data?.accounts.filter((a) => ["sign-in-needed", "unreachable", "error"].includes(a.state.status)) ?? [];

  return (
    <>
      <PageHeader title="Home" description={advanced ? "Your gateway at a glance. AI clients connect here once and reach every server you add." : "Your AI apps connect to pMCPg once and reach every connection you add."} />
      <ErrorNote error={error} />
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-50" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
                </span>
                <div>
                  <div className="font-medium">pMCPg is running</div>
                  {advanced ? (
                    <code className="text-xs text-muted-foreground">{data.url}</code>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {data.servers} connection{data.servers === 1 ? "" : "s"}
                      {apps.data?.some((a) => a.connected) &&
                        ` · used by ${apps.data
                          .filter((a) => a.connected)
                          .map((a) => a.label)
                          .join(", ")}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {advanced && <CopyButton value={data.url} label="Copy address" />}
                <Link href="/connect/" className={buttonVariants({ size: "sm" })}>
                  <CableIcon />
                  {advanced ? "Connect a client" : "Connect an AI app"}
                </Link>
              </div>
            </CardContent>
          </Card>

          {checklist && !dismissed && checklist.some((s) => !s.done) && (
            <div className="grid gap-1">
              <OnboardingChecklist steps={checklist} />
              <Button
                variant="link"
                size="sm"
                className="w-fit justify-self-end px-0 text-muted-foreground"
                onClick={() => {
                  setDismissed(true);
                  try {
                    localStorage.setItem(CHECKLIST_KEY, "1");
                  } catch {}
                }}
              >
                Hide this list
              </Button>
            </div>
          )}

          <AdvancedOnly>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat href="/servers/" icon={BoxesIcon} label="Servers" value={data.servers} />
              <Stat href="/accounts/" icon={KeyRoundIcon} label="Accounts" value={data.accounts.length} />
              <Stat href="/profiles/" icon={LayersIcon} label="Profiles" value={data.profiles} />
            </div>
          </AdvancedOnly>

          {(!!data.pendingApprovals || !!data.quarantined) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!!data.pendingApprovals && (
                <Stat href="/approvals/" icon={ShieldCheckIcon} label="Calls waiting for approval" value={data.pendingApprovals} />
              )}
              {!!data.quarantined && (
                <Stat href="/quarantine/" icon={ShieldAlertIcon} label="Tool changes to review" value={data.quarantined} />
              )}
            </div>
          )}

          {data.servers === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{advanced ? "Add your first server" : "Add your first connection"}</CardTitle>
                <CardDescription>
                  A connection gives your AI app a skill: notes, issues, files, search. Pick one and pMCPg does the rest.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/servers/?add=1" className={buttonVariants()}>
                  {advanced ? "Add a server" : "Add a connection"}
                  <ArrowRightIcon />
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{attention.length ? "Needs your attention" : advanced ? "Accounts" : "Connections"}</CardTitle>
                <CardDescription>
                  {attention.length
                    ? advanced
                      ? "These accounts can't be used until you fix them."
                      : "These connections can't be used until you fix them."
                    : advanced
                      ? "Idle accounts start when a client first uses them."
                      : "Each one starts when an AI app first uses it."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {(attention.length ? attention : data.accounts).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <Link href={advanced ? "/accounts/" : "/servers/"} className="font-medium hover:underline">
                        {a.id}
                      </Link>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {a.tools} {a.tools === 1 ? "tool" : "tools"}
                        </span>
                        <StateBadge state={a.state} />
                        {attention.length > 0 && (
                          <LearnMore slug="account-not-working" query={{ account: a.id }}>
                            Fix
                          </LearnMore>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
