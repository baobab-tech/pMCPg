"use client";

import { CheckIcon, FolderUpIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { ComingSoon, EmptyState, ErrorNote, Field, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LearnMore } from "@/components/help/learn-more";
import { LineDiff } from "@/components/line-diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  type Account,
  api,
  errorMessage,
  type LibrarySkill,
  type Listing,
  type SkillFileBody,
  type SkillFileContent,
  type SkillMode,
  type SkillReview,
  type SkillsOverview,
  slugify,
} from "@/lib/api";
import { useApi } from "@/lib/hooks";

/** The web page sends JSON with a 1 MiB limit; base64 grows files by a third. Bigger skills go through the CLI. */
const UPLOAD_LIMIT = 700 * 1024;
const TOO_BIG = "Too large to upload here. Use the command line instead: pmcpg skills add <folder>";

function skillMd(name: string, description: string, body: string): string {
  const desc = description.replace(/\s+/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n${body.trim()}\n`;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Text when the bytes are UTF-8 without NUL bytes, else base64. */
async function fileBody(path: string, file: Blob): Promise<SkillFileBody> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.includes(0)) {
    try {
      return { path, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      // binary
    }
  }
  return { path, base64: toBase64(bytes) };
}

const bodySize = (files: SkillFileBody[]) =>
  files.reduce((n, f) => n + ("text" in f ? f.text.length : f.base64.length), 0);

const sizeWords = (n: number) => (n < 1024 ? `${n} bytes` : `${Math.round(n / 1024)} KB`);

/** New skill from a name, a description and instructions. */
function NewSkill({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("# Steps\n\n1. ");
  const [error, setError] = useState<string>();
  const name = slugify(title).slice(0, 64);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        if (!name) return setError("Give the skill a name.");
        if (!description.trim()) return setError("Say in one sentence when the AI should use it.");
        try {
          await api.post("/skills/library", {
            name,
            files: [{ path: "SKILL.md", text: skillMd(name, description, body) }],
          });
          toast.success(`Added ${name}`);
          onSaved();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field label="Name" htmlFor="skill-name" hint={name ? <>Saved as <code>{name}</code></> : undefined}>
        <Input id="skill-name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting notes" autoFocus />
      </Field>
      <Field
        label="When to use it"
        htmlFor="skill-desc"
        hint="The AI reads this to decide when the skill fits. One or two sentences."
      >
        <Input
          id="skill-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Write meeting notes in our team format, with decisions and owners."
        />
      </Field>
      <Field label="Instructions" htmlFor="skill-body" hint="Markdown. The steps the AI follows once it picks this skill.">
        <Textarea id="skill-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="font-mono text-xs" />
      </Field>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Add skill</Button>
      </div>
    </form>
  );
}

/** Edit SKILL.md as text; remove or add other files. */
function EditSkill({ name, onSaved, onCancel }: { name: string; onSaved: () => void; onCancel: () => void }) {
  const { data, error: loadError } = useApi<{ name: string; files: SkillFileContent[] }>(
    `/skills/library/${encodeURIComponent(name)}`,
  );
  const [md, setMd] = useState<string>();
  const [others, setOthers] = useState<SkillFileBody[]>();
  const [error, setError] = useState<string>();
  const pick = useRef<HTMLInputElement>(null);

  if (data && md === undefined) {
    setMd(data.files.find((f) => f.path === "SKILL.md")?.text ?? "");
    setOthers(
      data.files
        .filter((f) => f.path !== "SKILL.md")
        .map((f) => (f.text !== undefined ? { path: f.path, text: f.text } : { path: f.path, base64: f.base64 ?? "" })),
    );
  }

  async function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    const added = await Promise.all(list.map((f) => fileBody(f.name, f)));
    setOthers((cur) => [...(cur ?? []).filter((x) => !added.some((a) => a.path === x.path)), ...added]);
  }

  if (loadError) return <ErrorNote error={loadError} />;
  if (md === undefined || !others) return <Skeleton className="h-40" />;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        const files: SkillFileBody[] = [{ path: "SKILL.md", text: md }, ...others];
        if (bodySize(files) > UPLOAD_LIMIT) return setError(TOO_BIG);
        try {
          await api.put(`/skills/library/${encodeURIComponent(name)}`, { files });
          toast.success(`Saved ${name}`);
          onSaved();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <Field label="SKILL.md" htmlFor="skill-md" hint="Keep the lines between --- at the top: name and description.">
        <Textarea id="skill-md" value={md} onChange={(e) => setMd(e.target.value)} rows={14} className="font-mono text-xs" />
      </Field>
      <Field label="Other files" hint="Templates, references or scripts the instructions point to.">
        <div className="grid gap-1">
          {others.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {others.map((f) => (
            <div key={f.path} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-sm">
              <span className="font-mono text-xs">{f.path}</span>
              {"base64" in f && <Badge variant="outline">binary</Badge>}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label={`Remove ${f.path}`}
                onClick={() => setOthers(others.filter((x) => x.path !== f.path))}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => pick.current?.click()}>
              <PlusIcon />
              Add files
            </Button>
            <input ref={pick} type="file" multiple hidden onChange={addFiles} />
          </div>
        </div>
      </Field>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}

function LibraryCard({
  skill,
  onEdit,
  onRemove,
}: {
  skill: LibrarySkill;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const scripts = skill.files.filter((f) => !/\.(md|markdown|txt)$/i.test(f.path));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-mono text-sm">{skill.name}</CardTitle>
        <CardDescription>{skill.description}</CardDescription>
        <CardAction className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${skill.name}`} onClick={onEdit}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${skill.name}`} onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {skill.files.length} {skill.files.length === 1 ? "file" : "files"}
          {scripts.length > 0 && ` (${scripts.length} not text)`}
        </span>
        <span>·</span>
        <span>Profiles:</span>
        {skill.profiles.map((p) => (
          <Badge key={p} variant="outline">
            {p}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}

const MODES: { value: SkillMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "text", label: "Text only" },
  { value: "all", label: "All files" },
];

function ServerSkills({ accounts, overview, onChanged }: { accounts: Account[]; overview: SkillsOverview; onChanged: () => void }) {
  async function setMode(a: Account, skills: SkillMode) {
    try {
      await api.patch(`/accounts/${a.id}`, { skills });
      toast.success(
        skills === "off"
          ? `Skills from ${a.id} are off`
          : `Skills from ${a.id} are on. The first set is trusted; later changes wait for your review.`,
      );
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function check(a: Account) {
    try {
      const r = await api.post<{ skills: unknown[] }>(`/skills/sync/${a.id}`);
      toast.success(`${a.id}: ${r.skills.length} skills`);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (accounts.length === 0) return <p className="text-sm text-muted-foreground">Add a server first.</p>;
  return (
    <div className="grid gap-2">
      {accounts.map((a) => {
        const mine = overview.server.filter((s) => s.accountId === a.id);
        return (
          <div key={a.id} className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.label ?? a.id}</span>
              <span className="text-xs text-muted-foreground">{a.serverName}</span>
              <div className="ml-auto flex gap-1" role="radiogroup" aria-label={`Skills from ${a.id}`}>
                {MODES.map((m) => (
                  <Button
                    key={m.value}
                    size="xs"
                    role="radio"
                    aria-checked={a.skills === m.value}
                    variant={a.skills === m.value ? "default" : "outline"}
                    onClick={() => a.skills !== m.value && setMode(a, m.value)}
                  >
                    {m.label}
                  </Button>
                ))}
                {a.skills !== "off" && (
                  <Button size="xs" variant="ghost" aria-label={`Check ${a.id} for skills again`} onClick={() => check(a)}>
                    <RefreshCwIcon />
                  </Button>
                )}
              </div>
            </div>
            {a.skills === "all" && (
              <p className="text-xs text-destructive">
                Scripts included. Your AI app may run them on this computer, so approve only servers you trust.
              </p>
            )}
            {a.skills !== "off" &&
              (mine.length === 0 ? (
                <p className="text-xs text-muted-foreground">This server publishes no skills, or none have been fetched yet.</p>
              ) : (
                <ul className="grid gap-1">
                  {mine.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono">{s.name}</span>
                      {s.status === "held" && <Badge variant="destructive">Waiting for review</Badge>}
                      {s.status === "rejected" && <Badge variant="secondary">Rejected</Badge>}
                      {!s.served && s.status === "active" && <Badge variant="secondary">Not served</Badge>}
                      <span className="truncate text-muted-foreground">{s.description}</span>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function FileChanges({ r }: { r: SkillReview }) {
  const before = new Map((r.pinnedFiles ?? []).map((f) => [f.path, f.digest]));
  const rows: { sign: "+" | "~" | "-"; path: string; size?: number }[] = [];
  for (const f of r.currentFiles) {
    const was = before.get(f.path);
    if (was === undefined) rows.push({ sign: "+", path: f.path, size: f.size });
    else if (was !== f.digest) rows.push({ sign: "~", path: f.path, size: f.size });
    before.delete(f.path);
  }
  for (const p of before.keys()) rows.push({ sign: "-", path: p });
  if (!rows.length) return null;
  return (
    <ul className="grid gap-0.5 font-mono text-xs">
      {rows.map((x) => (
        <li key={x.path} className={x.sign === "-" ? "text-destructive" : x.sign === "+" ? "text-brand" : ""}>
          {x.sign} {x.path}
          {x.size !== undefined && <span className="text-muted-foreground"> ({sizeWords(x.size)})</span>}
        </li>
      ))}
    </ul>
  );
}

function Reviews({ items, onChanged }: { items: SkillReview[]; onChanged: () => void }) {
  async function decide(r: SkillReview, decision: "approve" | "reject") {
    try {
      await api.post("/skills/reviews", { account: r.accountId, path: r.path, decision });
      toast.success(decision === "approve" ? "Approved: AI apps get this version" : "Rejected: AI apps keep the approved version, if any");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <div className="grid gap-3">
      {items.map((r) => (
        <Card key={`${r.accountId}/${r.path}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-sm">
              {r.accountId}/{r.path}
              <Badge variant={r.reason === "new" ? "secondary" : "destructive"}>{r.reason === "new" ? "New skill" : "Changed"}</Badge>
              {r.status === "rejected" && <Badge variant="outline">Rejected</Badge>}
            </CardTitle>
            <CardDescription>Written by the server, not by you. Read it before you approve.</CardDescription>
            {r.status === "pending" && (
              <CardAction className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => decide(r, "reject")}>
                  <XIcon />
                  Reject
                </Button>
                <Button size="sm" onClick={() => decide(r, "approve")}>
                  <CheckIcon />
                  Approve
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            <FileChanges r={r} />
            <LineDiff before={r.pinnedSkillMd ?? ""} after={r.currentSkillMd} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SkillsPage() {
  const { data, error, reload } = useApi<SkillsOverview>("/skills", { pollMs: 10000 });
  const accounts = useApi<Account[]>("/accounts");
  const reviews = useApi<Listing<SkillReview>>("/skills/reviews", { pollMs: 10000 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [removing, setRemoving] = useState<LibrarySkill>();
  const folder = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void reload();
    void accounts.reload();
    void reviews.reload();
  };

  async function uploadFolder(e: ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!list.length) return;
    const top = (list[0]?.webkitRelativePath ?? "").split("/")[0] ?? "";
    const files = await Promise.all(
      list
        .map((f) => ({ f, path: f.webkitRelativePath.split("/").slice(1).join("/") }))
        .filter(({ path }) => path && !path.split("/").some((s) => s.startsWith(".")))
        .map(({ f, path }) => fileBody(path, f)),
    );
    if (!files.some((f) => f.path === "SKILL.md")) return toast.error(`${top} has no SKILL.md at its top level.`);
    if (bodySize(files) > UPLOAD_LIMIT) return toast.error(TOO_BIG);
    const name = slugify(top).slice(0, 64);
    try {
      const exists = data?.library.some((k) => k.name === name);
      if (exists) await api.put(`/skills/library/${name}`, { files });
      else await api.post("/skills/library", { name, files });
      toast.success(exists ? `Replaced ${name}` : `Added ${name}`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const pending = (reviews.data?.items ?? []).filter((r) => r.status === "pending");

  return (
    <>
      <PageHeader
        title="Skills"
        description={
          <>
            Instructions your AI apps can follow, such as how to write release notes or file an expense. Keep each skill here
            once and give every profile the ones it needs. <LearnMore slug="skills" />
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => folder.current?.click()}>
              <FolderUpIcon />
              Upload a folder
            </Button>
            <input
              ref={folder}
              type="file"
              hidden
              multiple
              onChange={uploadFolder}
              {...({ webkitdirectory: "" } as Record<string, string>)}
            />
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New skill
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />
      {!data ? (
        <Skeleton className="h-48" />
      ) : !data.available ? (
        <ComingSoon title="Skills">Keep instructions for your AI apps here and choose which profiles get them.</ComingSoon>
      ) : (
        <div className="grid gap-8">
          {pending.length > 0 && (
            <section className="grid gap-3">
              <h2 className="font-heading text-lg font-medium">Waiting for review ({pending.length})</h2>
              <p className="text-sm text-muted-foreground">
                A server added or changed a skill. AI apps keep the version you approved until you decide.
              </p>
              <Reviews items={pending} onChanged={refresh} />
            </section>
          )}

          <section className="grid gap-3">
            <h2 className="font-heading text-lg font-medium">Your skills ({data.library.length})</h2>
            {data.library.length === 0 ? (
              <EmptyState
                title="No skills yet"
                action={
                  <Button onClick={() => setCreating(true)}>
                    <PlusIcon />
                    New skill
                  </Button>
                }
              >
                Write one here, or upload a folder that has a SKILL.md. The “All” profile gets every skill; pick others in
                Profiles.
              </EmptyState>
            ) : (
              <div className="grid gap-2">
                {data.library.map((k) => (
                  <LibraryCard key={k.name} skill={k} onEdit={() => setEditing(k.name)} onRemove={() => setRemoving(k)} />
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="font-heading text-lg font-medium">Skills from your servers</h2>
            <p className="text-sm text-muted-foreground">
              Some servers publish skills for their own tools. They are off until you turn them on. “Text only” keeps
              instructions and drops scripts.
            </p>
            <ServerSkills accounts={accounts.data ?? []} overview={data} onChanged={refresh} />
          </section>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>A name, when to use it, and the steps. You can add files after.</DialogDescription>
          </DialogHeader>
          {creating && (
            <NewSkill
              onCancel={() => setCreating(false)}
              onSaved={() => {
                setCreating(false);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editing}</DialogTitle>
            <DialogDescription>AI apps get the new version as soon as you save.</DialogDescription>
          </DialogHeader>
          {editing && (
            <EditSkill
              key={editing}
              name={editing}
              onCancel={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Remove ${removing?.name}?`}
        description="It is deleted from this computer and from every profile."
        onConfirm={async (password) => {
          if (!removing) return;
          await api.del(`/skills/library/${removing.name}`, { password });
          toast.success(`Removed ${removing.name}`);
          setRemoving(undefined);
          refresh();
        }}
      />
    </>
  );
}
