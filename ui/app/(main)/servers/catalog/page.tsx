"use client";

import { ArrowLeftIcon, CheckIcon, LayersIcon, PlusIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { CatalogAddDialog } from "@/components/catalog/add-dialog";
import { EntryCard, TierBadge } from "@/components/catalog/entry-card";
import { formatDate, SIMPLE_TIERS, SOURCE_LABEL, slugTitle } from "@/components/catalog/labels";
import { useCatalog } from "@/components/catalog/use-catalog";
import { presetTitle, privacyTitle } from "@/components/profile-options";
import { SignInDialog } from "@/components/signin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useView } from "@/components/view";
import { api, type CatalogEntry, type CatalogPreset, type CatalogResponse, errorMessage, type Server } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Available = Extract<CatalogEntry, { available: true }>;

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function SourceLine({ data }: { data: CatalogResponse }) {
  const { advanced } = useView();
  const date = formatDate(data.fetchedAt);
  return (
    <p className="text-xs text-muted-foreground" data-testid="catalog-source">
      {SOURCE_LABEL[data.source]}
      {date ? ` · updated ${date}` : ""}
      {advanced && data.serial ? ` · serial ${data.serial}` : ""}
    </p>
  );
}

function PresetCard({
  preset,
  entries,
  servers,
  onAdd,
  onProfile,
}: {
  preset: CatalogPreset;
  entries: CatalogEntry[];
  servers: Server[];
  onAdd: (e: Available) => void;
  onProfile: () => void;
}) {
  const { advanced } = useView();
  const items = preset.servers.map((n) => entries.find((e) => e.name === n)).filter((e): e is CatalogEntry => !!e);
  const allAdded = items.length > 0 && items.every((e) => e.addedAs);
  const [busy, setBusy] = useState(false);

  async function makeProfile() {
    const accounts = items.flatMap((e) => servers.find((s) => s.id === e.addedAs)?.accounts ?? []);
    setBusy(true);
    try {
      await api.post("/profiles", {
        id: preset.id,
        name: preset.name,
        accounts,
        privacy: preset.privacy,
        preset: preset.approvals,
      });
      toast.success(`Profile ${preset.name} created`);
      onProfile();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
      <div>
        <p className="flex items-center gap-2 font-medium">
          <LayersIcon className="size-4 text-muted-foreground" />
          {preset.name}
        </p>
        <p className="text-muted-foreground">{preset.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Hide personal details: {privacyTitle(preset.privacy)} · Ask me before: {presetTitle(preset.approvals)}
        </p>
      </div>
      <ul className="grid gap-1.5">
        {items.map((e) => (
          <li key={e.name} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{e.title}</span>
            <TierBadge entry={e} />
            {e.addedAs ? (
              <Badge variant="secondary" className="gap-1 bg-brand/15 text-brand">
                <CheckIcon className="size-3" />
                Added
              </Badge>
            ) : (
              <Button size="xs" variant="outline" disabled={!e.available} onClick={() => e.available && onAdd(e)}>
                <PlusIcon />
                Add
              </Button>
            )}
          </li>
        ))}
      </ul>
      {advanced && (
        <Button size="sm" variant="outline" className="w-fit" disabled={!allAdded || busy} onClick={makeProfile}>
          {allAdded ? "Create a profile from this preset" : "Add every server to create a profile"}
        </Button>
      )}
    </div>
  );
}

export default function CatalogPage() {
  const { advanced } = useView();
  const cat = useCatalog();
  const servers = useApi<Server[]>("/servers");
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState("");
  const [category, setCategory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState<Available>();
  const [signIn, setSignIn] = useState<string>();

  const data = cat.data;
  const everyTier = advanced || showAll;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter(
      (e) =>
        (everyTier || SIMPLE_TIERS.includes(e.tier)) &&
        (!audience || e.audience.includes(audience)) &&
        (!category || e.categories.includes(category)) &&
        (!q || `${e.title} ${e.name} ${e.description} ${e.categories.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [data, query, audience, category, everyTier]);
  const audiences = [...new Set((data?.entries ?? []).flatMap((e) => e.audience))].sort();
  const categories = [...new Set((data?.entries ?? []).flatMap((e) => e.categories))].sort();
  const hidden = (data?.entries.length ?? 0) - (data?.entries.filter((e) => SIMPLE_TIERS.includes(e.tier)).length ?? 0);

  const reload = () => {
    void cat.reload();
    void servers.reload();
  };

  return (
    <>
      <PageHeader
        title="Catalog"
        description="Servers and presets reviewed by the pMCPg team. Pick one, confirm what it can do, and sign in."
        actions={
          <>
            <Link href="/servers/" className={buttonVariants({ variant: "ghost" })}>
              <ArrowLeftIcon />
              {advanced ? "Servers" : "Connections"}
            </Link>
            <Button
              variant="outline"
              onClick={() => void cat.refresh()}
              disabled={cat.refreshing || data?.enabled === false}
              title="Contacts pmcpg.io to get the latest signed catalog"
            >
              <RefreshCwIcon className={cn(cat.refreshing && "animate-spin")} />
              {cat.refreshing ? "Checking pmcpg.io…" : "Refresh"}
            </Button>
          </>
        }
      />
      <ErrorNote error={cat.error ?? cat.refreshError} />
      {!data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <SourceLine data={data} />
            <p className="text-xs text-muted-foreground">
              Refresh contacts pmcpg.io. Nothing else here goes online, and the file is checked against pMCPg's signing
              key before use.
            </p>
          </div>
          {data.enabled === false && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              The catalog is turned off in config.yaml, so Refresh is off. The list below is the copy already on this
              computer.
            </p>
          )}
          {data.error && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm" role="alert">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                <span className="font-medium">Couldn't update the catalog.</span> {data.error} Showing the{" "}
                {data.source === "snapshot" ? "copy built into pMCPg" : "saved copy"}.
              </span>
            </div>
          )}

          <Tabs defaultValue="servers">
            <TabsList>
              <TabsTrigger value="servers">
                Servers ({data.entries.filter((e) => everyTier || SIMPLE_TIERS.includes(e.tier)).length})
              </TabsTrigger>
              <TabsTrigger value="presets">Presets ({data.presets.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="servers" className="grid gap-4 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <SearchIcon className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or what it does"
                    className="pl-8"
                    aria-label="Search the catalog"
                  />
                </div>
                <select className={selectClass} value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Audience">
                  <option value="">Everyone</option>
                  {audiences.map((a) => (
                    <option key={a} value={a}>
                      {slugTitle(a)}
                    </option>
                  ))}
                </select>
                <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {slugTitle(c)}
                    </option>
                  ))}
                </select>
                {!advanced && hidden > 0 && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch checked={showAll} onCheckedChange={setShowAll} />
                    Show community ({hidden})
                  </label>
                )}
              </div>
              {data.entries.length === 0 ? (
                <EmptyState title="The catalog is empty">
                  {data.enabled === false
                    ? "Turn the catalog on in config.yaml to load it."
                    : "Press Refresh to get the list from pmcpg.io. Until then, add a server by its address on the Servers page."}
                </EmptyState>
              ) : shown.length === 0 ? (
                <EmptyState title="Nothing matches">Try other words or clear the filters.</EmptyState>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {shown.map((e) => (
                    <EntryCard key={e.name} entry={e} onAdd={() => e.available && setAdding(e)} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="presets" className="grid gap-3 pt-2">
              <p className="text-sm text-muted-foreground">
                A preset is a set of servers for one kind of work, with privacy and approval levels to match.
              </p>
              {data.presets.length === 0 ? (
                <EmptyState title="No presets yet" />
              ) : (
                data.presets.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    entries={data.entries}
                    servers={servers.data ?? []}
                    onAdd={setAdding}
                    onProfile={reload}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {adding && (
        <CatalogAddDialog
          entry={adding}
          open={!!adding}
          onOpenChange={(o) => !o && setAdding(undefined)}
          onAdded={(server, auth) => {
            setAdding(undefined);
            reload();
            toast.success(`Added ${server.name}`);
            if (auth === "oauth" && server.accounts[0]) setSignIn(server.accounts[0]);
          }}
        />
      )}
      {signIn && (
        <SignInDialog accountId={signIn} open={!!signIn} onOpenChange={(o) => !o && setSignIn(undefined)} onSignedIn={reload} />
      )}
    </>
  );
}
