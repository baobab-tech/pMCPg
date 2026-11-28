import type { CatalogEntry, CatalogResponse, CatalogTier, TrustLabel } from "@/lib/api";

// Plain words for catalog fields. Trust labels are the catalog's suggestion; the user confirms them.

export const TIER_LABEL: Record<CatalogTier, string> = {
  "baobab-built": "Built by Baobab",
  approved: "Approved",
  community: "Community",
};

export const TIER_HINT: Record<CatalogTier, string> = {
  "baobab-built": "Made and maintained by the pMCPg team.",
  approved: "Reviewed by the pMCPg team.",
  community: "Listed by the community. Checked for the basics only.",
};

export const TIER_TONE: Record<CatalogTier, string> = {
  "baobab-built": "bg-brand/15 text-brand",
  approved: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  community: "bg-muted text-muted-foreground",
};

/** Simple view shows these tiers unless the user asks for all. */
export const SIMPLE_TIERS: CatalogTier[] = ["baobab-built", "approved"];

export const TRUST_LABELS: { value: TrustLabel; title: string; hint: string }[] = [
  { value: "private-data", title: "Reads private data", hint: "Your email, files, records or accounts." },
  { value: "can-send", title: "Can send messages", hint: "Sends, posts or changes things outside pMCPg." },
  { value: "external-content", title: "Reads outside content", hint: "Web pages or messages written by others." },
  { value: "local", title: "Works on this computer", hint: "Files or programs on this machine." },
];

export const trustTitle = (t: TrustLabel) => TRUST_LABELS.find((x) => x.value === t)?.title ?? t;

export function signInLabel(e: CatalogEntry): string {
  if (e.auth.type === "oauth") return "Sign in with your account";
  if (e.auth.type === "header") return "Needs a key";
  if (e.available && e.credentials.length) return "Needs a key";
  return "No sign-in";
}

export function whereLabel(e: CatalogEntry): string {
  if (!e.available) return "Can't be added here";
  return e.kind === "package" ? "Runs on this computer" : "Online";
}

export const SOURCE_LABEL: Record<CatalogResponse["source"], string> = {
  network: "Fresh from pmcpg.io",
  cache: "Saved copy",
  snapshot: "Copy built into pMCPg",
};

/** "audience-slug" → "Audience slug". */
export const slugTitle = (s: string) => {
  const t = s.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
