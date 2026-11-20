"use client";

import { CableIcon, LightbulbIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ChoiceCards, ErrorNote, Field, PageHeader } from "@/components/common";
import { AppLogo, type LogoId } from "@/components/app-logos";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ForgetMaskedButton } from "@/components/forget-masked";
import {
  BetaBadge,
  MASKING_CAUTION,
  PRESET_OPTIONS,
  PRIVACY_OPTIONS,
  presetTitle,
  privacyTitle,
} from "@/components/profile-options";
import { Advanced } from "@/components/server-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { type Account, api, errorMessage, type Preset, type Privacy, type Profile, slugify } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { LearnMore } from "@/components/help/learn-more";

function ProfileForm({
  profile,
  accounts,
  onSaved,
  onCancel,
}: {
  profile?: Profile;
  accounts: Account[];
  onSaved: (p: Profile) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [picked, setPicked] = useState<string[]>(profile?.accounts ?? []);
  const [privacy, setPrivacy] = useState<Privacy>(profile?.privacy ?? "standard");
  const [preset, setPreset] = useState<Preset>(profile?.preset ?? "balanced");
  const [readOnly, setReadOnly] = useState(profile?.readOnly ?? false);
  const [error, setError] = useState<string>();
  const id = profile?.id ?? slugify(name);

  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        if (!id) return setError("Give the profile a name.");
        const payload = {
          name: name.trim(),
          privacy,
          preset,
          readOnly,
          ...(profile?.builtIn ? {} : { accounts: picked }),
        };
        try {
          const saved = profile
            ? await api.patch<Profile>(`/profiles/${profile.id}`, payload)
            : await api.post<Profile>("/profiles", { id, ...payload });
          onSaved(saved);
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field label="Name" htmlFor="profile-name" hint={!profile && id ? <>Its address ends in <code>/p/{id}/mcp</code></> : undefined}>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Briefing" autoFocus />
      </Field>

      {profile?.builtIn ? (
        <p className="text-sm text-muted-foreground">“All” always holds all your MCPs.</p>
      ) : (
        <Field label="MCPs in this profile" hint="An AI app connected to this profile sees only these tools.">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to add yet. Add a server first.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
                  <Checkbox
                    checked={picked.includes(a.id)}
                    onCheckedChange={(c) => setPicked(c ? [...picked, a.id] : picked.filter((x) => x !== a.id))}
                  />
                  <span className="font-medium">{a.id}</span>
                  <span className="truncate text-xs text-muted-foreground">{a.label ?? a.serverName}</span>
                </label>
              ))}
            </div>
          )}
        </Field>
      )}

      <Field label="Privacy" info={<BetaBadge />} hint={MASKING_CAUTION}>
        <ChoiceCards value={privacy} onChange={setPrivacy} columns={3} options={PRIVACY_OPTIONS} />
      </Field>
      <Field label="Safety">
        <ChoiceCards value={preset} onChange={setPreset} columns={3} options={PRESET_OPTIONS} />
      </Field>
      <Advanced>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={readOnly} onCheckedChange={setReadOnly} />
          Read-only: hide tools that change or send data
        </label>
        {!!profile?.customRules && (
          <p className="text-xs text-muted-foreground">
            This profile has {profile.customRules} custom rule{profile.customRules > 1 ? "s" : ""} in config.yaml. They run before the
            preset.
          </p>
        )}
      </Advanced>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{profile ? "Save" : "Create profile"}</Button>
      </div>
    </form>
  );
}

const EXAMPLES: { name: string; why: string; mcps: string[]; app: LogoId; appLabel: string; safety: string }[] = [
  {
    name: "Research",
    why: "Look things up and keep notes.",
    mcps: ["Web search", "Papers (arXiv)", "Notes"],
    app: "claude-desktop",
    appLabel: "Claude Desktop",
    safety: "Read-only on: nothing gets sent or deleted.",
  },
  {
    name: "Communications",
    why: "Email, chat and calendar, kept apart from code.",
    mcps: ["Gmail (work login)", "Slack", "Google Calendar"],
    app: "chatgpt",
    appLabel: "ChatGPT Desktop",
    safety: "Safety on Careful: you approve each email or message before it goes out.",
  },
  {
    name: "Project A",
    why: "Only what one project needs.",
    mcps: ["GitHub (one repo)", "Linear (one team)", "Drive (one folder)"],
    app: "cursor",
    appLabel: "Cursor",
    safety: "Safety on Balanced: asks you before risky actions.",
  },
];

