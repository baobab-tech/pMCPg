// A GatewayHandle backed by memory, for UI API tests.
import { emptyCatalogView } from "../../src/catalog/view.ts";
import type { OAuthController } from "../../src/connectors/connector.ts";
import type { Config } from "../../src/core/config.ts";
import { validateConfig } from "../../src/core/config-store.ts";
import { checkReferences } from "../../src/core/profiles.ts";
import type { AccountState } from "../../src/core/types.ts";
import type { GatewayHandle } from "../../src/gateway/handle.ts";
import type { Vault } from "../../src/vault/vault.ts";

export class MemoryVault implements Vault {
  readonly keySource = "env" as const;
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async delete(k: string) {
    return this.data.delete(k);
  }
  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

export interface FakeHandle extends GatewayHandle {
  vault: MemoryVault;
  calls: string[];
  states: Map<string, AccountState>;
  /** Number of fake tools per account. */
  toolCounts: Map<string, number>;
}

export function fakeHandle(raw: unknown = {}): FakeHandle {
  let config: Config = validateConfig(raw);
  const calls: string[] = [];
  const states = new Map<string, AccountState>();
  const tools = new Map<string, number>();
  const vault = new MemoryVault();
  const oauth: OAuthController = {
    async beginSignIn(id) {
      calls.push(`signin ${id}`);
      return { authorizationUrl: `https://auth.example/authorize?account=${id}` };
    },
    async handleCallback() {
      return { accountId: "x" };
    },
    async signOut(id) {
      calls.push(`signout ${id}`);
      await vault.delete(`account/${id}/oauth/tokens`);
    },
  };
  return {
    url: "http://127.0.0.1:7431",
    config: () => config,
    async updateConfig(mutate) {
      const draft = structuredClone(config);
      mutate(draft);
      const next = validateConfig(draft);
      const broken = checkReferences(next);
      if (broken.length) throw new Error(broken.join("\n"));
      config = next;
      calls.push("updateConfig");
      return config;
    },
    accountState: (id) => states.get(id) ?? { status: "stopped" },
    toolCount: (id) => tools.get(id) ?? 0,
    tools: (id: string) =>
      Array.from({ length: tools.get(id) ?? 0 }, (_, i) => ({
        name: `tool_${i + 1}`,
        description: `Tool ${i + 1}`,
        inputSchema: { type: "object" },
        ...(i === 0 ? { annotations: { readOnlyHint: true } } : {}),
      })),
    async refreshAccount(id) {
      calls.push(`refresh ${id}`);
      states.set(id, { status: "connected" });
      tools.set(id, 2);
    },
    oauth,
    vault,
    async clientToken(id) {
      const k = `gateway/client-token/${id}`;
      if (!vault.data.has(k)) vault.data.set(k, `tok-${id}`);
      return vault.data.get(k) as string;
    },
    resetPrivacy(id) {
      calls.push(`resetPrivacy ${id ?? "*"}`);
      return { sessions: 1, placeholders: 3 };
    },
    keySource: "env",
    catalog: async () => emptyCatalogView(),
    refreshCatalog: async () => emptyCatalogView(),
    calls,
    states,
    toolCounts: tools,
  };
}
