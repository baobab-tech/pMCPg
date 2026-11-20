// ToolIndex on MiniSearch (BM25). One index per profile, rebuilt on setTools.
import MiniSearch from "minisearch";
import type { ToolRef } from "../core/types.ts";
import type { ToolIndex } from "./search.ts";

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 10;

interface Doc {
  id: string;
  name: string;
  title: string;
  description: string;
  params: string;
}

interface ProfileIndex {
  search: MiniSearch<Doc>;
  byName: Map<string, ToolRef>;
}

// Words that carry no intent in task prompts ("send an email to my boss").
const STOP_WORDS = new Set(
  "a an and any are as at be by can do for from get have i in into is it its me my of on or our please some that the their them then this to up use using via want we what when which with you your".split(
    " ",
  ),
);

/** Splits on non-alphanumerics, snake_case and camelCase: "gmail-work__sendEmail" -> gmail work send email. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

// Query-side synonyms: common task words mapped to the words tool descriptions use.
const SYNONYMS: Record<string, string[]> = {
  find: ["search"],
  look: ["search"],
  lookup: ["search"],
  meeting: ["event", "calendar"],
  schedule: ["event", "calendar"],
  appointment: ["event", "calendar"],
  doc: ["document"],
  access: ["share", "permission"],
  http: ["url"],
  https: ["url"],
  website: ["web", "url"],
  page: ["web", "url"],
  folder: ["directory"],
  mail: ["email"],
  remove: ["delete"],
};

/** Light suffix stripping so "meetings" matches "meeting" and "files" matches "file". */
export function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function processTerm(term: string): string | null {
  const t = term.toLowerCase();
  return STOP_WORDS.has(t) ? null : stem(t);
}

function processQueryTerm(term: string): string | string[] | null {
  const t = term.toLowerCase();
  if (STOP_WORDS.has(t)) return null;
  const syn = SYNONYMS[t] ?? SYNONYMS[stem(t)];
  return syn ? [stem(t), ...syn.map(stem)] : stem(t);
}

function paramNames(schema: Record<string, unknown>): string {
  const props = schema.properties;
  if (!props || typeof props !== "object") return "";
  return Object.keys(props).join(" ");
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export class MiniSearchToolIndex implements ToolIndex {
  private profiles = new Map<string, ProfileIndex>();

  setTools(profileId: string, tools: ToolRef[]): void {
    const search = new MiniSearch<Doc>({
      fields: ["name", "title", "description", "params"],
      tokenize,
      processTerm,
      searchOptions: {
        processTerm: processQueryTerm,
        boost: { name: 4, title: 3, description: 2, params: 1 },
        prefix: (term) => term.length >= 3,
        fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
        combineWith: "OR",
      },
    });
    const byName = new Map<string, ToolRef>();
    for (const t of tools) {
      if (byName.has(t.qualifiedName)) continue;
      byName.set(t.qualifiedName, t);
      search.add({
        id: t.qualifiedName,
        name: t.qualifiedName,
        title: t.title ?? t.annotations?.title ?? "",
        description: t.description,
        params: paramNames(t.inputSchema),
      });
    }
    this.profiles.set(profileId, { search, byName });
  }

  search(profileId: string, query: string, limit?: number): ToolRef[] {
    const p = this.profiles.get(profileId);
    if (!p || query.trim() === "") return [];
    const out: ToolRef[] = [];
    for (const hit of p.search.search(query)) {
      const t = p.byName.get(hit.id as string);
      if (t) out.push(t);
      if (out.length >= clampLimit(limit)) break;
    }
    return out;
  }

  get(profileId: string, qualifiedName: string): ToolRef | undefined {
    return this.profiles.get(profileId)?.byName.get(qualifiedName);
  }
}
