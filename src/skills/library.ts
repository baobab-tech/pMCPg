// The skill library: one folder per skill under <data dir>/skills, read into memory at load.
// Reads go through the SDK's nodeSkillFiles, which refuses symlinks and paths that leave the folder.
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Skill, SkillCatalogError, skillEntry } from "@modelcontextprotocol/server/ext/skills";
import { nodeSkillFiles } from "@modelcontextprotocol/server/ext/skills/node";
import { SkillName } from "../core/config.ts";
import { assertFiles, fileInfo, frontmatter, sortFiles } from "./files.ts";
import { SkillError, type SkillFileInfo, type SkillFileInput } from "./skills.ts";

const isWindows = process.platform === "win32";

export interface LibraryEntry {
  name: string;
  description: string;
  files: SkillFileInput[];
  info: SkillFileInfo[];
  /** The Skills extension entry, URIs under skill://library/<name>/. */
  entry: Skill;
}

/** URI path of a library skill. */
export const libraryPath = (name: string) => `library/${name}`;

/** Validate files as a skill named `name` and build its entry. Throws SkillError. */
export async function buildEntry(
  skillPath: string,
  name: string,
  files: SkillFileInput[],
): Promise<LibraryEntry> {
  assertFiles(files);
  let entry: Skill;
  try {
    entry = await skillEntry(skillPath, Object.fromEntries(files.map((f) => [f.path, f.content])));
  } catch (e) {
    if (e instanceof SkillCatalogError) throw new SkillError(e.problems.map((p) => p.message));
    throw new SkillError([(e as Error).message]);
  }
  const sorted = sortFiles(files);
  const fm = frontmatter(new TextDecoder().decode(sorted[0]?.content ?? new Uint8Array()));
  return {
    name,
    description: fm?.description ?? entry.frontmatter.description,
    files: sorted,
    info: sorted.map((f) => fileInfo(f.path, f.content)),
    entry,
  };
}

export class SkillLibrary {
  private skills = new Map<string, LibraryEntry>();

  constructor(readonly dir: string) {}

  /** Read every skill folder. Returns one line per skipped folder or file. */
  async load(): Promise<string[]> {
    const warnings: string[] = [];
    const next = new Map<string, LibraryEntry>();
    if (!existsSync(this.dir)) {
      this.skills = next;
      return warnings;
    }
    const fs = nodeSkillFiles(this.dir);
    for (const top of await fs.list("")) {
      if (top.name.startsWith(".")) continue;
      if (top.kind !== "directory") {
        warnings.push(`${top.name}: not a folder, skipped`);
        continue;
      }
      if (!SkillName.safeParse(top.name).success) {
        warnings.push(`${top.name}: folder name is not a valid skill name, skipped`);
        continue;
      }
      try {
        const files = await readTree(fs, top.name);
        next.set(top.name, await buildEntry(libraryPath(top.name), top.name, files));
      } catch (e) {
        warnings.push(`${top.name}: ${(e as Error).message}`);
      }
    }
    this.skills = next;
    return warnings;
  }

  list(): LibraryEntry[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): LibraryEntry | undefined {
    return this.skills.get(name);
  }

  /** Create or replace a skill. Validates first; the folder is swapped in whole. */
  async save(name: string, files: SkillFileInput[]): Promise<LibraryEntry> {
    if (!SkillName.safeParse(name).success)
      throw new SkillError([`${JSON.stringify(name)}: 1 to 64 lowercase letters, digits and single dashes`]);
    const built = await buildEntry(libraryPath(name), name, files);
    ownerOnlyDir(this.dir);
    const suffix = `${process.pid}-${Date.now().toString(36)}`;
    const tmp = join(this.dir, `.new-${name}-${suffix}`);
    const old = join(this.dir, `.old-${name}-${suffix}`);
    const target = join(this.dir, name);
    try {
      for (const f of built.files) {
        const file = join(tmp, ...f.path.split("/"));
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, f.content, { mode: 0o600 });
      }
      if (existsSync(target)) renameSync(target, old);
      renameSync(tmp, target);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(old, { recursive: true, force: true });
    }
    this.skills.set(name, built);
    return built;
  }

  remove(name: string): boolean {
    if (!this.skills.has(name) || !SkillName.safeParse(name).success) return false;
    rmSync(join(this.dir, name), { recursive: true, force: true });
    this.skills.delete(name);
    return true;
  }
}

/** Every file under `root` ("" for the store's own root) in a SkillFiles store. Throws on a symlink or special file. */
async function readTree(fs: ReturnType<typeof nodeSkillFiles>, root: string): Promise<SkillFileInput[]> {
  const out: SkillFileInput[] = [];
  const strip = (rel: string) => (root ? rel.slice(root.length + 1) : rel);
  const walk = async (dir: string) => {
    for (const e of await fs.list(dir)) {
      if (e.name.startsWith(".")) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === "unsupported") throw new Error(`${strip(rel)}: symlink or special file`);
      if (e.kind === "directory") await walk(rel);
      else out.push({ path: strip(rel), content: await fs.read(rel) });
    }
  };
  await walk(root);
  return out;
}

/** Read a skill folder from anywhere (for `pmcpg skills add`). Dotfiles are left out; symlinks throw. */
export function readSkillFolder(folder: string): Promise<SkillFileInput[]> {
  return readTree(nodeSkillFiles(folder), "");
}

function ownerOnlyDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (isWindows) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Not the owner (a mounted volume): keep its mode.
  }
}
