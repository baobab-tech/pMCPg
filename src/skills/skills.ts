// Skills contract: what the front door serves and what the web UI's API may read and change.
// Owner: skills. Design: docs/skills.md.

/** Prefix of skill names on the tool path: "skill:notes", "skill:github/pr-review". Account slugs cannot hold ":". */
export const SKILL_PREFIX = "skill:";

/** Where a served skill comes from. Library skills are the user's own; account skills come from a server. */
export type SkillOrigin = { kind: "library" } | { kind: "account"; accountId: string };

/** One file of a skill, as served. */
export interface SkillFileInfo {
  /** Relative path inside the skill, "/"-separated: "SKILL.md", "references/FORMS.md". */
  path: string;
  size: number;
  /** sha256:<hex> of the bytes. */
  digest: string;
}

/** A skill a profile serves, through the Skills extension and the tool path. */
export interface ServedSkill {
  /** "notes" for a library skill; "<account>/<skill path>" for a server skill. */
  id: string;
  /** Frontmatter name: the last segment of the id. */
  name: string;
  description: string;
  origin: SkillOrigin;
  /** Files served, SKILL.md first. For server skills in "text" mode, scripts and binaries are already left out. */
  files: SkillFileInfo[];
}

/** A file sent by the UI or the CLI to create or replace a library skill. */
export interface SkillFileInput {
  path: string;
  content: Uint8Array;
}

/** A library skill as the UI lists it. */
export interface LibrarySkill {
  name: string;
  description: string;
  files: SkillFileInfo[];
  /** Profiles that serve it. "all" serves every library skill. */
  profiles: string[];
}

/** A server skill's review state. "held": changed or new, waiting for review; the approved version, if any, stays served. */
export type ServerSkillStatus = "active" | "held" | "rejected";

export interface ServerSkill {
  accountId: string;
  /** Path under the server's skill root, e.g. "acme/refunds". */
  path: string;
  id: string;
  name: string;
  description: string;
  status: ServerSkillStatus;
  /** Whether clients get a version of it now (the approved one). */
  served: boolean;
  files: SkillFileInfo[];
}

/** A server skill waiting for review: a new skill, or a changed one. */
export interface SkillReview {
  accountId: string;
  path: string;
  reason: "new" | "changed";
  status: "pending" | "rejected";
  /** SKILL.md as approved; absent for a new skill. */
  pinnedSkillMd?: string;
  currentSkillMd: string;
  pinnedFiles?: SkillFileInfo[];
  currentFiles: SkillFileInfo[];
}

/** What the web UI's API may do with skills. */
export interface SkillsHandle {
  library(): LibrarySkill[];
  /** Files of one library skill with their bytes, for editing. Undefined when there is no such skill. */
  readLibrary(name: string): { path: string; content: Uint8Array }[] | undefined;
  /** Create or replace a library skill. Throws SkillError with readable problems when the files are invalid. */
  saveLibrary(name: string, files: SkillFileInput[]): Promise<LibrarySkill>;
  /** Delete a library skill and drop it from every profile. */
  removeLibrary(name: string): Promise<void>;
  /** Skills of one account, or of every account with skills turned on. */
  server(accountId?: string): ServerSkill[];
  reviews(accountId?: string): SkillReview[];
  approve(accountId: string, path: string): Promise<void>;
  /** Keep the approved version (if any) and hide this one until it changes again. */
  reject(accountId: string, path: string): Promise<void>;
  /** Fetch an account's skills again. */
  sync(accountId: string): Promise<void>;
}

/** Invalid skill files. `problems` are readable lines, without file contents. */
export class SkillError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "SkillError";
  }
}
