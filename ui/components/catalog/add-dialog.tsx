"use client";

import { CheckCircle2Icon, GlobeIcon, LogInIcon, MonitorIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNote, Field, SecretInput } from "@/components/common";
import { ClientFields } from "@/components/client-fields";
import { PRIVACY_OPTIONS, privacyTitle } from "@/components/profile-options";
import { Advanced, type AuthChoice, clientPayload } from "@/components/server-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useView } from "@/components/view";
import {
  api,
  type CatalogAddResult,
  type CatalogEntry,
  errorMessage,
  type Privacy,
  type ProbeResult,
  type Profile,
  type Server,
  type TrustLabel,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { TIER_HINT, TIER_LABEL, TIER_TONE, TRUST_LABELS } from "./labels";

type Available = Extract<CatalogEntry, { available: true }>;

const STRICTNESS: Privacy[] = ["off", "standard", "strict"];

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/**
 * Add one catalog entry: confirm trust and privacy, enter the keys it names, check a remote server
 * with the existing probe, then add it. Browser sign-in follows in the caller (SignInDialog).
 */
export function CatalogAddDialog({
  entry,
  open,
  onOpenChange,
  onAdded,
}: {
  entry: Available;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (server: Server, auth: AuthChoice) => void;
}) {
  const { advanced } = useView();
  const [id, setId] = useState(entry.serverId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [trust, setTrust] = useState<TrustLabel[]>(entry.trust);
  const [current, setCurrent] = useState<Privacy>();
  const [privacy, setPrivacy] = useState<Privacy>(entry.privacy);
  const [probe, setProbe] = useState<ProbeResult>();
  const [probing, setProbing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Reset and check the server each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setId(entry.serverId);
    setValues({});
    setTrust(entry.trust);
    setError(undefined);
    setProbe(undefined);
    setClientId("");
    setClientSecret("");
    let stop = false;
    api
      .get<Profile[]>("/profiles")
      .then((ps) => {
        if (stop) return;
        const all = ps.find((p) => p.id === "all")?.privacy ?? "standard";
        setCurrent(all);
        // Suggest the stricter of the entry's level and the current one; never suggest lowering.
        setPrivacy(STRICTNESS.indexOf(entry.privacy) > STRICTNESS.indexOf(all) ? entry.privacy : all);
      })
      .catch(() => {});
    if (entry.kind === "remote") {
      setProbing(true);
      api
        .post<ProbeResult>("/probe", { url: entry.target })
        .then((r) => !stop && setProbe(r))
        .catch((e) => !stop && setProbe({ ok: false, url: entry.target, error: errorMessage(e) }))
        .finally(() => !stop && setProbing(false));
    }
    return () => {
      stop = true;
    };
  }, [open, entry]);

  const probedAuth = probe?.ok ? probe.auth : undefined;
  const oauth = entry.auth.type === "oauth" || probedAuth?.type === "oauth";
  const manualClient = probedAuth?.type === "oauth" && probedAuth.registration === "manual";
  const raises = current !== undefined && STRICTNESS.indexOf(privacy) > STRICTNESS.indexOf(current);

  async function add() {
    setError(undefined);
    const missing = entry.credentials.find((c) => c.required && !values[c.name]?.trim());
    if (missing) return setError(`Enter ${missing.name} first.`);
    if (manualClient && !clientId.trim()) return setError("Enter the client ID you registered with the provider.");
    setBusy(true);
    try {
      const r = await api.post<CatalogAddResult>("/catalog/add", {
        name: entry.name,
        ...(id !== entry.serverId ? { id } : {}),
        trust,
        values: entry.credentials
          .filter((c) => values[c.name]?.trim())
          .map((c) => ({ name: c.name, value: values[c.name]?.trim() ?? "" })),
        ...(oauth ? clientPayload("oauth", clientId, clientSecret) : {}),
        ...(oauth && clientSecret && probedAuth?.type === "oauth" ? { clientIssuer: probedAuth.issuer } : {}),
        ...(raises ? { privacy: { profile: "all", level: privacy } } : {}),
      });
      onAdded(r.server, r.auth === "oauth" ? "oauth" : r.auth === "header" ? "key" : "none");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Add {entry.title}
            <Badge variant="secondary" className={TIER_TONE[entry.tier]} title={TIER_HINT[entry.tier]}>
              {TIER_LABEL[entry.tier]}
            </Badge>
          </DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
            {entry.kind === "package" ? (
              <MonitorIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <GlobeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {entry.kind === "package" ? "Runs on this computer" : `Online at ${hostOf(entry.target)}`}
              </p>
              {entry.kind === "remote" && (
                <p className="text-muted-foreground">
                  {probing ? (
                    "Checking the server…"
                  ) : probe?.ok ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2Icon className="size-3.5 text-brand" />
                      {probe.auth.type === "oauth"
                        ? `Reachable. You sign in with ${hostOf(probe.auth.issuer)}.`
                        : probe.auth.type === "header"
                          ? "Reachable. It needs a key."
                          : "Reachable. No sign-in needed."}
                    </span>
                  ) : probe ? (
                    <span className="inline-flex items-start gap-1">
                      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                      Couldn't reach it right now: {probe.error.replace(/\.?\s*$/, ".")} You can still add it.
                    </span>
                  ) : null}
                </p>
              )}
              {(advanced || entry.kind === "package") && (
                <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{entry.target}</p>
              )}
            </div>
          </div>

          {entry.credentials.length > 0 && (
            <div className="grid gap-3">
              {entry.credentials.map((c) => (
                <Field
                  key={c.name}
                  label={c.required ? c.name : `${c.name} (optional)`}
                  htmlFor={`cred-${c.name}`}
                  hint={c.description ?? "Stored encrypted. You won't see it again after saving."}
                >
                  <SecretInput
                    id={`cred-${c.name}`}
                    value={values[c.name] ?? ""}
                    onChange={(v) => setValues((s) => ({ ...s, [c.name]: v }))}
                    placeholder="Paste it here"
                  />
                </Field>
              ))}
            </div>
          )}

          {manualClient && (
            <div className="grid gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm">
                This provider needs a client ID you register with them. Create an app in its developer settings, then
                paste the client ID here.
              </p>
              <ClientFields clientId={clientId} onClientId={setClientId} clientSecret={clientSecret} onClientSecret={setClientSecret} />
            </div>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What it can do</legend>
            <p className="text-xs text-muted-foreground">
              Suggested by the catalog review. Change them if they don't match. pMCPg uses them to decide when to ask
              you first.
            </p>
            {TRUST_LABELS.map((t) => (
              <label key={t.value} className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={trust.includes(t.value)}
                  onCheckedChange={(on) =>
                    setTrust((s) => (on ? [...new Set([...s, t.value])] : s.filter((x) => x !== t.value)))
                  }
                />
                <span>
                  {t.title}
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
              Hide personal details
            </legend>
            <p className="text-xs text-muted-foreground">
              Suggested: {privacyTitle(entry.privacy)}.{" "}
              {current ? `Your AI apps use ${privacyTitle(current)} now.` : ""} A stricter level applies to every AI
              app; pMCPg never lowers it here.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PRIVACY_OPTIONS.map((o) => {
                const lower = current !== undefined && STRICTNESS.indexOf(o.value) < STRICTNESS.indexOf(current);
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={lower}
                    aria-pressed={privacy === o.value}
                    onClick={() => setPrivacy(o.value)}
                    title={o.description}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-sm transition-colors disabled:opacity-40",
                      privacy === o.value ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/50",
                    )}
                  >
                    {o.title}
                    {o.value === entry.privacy && <span className="block text-[10px] text-muted-foreground">suggested</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Advanced>
            <Field label="Short name" htmlFor="cat-id" hint="Used in URLs and tool names.">
              <Input id="cat-id" value={id} onChange={(e) => setId(e.target.value)} className="font-mono" />
            </Field>
          </Advanced>

          <p className="text-xs text-muted-foreground">
            pMCPg pins this server's tools like any other: tools that change later wait for your review.
          </p>
          <ErrorNote error={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={busy}>
            {oauth && <LogInIcon />}
            {busy ? "Adding…" : oauth ? "Add and sign in" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
