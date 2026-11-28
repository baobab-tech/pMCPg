// A small valid catalog: one remote OAuth server, one npm package with a secret, one preset.
import type { z } from "zod";
import type { CatalogFile } from "../../src/catalog/schema.ts";
import { signWithTestKey } from "./catalog-keys.ts";

type CatalogInput = z.input<typeof CatalogFile>;

export function sampleCatalog(over: Partial<CatalogInput> = {}): CatalogInput {
  return {
    format: 1,
    serial: 7,
    generatedAt: "2026-11-01T00:00:00Z",
    expires: "2027-01-01T00:00:00Z",
    servers: [
      {
        name: "app.linear/linear",
        title: "Linear",
        description: "Issues and projects in Linear.",
        version: "1.0.0",
        websiteUrl: "https://linear.app",
        remotes: [{ type: "streamable-http", url: "https://mcp.linear.app/mcp" }],
        _meta: {
          "io.pmcpg/curation": {
            tier: "approved",
            reviewedAt: "2026-11-01",
            reviewedBy: "baobab-tech",
            auth: { type: "oauth", registration: "dcr" },
            trust: ["private-data", "can-send"],
            privacy: "standard",
            audience: ["general"],
            categories: ["project-management"],
            toolsHash: "a".repeat(64),
          },
        },
      },
      {
        name: "io.github.example/grants-search",
        description: "Search open grant data.",
        version: "0.4.2",
        packages: [
          {
            registryType: "npm",
            identifier: "@example/grants-mcp",
            version: "0.4.2",
            packageArguments: [{ type: "named", name: "--read-only" }],
            environmentVariables: [
              { name: "GRANTS_API_KEY", isSecret: true, isRequired: true },
              { name: "GRANTS_REGION", default: "ca" },
            ],
          },
        ],
        _meta: {
          "io.pmcpg/curation": {
            tier: "community",
            reviewedAt: "2026-11-02",
            reviewedBy: "baobab-tech",
            auth: { type: "header", credentials: ["GRANTS_API_KEY"] },
            trust: ["external-content"],
            privacy: "standard",
            audience: ["social-impact"],
            categories: ["research"],
          },
        },
      },
    ],
    presets: [
      {
        id: "grants-research",
        name: "Grants research",
        description: "Find funders and track applications.",
        audience: ["social-impact"],
        servers: ["io.github.example/grants-search", "app.linear/linear"],
        privacy: "standard",
        approvals: "balanced",
      },
    ],
    ...over,
  };
}

/** Serialized and signed with the test key. */
export async function signedSample(
  over: Partial<CatalogInput> = {},
): Promise<{ bytes: Uint8Array<ArrayBuffer>; sig: string }> {
  const bytes = new TextEncoder().encode(JSON.stringify(sampleCatalog(over))) as Uint8Array<ArrayBuffer>;
  return { bytes, sig: await signWithTestKey(bytes) };
}
