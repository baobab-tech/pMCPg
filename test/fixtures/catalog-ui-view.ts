// A CatalogView for UI API tests: the sample catalog plus a remote server signed in with a key header,
// a baobab-built entry and an mcpb-only entry the gateway cannot run directly.
import { CatalogFile, type CatalogView } from "../../src/catalog/schema.ts";
import { sampleCatalog } from "./catalog-sample.ts";

export const KEYED_ENTRY = "com.example/notes";
export const BUILT_ENTRY = "io.pmcpg/files";
export const BUNDLE_ENTRY = "com.example/bundle";

export function uiCatalogView(over: Partial<CatalogView> = {}): CatalogView {
  const base = sampleCatalog();
  const file = CatalogFile.parse({
    ...base,
    servers: [
      ...(base.servers ?? []),
      {
        name: KEYED_ENTRY,
        title: "Notes",
        description: "Team notes over HTTP.",
        version: "2.0.0",
        remotes: [
          {
            type: "streamable-http",
            url: "https://notes.example.com/mcp",
            headers: [{ name: "Authorization", isRequired: true, isSecret: true }],
          },
        ],
        _meta: {
          "io.pmcpg/curation": {
            tier: "approved",
            reviewedAt: "2026-11-03",
            reviewedBy: "baobab-tech",
            auth: { type: "header", credentials: ["Authorization"] },
            trust: ["private-data"],
            privacy: "strict",
            audience: ["general", "social-impact"],
            categories: ["notes"],
          },
        },
      },
      {
        name: BUILT_ENTRY,
        title: "Files",
        description: "Read files in one folder.",
        version: "1.0.0",
        packages: [{ registryType: "npm", identifier: "@pmcpg/files", version: "1.0.0" }],
        _meta: {
          "io.pmcpg/curation": {
            tier: "baobab-built",
            reviewedAt: "2026-11-04",
            reviewedBy: "baobab-tech",
            auth: { type: "none" },
            trust: ["local"],
            audience: ["general"],
            categories: ["files"],
          },
        },
      },
      {
        name: BUNDLE_ENTRY,
        description: "Ships as a bundle.",
        version: "1.0.0",
        packages: [
          {
            registryType: "mcpb",
            identifier: "https://example.com/bundle.mcpb",
            version: "1.0.0",
            fileSha256: "b".repeat(64),
          },
        ],
        _meta: {
          "io.pmcpg/curation": {
            tier: "community",
            reviewedAt: "2026-11-05",
            reviewedBy: "baobab-tech",
            auth: { type: "none" },
          },
        },
      },
    ],
  });
  return {
    entries: file.servers,
    presets: file.presets,
    serial: file.serial,
    fetchedAt: "2026-11-20T10:00:00.000Z",
    source: "cache",
    ...over,
  };
}
