"use client";

import { useEffect, useState } from "react";
import { ClientFields } from "@/components/client-fields";
import { ChoiceCards, ErrorNote, Field, SecretInput } from "@/components/common";
import { type AuthChoice, Advanced, accountPayload, clientPayload } from "@/components/server-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { type Account, api, errorMessage, type Server } from "@/lib/api";

/** Add a second login (account) to a server, e.g. work and personal. */
export function AddAccountDialog({
  servers,
  open,
  onOpenChange,
  onAdded,
  initialServer,
}: {
  servers: Server[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (a: Account) => void;
  initialServer?: string;
}) {
  const [server, setServer] = useState(initialServer ?? servers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [auth, setAuth] = useState<AuthChoice>("none");
  const [key, setKey] = useState({ header: "Authorization", value: "", bearer: true, envName: "API_KEY" });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string>();
  const srv = servers.find((s) => s.id === server);
  const where = srv?.transport === "stdio" ? "command" : "url";
  const effectiveAuth = where === "command" && auth === "oauth" ? "none" : auth;

  useEffect(() => {
    if (!server && servers[0]) setServer(servers[0].id);
  }, [servers, server]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            try {
              const a = await api.post<Account>("/accounts", {
                server,
                ...(name.trim() ? { name: name.trim() } : {}),
                ...(label.trim() ? { label: label.trim() } : {}),
                ...accountPayload(where, effectiveAuth, key, [], []),
                ...clientPayload(effectiveAuth, clientId, clientSecret),
              });
              onAdded(a);
              onOpenChange(false);
              setName("");
              setLabel("");
              setKey({ ...key, value: "" });
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Add another login</DialogTitle>
            <DialogDescription>Use a second login (account) when you have more than one for the same service, like work and personal Gmail.</DialogDescription>
          </DialogHeader>
          <Field label="Server">
            <ChoiceCards value={server} onChange={setServer} columns={2} options={servers.map((s) => ({ value: s.id, title: s.name }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Login name" htmlFor="acc-name" hint={name ? `Saved as ${server}-${name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}` : "e.g. work or personal"}>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="work" />
            </Field>
            <Field label="Description (optional)" htmlFor="acc-label">
              <Input id="acc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="olivier@work" />
            </Field>
          </div>
          <Field label="How does it sign in?">
            <ChoiceCards
              value={effectiveAuth}
              onChange={setAuth}
              options={[
                { value: "none", title: "No sign-in needed" },
                { value: "oauth", title: "Sign in with my browser", disabled: where === "command" },
                { value: "key", title: "API key or token" },
              ]}
            />
          </Field>
          {effectiveAuth === "oauth" && (
            <Advanced label="OAuth client (only if the provider needs one registered by hand)">
              <ClientFields clientId={clientId} onClientId={setClientId} clientSecret={clientSecret} onClientSecret={setClientSecret} />
            </Advanced>
          )}
          {effectiveAuth === "key" && (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
              <Field label="API key or token">
                <SecretInput value={key.value} onChange={(v) => setKey({ ...key, value: v })} placeholder="Paste it here" />
              </Field>
              {where === "url" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Header">
                    <Input value={key.header} onChange={(e) => setKey({ ...key, header: e.target.value })} className="font-mono" />
                  </Field>
                  <label className="flex items-center gap-2 self-center text-sm">
                    <Switch checked={key.bearer} onCheckedChange={(v) => setKey({ ...key, bearer: v })} />
                    Put “Bearer” before the key
                  </label>
                </div>
              ) : (
                <Field label="Environment variable">
                  <Input value={key.envName} onChange={(e) => setKey({ ...key, envName: e.target.value })} className="font-mono" />
                </Field>
              )}
            </div>
          )}
          <ErrorNote error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!server}>
              Add login
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
