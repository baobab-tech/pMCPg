"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ErrorNote, Field, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useSession } from "@/components/session";
import { Advanced } from "@/components/server-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, type Settings } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";
import { PASSWORD_HINT, PASSWORD_LABEL, PasswordHelp } from "@/components/info-tip";
import { MaskedValuesCard } from "@/components/forget-masked";
import { ProtectionCard } from "@/components/protection-card";
import { AdvancedOnly, SimpleOnly } from "@/components/view";

function PasswordCard({ settings, onChanged }: { settings: Settings; onChanged: () => void }) {
  const { setSession } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          pMCPg password
          <PasswordHelp />
          <Badge variant={settings.passwordSet ? "secondary" : "outline"}>{settings.passwordSet ? "On" : "Off"}</Badge>
        </CardTitle>
        <CardDescription>
          {settings.passwordRequired
            ? "Required: pMCPg is reachable from other machines."
            : "Protects this page from other people and programs on this computer. It is not a password for your AI apps or accounts. Forgot it? Run: pmcpg ui reset-password"}{" "}
          <LearnMore slug="ui-password" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-sm gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            if (next !== again) return setError("The two passwords don't match.");
            try {
              setSession(await api.changePassword(settings.passwordSet ? current : undefined, next));
              toast.success(settings.passwordSet ? "Password changed. Other sessions were signed out." : "Password set.");
              setCurrent("");
              setNext("");
              setAgain("");
              onChanged();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          {settings.passwordSet && (
            <Field label={PASSWORD_LABEL} htmlFor="pw-current" hint={PASSWORD_HINT}>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
          )}
          <Field label={settings.passwordSet ? "New password" : "Password"} htmlFor="pw-new" hint="At least 8 characters.">
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Type it again" htmlFor="pw-again">
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!next}>
              {settings.passwordSet ? "Change password" : "Set password"}
            </Button>
            {settings.passwordSet && !settings.passwordRequired && (
              <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
                Turn off
              </Button>
            )}
          </div>
        </form>
      </CardContent>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Turn off the password?"
        description="Anyone who can open this page on this computer can change your setup."
        confirmLabel="Turn off"
        onConfirm={async (password) => {
          setSession(await api.removePassword(password));
          toast.success("Password turned off");
          onChanged();
        }}
      />
    </Card>
  );
}

function NetworkCard({ settings, onChanged }: { settings: Settings; onChanged: () => void }) {
  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(String(settings.port));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  async function save(password?: string) {
    const r = await api.patch<{ restartNeeded: boolean }>("/settings", { host, port: Number(port), password });
    if (r.restartNeeded) toast.info("Saved. Restart pMCPg to use the new address.");
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Address</CardTitle>
        <CardDescription>
          pMCPg listens on <code>{settings.url}</code>. Clients and sign-in pages use this address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Advanced label="Change address or port">
          <form
            className="grid max-w-sm gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              if (host !== settings.host) return setConfirming(true);
              try {
                await save();
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <Field label="Listen on" htmlFor="set-host" hint="127.0.0.1 keeps pMCPg private to this computer. Anything else needs a password.">
              <Input id="set-host" value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Port" htmlFor="set-port" hint="Changing it breaks connected clients and may break sign-ins registered with the old address.">
              <Input id="set-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} className="font-mono" />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" className="w-fit">
              Save
            </Button>
          </form>
        </Advanced>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Change the listening address?"
        description={`pMCPg will listen on ${host} after a restart.`}
        confirmLabel="Change"
        onConfirm={save}
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { data, error, reload } = useApi<Settings>("/settings");
  return (
    <>
      <PageHeader title="Settings" />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4">
          <PasswordCard settings={data} onChanged={reload} />
          <SimpleOnly>
            <ProtectionCard />
          </SimpleOnly>
          <MaskedValuesCard />
          <NetworkCard key={`${data.host}:${data.port}`} settings={data} onChanged={reload} />
          <AdvancedOnly>
          <Card>
            <CardHeader>
              <CardTitle>Encryption key</CardTitle>
              <CardDescription>
                Keys and tokens are encrypted in state.db with one master key.{" "}
                {data.keySource === "keychain"
                  ? "It is stored in this computer's keychain."
                  : "It comes from the PMCPG_MASTER_KEY or PMCPG_MASTER_KEY_FILE environment variable."}{" "}
                <LearnMore slug="where-keys-are-stored" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{data.keySource === "keychain" ? "OS keychain" : "Environment"}</Badge>
            </CardContent>
          </Card>
          </AdvancedOnly>
        </div>
      )}
    </>
  );
}
