"use client";

import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ClientFields } from "@/components/client-fields";
import { ChoiceCards, ErrorNote, Field, SecretInput } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, type Server, slugify } from "@/lib/api";
import { MoreInAdvanced, useView } from "@/components/view";

export type AuthChoice = "none" | "oauth" | "key";

export interface SecretRow {
  name: string;
  value: string;
  secret: boolean;
}

/** Rows of name + value; values are write-only. */
export function SecretRows({
  rows,
  onChange,
  namePlaceholder,
  kind,
}: {
  rows: SecretRow[];
  onChange: (rows: SecretRow[]) => void;
  namePlaceholder: string;
  kind: "header" | "env" | "param";
}) {
  const set = (i: number, patch: Partial<SecretRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
          <Input
            value={r.name}
            placeholder={namePlaceholder}
            onChange={(e) => set(i, { name: e.target.value })}
            className="font-mono"
            aria-label={kind === "header" ? "Header name" : kind === "param" ? "Parameter name" : "Variable name"}
          />
          {r.secret ? (
            <SecretInput value={r.value} onChange={(v) => set(i, { value: v })} placeholder="Value (hidden)" />
          ) : (
            <Input
              value={r.value}
              placeholder="Value"
              onChange={(e) => set(i, { value: e.target.value })}
              className="font-mono"
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove row"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2Icon />
          </Button>
          {kind === "env" && (
            <label className="col-span-3 -mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={r.secret} onCheckedChange={(v) => set(i, { secret: v })} size="sm" />
              Secret (stored encrypted, never shown again)
            </label>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...rows, { name: "", value: "", secret: true }])}
      >
        <PlusIcon />
        Add {kind === "header" ? "header" : kind === "param" ? "parameter" : "variable"}
      </Button>
    </div>
  );
}

/** A closed "Advanced" section. In Simple view it is a link that switches to Advanced view instead. */
export function Advanced({ children, label = "Advanced" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const { advanced } = useView();
  if (!advanced) return <MoreInAdvanced label={label === "Advanced" ? "More options (Advanced view)" : `${label} (Advanced view)`} />;
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {label}
        <ChevronDownIcon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="grid gap-4 border-t p-3">{children}</div>}
    </div>
  );
}

/** clientId / clientSecret for an OAuth account, when filled in. */
export function clientPayload(auth: AuthChoice, clientId: string, clientSecret: string) {
  if (auth !== "oauth") return {};
  return {
    ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
    ...(clientSecret ? { clientSecret } : {}),
  };
}

/** Builds the account part of a request from the sign-in choice. */
export function accountPayload(
  where: "url" | "command",
  auth: AuthChoice,
  key: { header: string; value: string; bearer: boolean; envName: string },
  extraHeaders: SecretRow[],
  env: SecretRow[],
) {
  const headers = extraHeaders.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value }));
  const envRows = env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value, secret: e.secret }));
  if (auth === "key" && where === "url")
    headers.unshift({ name: key.header.trim() || "Authorization", value: key.bearer ? `Bearer ${key.value}` : key.value });
  if (auth === "key" && where === "command") envRows.unshift({ name: key.envName.trim(), value: key.value, secret: true });
  return {
    auth: auth === "oauth" ? "oauth" : headers.length ? "header" : "none",
    headers,
    env: envRows,
  } as const;
}

