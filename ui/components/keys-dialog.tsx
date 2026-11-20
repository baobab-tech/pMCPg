"use client";

import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ClientFields } from "@/components/client-fields";
import { ErrorNote, Field, SecretInput } from "@/components/common";
import { Advanced, type SecretRow, SecretRows } from "@/components/server-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Account, api, errorMessage } from "@/lib/api";

/** Write-only fields for an account's secrets: headers, env, URL parameters, and the OAuth client for manual registration. */
export function KeysDialog({ account, open, onOpenChange, onSaved }: { account: Account; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [newHeaders, setNewHeaders] = useState<SecretRow[]>([]);
  const [newEnv, setNewEnv] = useState<SecretRow[]>([]);
  const [newParams, setNewParams] = useState<SecretRow[]>([]);
  const [clientId, setClientId] = useState(account.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string>();
  const oauth = account.auth === "oauth";
  const secrets = [
    ...account.params.map((p) => ({ kind: "param" as const, name: p.name, set: p.set })),
    ...account.headers.map((h) => ({ kind: "header" as const, name: h.name, set: h.set })),
    ...account.env.filter((e) => e.secret).map((e) => ({ kind: "env" as const, name: e.name, set: e.set })),
  ];
  const label = (k: "param" | "header" | "env", n: string) =>
    k === "header" ? `Header ${n}` : k === "param" ? `URL parameter ?${n}` : n;
  const plainEnv = account.env.filter((e) => !e.secret);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setValues({});
          setNewHeaders([]);
          setNewEnv([]);
          setNewParams([]);
          setClientId(account.clientId ?? "");
          setClientSecret("");
          setError(undefined);
        }
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const headers = [
              ...secrets.filter((s) => s.kind === "header" && values[`header:${s.name}`]).map((s) => ({ name: s.name, value: values[`header:${s.name}`] })),
              ...newHeaders.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
            ];
            const env = [
              ...secrets.filter((s) => s.kind === "env" && values[`env:${s.name}`]).map((s) => ({ name: s.name, value: values[`env:${s.name}`], secret: true })),
              ...newEnv.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), value: v.value, secret: v.secret })),
            ];
            const params = [
              ...secrets.filter((s) => s.kind === "param" && values[`param:${s.name}`]).map((s) => ({ name: s.name, value: values[`param:${s.name}`] })),
              ...newParams.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), value: p.value })),
            ];
            const client =
              oauth && (clientId.trim() !== (account.clientId ?? "") || clientSecret)
                ? { ...(clientId.trim() ? { clientId: clientId.trim() } : {}), ...(clientSecret ? { clientSecret } : {}) }
                : {};
            try {
              await api.patch(`/accounts/${account.id}`, { headers, env, params, ...client });
              toast.success("Saved. Old values are replaced.");
              onSaved();
              onOpenChange(false);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{oauth ? "Sign-in settings" : "Keys"} for {account.id}</DialogTitle>
            <DialogDescription>Stored values are never shown. Type a new value to replace one; leave it empty to keep it.</DialogDescription>
          </DialogHeader>
          {secrets.map((s) => (
            <Field
              key={`${s.kind}:${s.name}`}
              label={label(s.kind, s.name)}
              hint={s.set ? "A value is stored." : "No value stored yet."}
            >
              <div className="flex gap-2">
                <div className="flex-1">
                  <SecretInput
                    value={values[`${s.kind}:${s.name}`] ?? ""}
                    onChange={(v) => setValues({ ...values, [`${s.kind}:${s.name}`]: v })}
                    placeholder="New value"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${s.name}`}
                  onClick={async () => {
                    try {
                      await api.post(`/accounts/${account.id}/remove-secret`, { kind: s.kind, name: s.name });
                      toast.success(`Removed ${s.name}`);
                      onSaved();
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </Field>
          ))}
          {plainEnv.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Plain settings: {plainEnv.map((e) => `${e.name}=${e.value}`).join(", ")}
            </div>
          )}
          {oauth && (
            <Advanced label="OAuth client (for providers that need one registered by hand)">
              <ClientFields
                clientId={clientId}
                onClientId={setClientId}
                clientSecret={clientSecret}
                onClientSecret={setClientSecret}
                secretStored={!!account.clientId}
              />
            </Advanced>
          )}
          <Advanced label="Add headers, parameters or variables">
            {account.transport !== "stdio" && account.auth !== "oauth" && (
              <Field label="Headers">
                <SecretRows rows={newHeaders} onChange={setNewHeaders} namePlaceholder="Authorization" kind="header" />
              </Field>
            )}
            {account.transport !== "stdio" && (
              <Field label="URL parameters" hint="Added to the server's address, e.g. ?apiKey=…. Stored encrypted.">
                <SecretRows rows={newParams} onChange={setNewParams} namePlaceholder="apiKey" kind="param" />
              </Field>
            )}
            <Field label="Environment variables" hint="Used by servers that run on this computer.">
              <SecretRows rows={newEnv} onChange={setNewEnv} namePlaceholder="API_KEY" kind="env" />
            </Field>
          </Advanced>
          <ErrorNote error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


