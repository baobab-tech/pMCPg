// Types and labels for /catalog/. The prebuild check has already validated catalog.json against
// src/catalog/schema.ts; these types cover the fields the page shows, so the Next build does not compile
// the gateway's sources. The loader is in catalog-load.ts (server only).

export const CURATION_KEY = "io.pmcpg/curation";
export const CATALOG_PATH = "/catalog/v1/catalog.json";

export type Tier = "baobab-built" | "approved" | "community";
export type Trust = "local" | "private-data" | "external-content" | "can-send";

export interface CatalogEntry {
  name: string;
  title?: string;
  description: string;
  version: string;
  websiteUrl?: string;
  repository?: { url: string };
  packages: {
    registryType: "npm" | "pypi" | "oci" | "mcpb";
    identifier: string;
    version: string;
    packageArguments: ({ type: "positional"; value: string } | { type: "named"; name: string; value?: string })[];
    environmentVariables: { name: string; isSecret: boolean; isRequired: boolean }[];
  }[];
  remotes: { type: string; url: string; headers: { name: string }[] }[];
  _meta: {
    [CURATION_KEY]: {
      tier: Tier;
      reviewedAt: string;
      reviewedBy: string;
      source?: string;
      auth: { type: "none" | "oauth" | "header"; registration?: string; credentials: string[] };
      trust: Trust[];
      privacy: "off" | "standard" | "strict";
      audience: string[];
      categories: string[];
      samplePrompt?: string;
    };
  };
}

export interface CatalogPreset {
  id: string;
  name: string;
  description: string;
  audience: string[];
  servers: string[];
  privacy: "off" | "standard" | "strict";
  approvals: "open" | "balanced" | "careful";
}

export interface Catalog {
  serial: number;
  generatedAt: string;
  servers: CatalogEntry[];
  presets: CatalogPreset[];
}

export const cur = (e: CatalogEntry) => e._meta[CURATION_KEY];

export const TIER_LABEL: Record<Tier, string> = {
  "baobab-built": "Built by Baobab",
  approved: "Approved",
  community: "Community",
};

export const TRUST_LABEL: Record<Trust, string> = {
  local: "Runs on your computer",
  "private-data": "Reads private data",
  "external-content": "Reads outside content",
  "can-send": "Can send or change things",
};

export const APPROVALS_LABEL: Record<CatalogPreset["approvals"], string> = {
  open: "Open: no approvals",
  balanced: "Balanced: asks before deleting, or sending after reading outside content",
  careful: "Careful: asks before any change or anything leaves",
};

/** Words for slugs used in audience and categories. Unknown slugs show as-is with dashes as spaces. */
const WORDS: Record<string, string> = {
  general: "Everyone",
  "social-impact": "Social impact",
  developers: "Developers",
  research: "Research",
  "project-management": "Projects",
  docs: "Docs and notes",
  "dev-tools": "Developer tools",
  payments: "Payments",
  crm: "CRM and support",
  "open-data": "Open data",
  design: "Design",
  files: "Files",
  communication: "Communication",
  automation: "Automation",
  databases: "Databases",
  hosting: "Hosting",
  meetings: "Meetings",
  search: "Search",
  "ai-models": "AI models",
  websites: "Websites",
};
export const words = (slug: string) => WORDS[slug] ?? slug.replace(/-/g, " ");

/** How to add the entry in pMCPg: a URL to paste, or a command for "On this computer". */
export function addTarget(e: CatalogEntry): { kind: "url" | "command"; text: string } | undefined {
  const r = e.remotes.find((x) => x.type === "streamable-http") ?? e.remotes[0];
  if (r) return { kind: "url", text: r.url };
  const p = e.packages[0];
  if (!p) return undefined;
  const args = p.packageArguments.map((a) =>
    a.type === "positional" ? a.value : a.value === undefined ? a.name : `${a.name}=${a.value}`,
  );
  const run: Record<string, string> = {
    npm: `npx -y ${p.identifier}@${p.version}`,
    pypi: `uvx ${p.identifier}==${p.version}`,
    oci: `docker run -i --rm ${p.identifier}:${p.version}`,
    mcpb: p.identifier,
  };
  return { kind: "command", text: [run[p.registryType], ...args].join(" ") };
}
