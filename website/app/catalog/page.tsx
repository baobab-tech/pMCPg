import { ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CatalogBrowser, TierBadge } from "@/components/catalog/catalog-browser";
import { APPROVALS_LABEL, CATALOG_PATH, cur, words } from "@/lib/catalog";
import { loadCatalog } from "@/lib/catalog-load";
import { GITHUB } from "@/lib/site";

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "MCP servers reviewed by Baobab Tech, with sign-in type, trust labels and presets for social impact organizations.",
};

const PRIVACY: Record<string, string> = { off: "No masking", standard: "Standard masking", strict: "Strict masking" };

export default function CatalogPage() {
  const catalog = loadCatalog();
  const byName = new Map(catalog.servers.map((e) => [e.name, e]));
  const anchor = (name: string) => `#${name.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-14">
      <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-bold tracking-tight">Catalog</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        MCP servers we read the docs for, with how each one signs in and what it can reach. Copy a server&apos;s
        address into pMCPg to add it: see{" "}
        <Link className="text-brand underline underline-offset-3" href="/help/add-server-by-url/">
          Add a server by URL
        </Link>
        .
      </p>

      <div className="mt-6 grid gap-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
        <p className="flex items-start gap-2">
          <TierBadge tier="baobab-built" />
          <span className="text-muted-foreground">Made and run by Baobab Tech.</span>
        </p>
        <p className="flex items-start gap-2">
          <TierBadge tier="approved" />
          <span className="text-muted-foreground">Run by the vendor; URL and sign-in checked on their docs.</span>
        </p>
        <p className="flex items-start gap-2">
          <TierBadge tier="community" />
          <span className="text-muted-foreground">Reviewed, run by someone else.</span>
        </p>
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Presets</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Profile templates for social impact organizations. Each one suggests servers, a masking level and an
          approval preset. Use the servers your organization already has; these are examples.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {catalog.presets.map((p) => (
            <li key={p.id} id={`preset-${p.id}`} className="scroll-mt-20 rounded-xl border bg-card p-4">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
                  <ShieldCheckIcon className="size-3" /> {PRIVACY[p.privacy]}
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5">{APPROVALS_LABEL[p.approvals]}</span>
              </p>
              <p className="mt-3 text-sm">
                {p.servers.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ", "}
                    <a className="text-brand underline-offset-3 hover:underline" href={anchor(s)}>
                      {byName.get(s)?.title ?? s}
                    </a>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          To use one: add its servers, then create a profile with that privacy level and approval preset. See{" "}
          <Link className="text-brand underline underline-offset-3" href="/help/profiles/">
            Profiles
          </Link>
          .
        </p>
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-xl font-semibold">Servers</h2>
        <CatalogBrowser entries={catalog.servers} />
      </section>

      <section className="mt-12 text-sm text-muted-foreground">
        <p>
          Serial {catalog.serial}, built {catalog.generatedAt.slice(0, 10)}. The signed file is at{" "}
          <a className="font-mono text-foreground hover:text-brand" href={CATALOG_PATH}>
            {CATALOG_PATH}
          </a>
          . Audiences in this list: {[...new Set(catalog.servers.flatMap((e) => cur(e).audience))].map(words).join(", ")}.
        </p>
        <p className="mt-2">
          Missing a server?{" "}
          <a
            className="text-brand underline underline-offset-3"
            href={`${GITHUB}/blob/main/docs/catalog.md#propose-a-server`}
          >
            Propose it by pull request
          </a>
          .
        </p>
      </section>
    </main>
  );
}
