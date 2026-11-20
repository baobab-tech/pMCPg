"use client";

import { CheckCircle2Icon, KeyRoundIcon, LogInIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock, ErrorNote, Field, SecretInput } from "@/components/common";
import { ClientFields } from "@/components/client-fields";
import { Advanced, type AuthChoice, clientPayload, ServerForm } from "@/components/server-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, type ProbeResult, type Server, type Status } from "@/lib/api";
import { cn } from "@/lib/utils";

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

const isLocal = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
};

type Found = Extract<ProbeResult, { ok: true }>;

/** Result card after a probe: what the server needs, and the button to add it. */
function ProbeCard({ probe, onAdded }: { probe: Found; onAdded: (s: Server, auth: AuthChoice) => void }) {
  const [id, setId] = useState(probe.suggestedId);
  const [name, setName] = useState(probe.serverName ?? "");
  const [header, setHeader] = useState("Authorization");
  const [bearer, setBearer] = useState(true);
  const [key, setKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const auth = probe.auth;
  const manualClient = auth.type === "oauth" && auth.registration === "manual";
  const [redirectUri, setRedirectUri] = useState("");
  useEffect(() => {
    if (!manualClient) return;
    // The provider must redirect to the gateway's own address, which can differ from the one in the browser bar.
    api
      .get<Status>("/status")
      .then((st) => setRedirectUri(`${st.url.replace(/\/+$/, "")}/oauth/callback`))
      .catch(() => {});
  }, [manualClient]);

  async function add() {
    setError(undefined);
    if (auth.type === "header" && !key) return setError("Paste the key first.");
    if (manualClient && !clientId.trim()) return setError("Enter the client ID you registered with the provider.");
    setBusy(true);
    try {
      const server = await api.post<Server>("/servers", {
        id,
        ...(name.trim() && name.trim() !== id ? { name: name.trim() } : {}),
        url: probe.url,
        transport: probe.transport,
        allowInsecure: probe.url.startsWith("http:") && isLocal(probe.url),
        account:
          auth.type === "header"
            ? { auth: "header", headers: [{ name: header.trim() || "Authorization", value: bearer ? `Bearer ${key}` : key }] }
            : auth.type === "oauth"
              ? {
                  auth: "oauth",
                  ...clientPayload("oauth", clientId, clientSecret),
                  // The secret is tied to the provider shown on this card ("Sign in with ...").
                  ...(clientSecret ? { clientIssuer: auth.issuer } : {}),
                }
              : { auth: "none" },
      });
      onAdded(server, auth.type === "oauth" ? "oauth" : auth.type === "header" ? "key" : "none");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const headline =
    auth.type === "none"
      ? { icon: CheckCircle2Icon, title: "No sign-in needed", text: "This server answers without a login." }
      : auth.type === "oauth"
        ? {
            icon: LogInIcon,
            title: `Sign in with ${hostOf(auth.issuer)}`,
            text: "After adding it, you log in on the provider's page, like any app.",
          }
        : { icon: KeyRoundIcon, title: "Needs a key", text: auth.hint };

  return (
    <div className="grid gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            auth.type === "header" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-brand/15 text-brand",
          )}
        >
          <headline.icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">{headline.title}</p>
          <p className="text-sm text-muted-foreground">{headline.text}</p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {probe.serverName ? `${probe.serverName} · ` : ""}
            {probe.url}
            {probe.transport === "sse" ? " · legacy SSE" : ""}
          </p>
        </div>
      </div>

      {manualClient && (
        <div className="grid gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm">
            <span className="font-medium">This provider needs a client ID you register with them.</span>{" "}
            <span className="text-muted-foreground">
              Create an app in its developer settings with this redirect address, then paste the client ID here:
            </span>
          </p>
          {redirectUri && <CodeBlock code={redirectUri} />}
          <ClientFields
            clientId={clientId}
            onClientId={setClientId}
            clientSecret={clientSecret}
            onClientSecret={setClientSecret}
          />
        </div>
      )}

      {auth.type === "header" && (
        <div className="grid gap-3">
          <Field label="API key or token" htmlFor="probe-key" hint="Stored encrypted. You won't see it again after saving.">
            <SecretInput id="probe-key" value={key} onChange={setKey} placeholder="Paste it here" />
          </Field>
        </div>
      )}

      <Advanced>
        {auth.type === "oauth" && !manualClient && (
          <ClientFields
            clientId={clientId}
            onClientId={setClientId}
            clientSecret={clientSecret}
            onClientSecret={setClientSecret}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="probe-name">
            <Input id="probe-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={id} />
          </Field>
          <Field label="Short name" htmlFor="probe-id" hint="Used in URLs and tool names.">
            <Input id="probe-id" value={id} onChange={(e) => setId(e.target.value)} className="font-mono" />
          </Field>
        </div>
        {auth.type === "header" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Header" htmlFor="probe-header">
              <Input id="probe-header" value={header} onChange={(e) => setHeader(e.target.value)} className="font-mono" />
            </Field>
            <label className="flex items-center gap-2 self-center text-sm">
              <Switch checked={bearer} onCheckedChange={setBearer} />
              Put “Bearer” before the key
            </label>
          </div>
        )}
      </Advanced>

      <ErrorNote error={error} />
      <Button className="w-fit" onClick={add} disabled={busy}>
        {busy ? "Adding…" : auth.type === "oauth" ? "Add and sign in" : "Add server"}
      </Button>
    </div>
  );
}

/** "Paste a server URL": probe it, show what it needs, add it. A command option sits under Advanced. */
export function AddByUrl({
  onAdded,
  url: presetUrl,
}: {
  onAdded: (s: Server, auth: AuthChoice) => void;
  /** A URL picked elsewhere (a starter tile): filled in and checked right away. */
  url?: string;
}) {
  const [url, setUrl] = useState(presetUrl ?? "");
  const [probe, setProbe] = useState<ProbeResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: run when a new preset URL arrives
  useEffect(() => {
    if (!presetUrl) return;
    setUrl(presetUrl);
    void run(presetUrl);
  }, [presetUrl]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    await run(url);
  }

  async function run(raw: string) {
    setError(undefined);
    setProbe(undefined);
    let u = raw.trim();
    if (!u) return setError("Paste the server's URL.");
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setBusy(true);
    try {
      setProbe(await api.post<ProbeResult>("/probe", { url: u }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={check} className="grid gap-2">
        <label htmlFor="probe-url" className="text-sm font-medium">
          Paste a server URL
        </label>
        <div className="flex gap-2">
          <Input
            id="probe-url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setProbe(undefined);
            }}
            placeholder="https://mcp.example.com/mcp"
            className="font-mono"
            autoFocus={!presetUrl}
          />
          <Button type="submit" disabled={busy}>
            <SearchIcon />
            {busy ? "Checking…" : "Check"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Find it in the provider's docs. For servers you added in claude.ai, ChatGPT or Gemini, copy the URL from their
          connector settings.
        </p>
      </form>

      <ErrorNote error={error} />
      {probe && !probe.ok && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Couldn't reach a server at that address</p>
            <p className="text-muted-foreground">{probe.error}</p>
          </div>
        </div>
      )}
      {probe?.ok && <ProbeCard key={probe.url} probe={probe} onAdded={onAdded} />}

      <Advanced label="Add by command instead (runs on this computer)">
        <ServerForm onAdded={onAdded} submitLabel="Add server" initialWhere="command" />
      </Advanced>
    </div>
  );
}
