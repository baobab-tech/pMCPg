"use client";

import { Field, SecretInput } from "@/components/common";
import { Input } from "@/components/ui/input";

/** Client ID (plain, kept in config.yaml) and optional client secret (write-only, vault). */
export function ClientFields({
  clientId,
  onClientId,
  clientSecret,
  onClientSecret,
  secretStored = false,
}: {
  clientId: string;
  onClientId: (v: string) => void;
  clientSecret: string;
  onClientSecret: (v: string) => void;
  secretStored?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <Field label="Client ID" htmlFor="client-id" hint="From the app you registered in the provider's developer settings.">
        <Input
          id="client-id"
          value={clientId}
          onChange={(e) => onClientId(e.target.value)}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field
        label="Client secret (if the provider gave you one)"
        htmlFor="client-secret"
        hint={secretStored ? "Leave empty to keep the stored one. Stored encrypted." : "Stored encrypted. You won't see it again."}
      >
        <SecretInput id="client-secret" value={clientSecret} onChange={onClientSecret} placeholder="Optional" />
      </Field>
    </div>
  );
}