export function ServerForm({
  onAdded,
  onCancel,
  submitLabel = "Add server",
  initialWhere = "url",
}: {
  onAdded: (server: Server, auth: AuthChoice) => void;
  onCancel?: () => void;
  submitLabel?: string;
  initialWhere?: "url" | "command";
}) {
  const [where, setWhere] = useState<"url" | "command">(initialWhere);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [auth, setAuth] = useState<AuthChoice>("none");
  const [key, setKey] = useState({ header: "Authorization", value: "", bearer: true, envName: "API_KEY" });
  const [sse, setSse] = useState(false);
  const [insecure, setInsecure] = useState(false);
  const [extraHeaders, setExtraHeaders] = useState<SecretRow[]>([]);
  const [env, setEnv] = useState<SecretRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const effectiveId = idTouched ? id : slugify(name);
  const effectiveAuth = where === "command" && auth === "oauth" ? "none" : auth;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!effectiveId) return setError("Give the server a name.");
    if (where === "url" && !url.trim()) return setError("Enter the server's URL.");
    if (where === "command" && !command.trim()) return setError("Enter the command that starts the server.");
    if (effectiveAuth === "key" && !key.value) return setError("Paste the API key or token.");
    setBusy(true);
    try {
      const server = await api.post<Server>("/servers", {
        id: effectiveId,
        ...(name.trim() && name.trim() !== effectiveId ? { name: name.trim() } : {}),
        ...(where === "url"
          ? { url: url.trim(), transport: sse ? "sse" : "http", allowInsecure: insecure }
          : { command: command.trim() }),
        account: {
          ...accountPayload(where, effectiveAuth, key, extraHeaders, env),
          ...clientPayload(effectiveAuth, clientId, clientSecret),
        },
      });
      onAdded(server, effectiveAuth);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      <Field label="Where does the server run?">
        <ChoiceCards
          value={where}
          onChange={setWhere}
          columns={2}
          options={[
            { value: "url", title: "Online", description: "You have a web address (URL) for it." },
            { value: "command", title: "On this computer", description: "You have a command such as npx or uvx." },
          ]}
        />
      </Field>

      <Field label="Name" htmlFor="server-name" hint={effectiveId ? <>Short name: <code>{effectiveId}</code></> : "For example: Linear, Work Gmail, Files"}>
        <Input id="server-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear" autoFocus />
      </Field>

      {where === "url" ? (
        <Field label="URL" htmlFor="server-url" hint="Usually ends in /mcp. Your provider's docs list it.">
          <Input
            id="server-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            className="font-mono"
          />
        </Field>
      ) : (
        <Field label="Command" htmlFor="server-command" hint="Copy it from the server's instructions. It runs on this computer as you, so add only servers you trust. Needs Node.js (npx) or uv (uvx).">
          <Input
            id="server-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
            className="font-mono"
          />
        </Field>
      )}

      <Field label="How does it sign in?">
        <ChoiceCards
          value={effectiveAuth}
          onChange={setAuth}
          options={[
            { value: "none", title: "No sign-in needed" },
            {
              value: "oauth",
              title: "Sign in with my browser",
              description: where === "url" ? "You'll log in on the provider's page, like any app." : "Only for online servers.",
              disabled: where === "command",
            },
            { value: "key", title: "API key or token", description: "Stored encrypted. You won't see it again after saving." },
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
          <Field label="API key or token" htmlFor="server-key">
            <SecretInput id="server-key" value={key.value} onChange={(v) => setKey({ ...key, value: v })} placeholder="Paste it here" />
          </Field>
          {where === "url" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Header" htmlFor="server-key-header" hint="Most servers use Authorization.">
                <Input
                  id="server-key-header"
                  value={key.header}
                  onChange={(e) => setKey({ ...key, header: e.target.value })}
                  className="font-mono"
                />
              </Field>
              <label className="flex items-center gap-2 self-center text-sm">
                <Switch checked={key.bearer} onCheckedChange={(v) => setKey({ ...key, bearer: v })} />
                Put “Bearer” before the key
              </label>
            </div>
          ) : (
            <Field label="Environment variable" htmlFor="server-key-env" hint="The name the server's instructions give, e.g. GITHUB_TOKEN.">
              <Input
                id="server-key-env"
                value={key.envName}
                onChange={(e) => setKey({ ...key, envName: e.target.value })}
                className="font-mono"
              />
            </Field>
          )}
        </div>
      )}

      <Advanced>
        <Field label="Short name" htmlFor="server-id" hint="Used in URLs and tool names. Lowercase letters, digits and dashes.">
          <Input
            id="server-id"
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
            className="font-mono"
          />
        </Field>
        {where === "url" ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={sse} onCheckedChange={setSse} />
              Legacy SSE transport (older servers)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={insecure} onCheckedChange={setInsecure} />
              Allow plain http (localhost and private addresses only)
            </label>
            <Field label="Extra headers" hint="Values are stored encrypted.">
              <SecretRows rows={extraHeaders} onChange={setExtraHeaders} namePlaceholder="X-Workspace" kind="header" />
            </Field>
          </>
        ) : (
          <Field label="Environment variables">
            <SecretRows rows={env} onChange={setEnv} namePlaceholder="VARIABLE_NAME" kind="env" />
          </Field>
        )}
      </Advanced>

      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