/** Made-up examples of splitting MCPs into profiles, and which AI app uses which. */
function OrganizeHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How to organize your MCPs and profiles</DialogTitle>
          <DialogDescription>
            Group MCPs by what you do with them, then give each AI app one profile. An app only sees the tools in its
            profile, so a coding app never reads your email. These are examples; use your own.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {EXAMPLES.map((e) => (
            <div key={e.name} className="grid content-start gap-2 rounded-xl border p-3">
              <p className="font-medium">{e.name}</p>
              <p className="text-xs text-muted-foreground">{e.why}</p>
              <ul className="grid gap-1">
                {e.mcps.map((m) => (
                  <li key={m} className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                    {m}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{e.safety}</p>
              <div className="mt-1 flex items-center gap-2 border-t pt-2 text-xs">
                <AppLogo app={e.app} size="sm" />
                <span>
                  Used by <b className="font-medium">{e.appLabel}</b>
                </span>
              </div>
            </div>
          ))}
        </div>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          <li>The same MCP can be in several profiles.</li>
          <li>Two logins to one server (work and personal Gmail) can go in different profiles.</li>
          <li>“All” holds everything. Start there, and make smaller profiles when an app needs less.</li>
          <li>To switch an app to another profile, open Connect your AI app and pick the profile.</li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfilesPage() {
  const { data, error, reload } = useApi<Profile[]>("/profiles");
  const accounts = useApi<Account[]>("/accounts");
  const [editing, setEditing] = useState<Profile | "new">();
  const [removing, setRemoving] = useState<Profile>();
  const [help, setHelp] = useState(false);

  return (
    <>
      <PageHeader
        title="Profiles"
        description={
          <>
            A profile is a set of your MCPs (servers and their logins) with its own address and token. Give each AI app
            the profile it needs, and nothing more. <LearnMore slug="profiles" />
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setHelp(true)}>
              <LightbulbIcon />
              How to organize
            </Button>
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              New profile
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid gap-3">
          {data.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  {p.builtIn && <Badge variant="secondary">Built in</Badge>}
                </CardTitle>
                <CardDescription className="font-mono text-xs">{p.url}</CardDescription>
                <CardAction className="flex gap-1">
                  <Link href={`/connect/?profile=${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <CableIcon />
                    Connect
                  </Link>
                  <ForgetMaskedButton profile={p} variant="ghost" compact />
                  <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(p)}>
                    <PencilIcon />
                  </Button>
                  {!p.builtIn && (
                    <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRemoving(p)}>
                      <Trash2Icon />
                    </Button>
                  )}
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline">Privacy: {privacyTitle(p.privacy)}</Badge>
                <Badge variant="outline">Safety: {presetTitle(p.preset)}</Badge>
                {p.readOnly && <Badge variant="outline">Read-only</Badge>}
                <span className="text-muted-foreground">
                  {p.builtIn
                    ? "All your MCPs"
                    : p.accounts.length
                      ? p.accounts.join(", ")
                      : "Empty: edit it to add MCPs"}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New profile" : `Edit ${editing?.name}`}</DialogTitle>
            <DialogDescription>Plain choices first; details under Advanced.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ProfileForm
              key={editing === "new" ? "new" : editing.id}
              profile={editing === "new" ? undefined : editing}
              accounts={accounts.data ?? []}
              onCancel={() => setEditing(undefined)}
              onSaved={(p) => {
                toast.success(`Saved ${p.name}`);
                setEditing(undefined);
                void reload();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <OrganizeHelp open={help} onOpenChange={setHelp} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Remove ${removing?.name}?`}
        description="AI apps using this profile's address stop working. Its servers and logins stay."
        onConfirm={async (password) => {
          if (!removing) return;
          await api.del(`/profiles/${removing.id}`, { password });
          toast.success(`Removed ${removing.name}`);
          setRemoving(undefined);
          void reload();
        }}
      />
    </>
  );
}
