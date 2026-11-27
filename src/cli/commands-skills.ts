// CLI commands for skills: the library, profile assignment, server skills and their review.
// They read and write the data directory directly, then ask a running gateway to reload. See docs/skills.md.
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ALL_PROFILE, SkillName } from "../core/config.ts";
import { loadConfig, saveConfig, validateConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { profileIds } from "../core/profiles.ts";
import { readSkillFolder, SkillLibrary } from "../skills/library.ts";
import { ServerSkillStore } from "../skills/server-skills.ts";
import { SkillError, type SkillFileInput } from "../skills/skills.ts";
import { openDb } from "../store/db.ts";
import { notifyReload } from "./actions.ts";
import { type Command, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "./cli.ts";

const p = () => paths();
const library = async () => {
  const lib = new SkillLibrary(join(p().dir, "skills"));
  await lib.load();
  return lib;
};

function withStore<T>(fn: (s: ServerSkillStore) => T): T {
  const db = openDb(p().db);
  try {
    return fn(new ServerSkillStore(db));
  } finally {
    db.close();
  }
}

/** "<account>/<path>" into its parts. */
function serverId(id: string): { account: string; path: string } | undefined {
  const i = id.indexOf("/");
  return i > 0 ? { account: id.slice(0, i), path: id.slice(i + 1) } : undefined;
}

const list: Command = {
  path: ["skills", "list"],
  summary: "List library skills, server skills and which profiles serve them",
  maxArgs: 0,
  async run(_p, io) {
    const cfg = loadConfig(p().config);
    const lib = await library();
    io.out(`Library (${lib.list().length}), in ${lib.dir}:`);
    for (const e of lib.list()) {
      const profiles = profileIds(cfg).filter(
        (id) => id === ALL_PROFILE || cfg.profiles[id]?.skills?.includes(e.name),
      );
      io.out(`  ${e.name}  ${e.files.length} files  profiles: ${profiles.join(", ")}`);
      io.out(`    ${e.description.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    const on = Object.entries(cfg.accounts).filter(([, a]) => a.skills && a.skills !== "off");
    io.out(`Server skills (${on.length} accounts with skills on):`);
    withStore((s) => {
      for (const [id, a] of on) {
        const mode = a.skills === "all" ? "all" : "text";
        const rows = s.list(id, mode);
        if (!rows.length) io.out(`  ${id} (${mode}): none yet`);
        for (const r of rows) io.out(`  ${r.id}  ${r.status}${r.served ? "" : ", not served"}  (${mode})`);
      }
    });
    return EXIT_OK;
  },
};

const add: Command = {
  path: ["skills", "add"],
  summary: "Add a skill folder (with a SKILL.md) to the library, or replace one with --replace",
  args: "<folder> [--name <name>] [--replace]",
  minArgs: 1,
  maxArgs: 1,
  options: { name: { type: "string" }, replace: { type: "boolean" } },
  optionHelp: {
    name: "Skill name (default: the folder name)",
    replace: "Replace a skill with the same name",
  },
  async run(parsed, io) {
    const folder = resolve(parsed.positionals[0] ?? "");
    if (!existsSync(join(folder, "SKILL.md")) || !statSync(folder).isDirectory()) {
      io.err(`${folder} is not a skill folder: it needs a SKILL.md at its root.`);
      return EXIT_USAGE;
    }
    const name = typeof parsed.values.name === "string" ? parsed.values.name : basename(folder);
    if (!SkillName.safeParse(name).success) {
      io.err(
        `"${name}" is not a valid skill name: 1 to 64 lowercase letters, digits and single dashes. Use --name.`,
      );
      return EXIT_USAGE;
    }
    let files: SkillFileInput[];
    try {
      files = await readSkillFolder(folder);
    } catch (e) {
      io.err(`Could not read ${folder}: ${(e as Error).message}`);
      return EXIT_ERROR;
    }
    const lib = await library();
    if (lib.get(name) && !parsed.values.replace) {
      io.err(`A skill named "${name}" already exists. Add --replace to replace it.`);
      return EXIT_ERROR;
    }
    try {
      const saved = await lib.save(name, files);
      io.out(`Added ${saved.name} (${saved.files.length} files). The "all" profile serves it.`);
      io.out(`Add it to another profile with: pmcpg skills enable ${saved.name} --profile <profile>`);
    } catch (e) {
      io.err(e instanceof SkillError ? e.message : (e as Error).message);
      return EXIT_ERROR;
    }
    await notifyReload(io);
    return EXIT_OK;
  },
};

const remove: Command = {
  path: ["skills", "remove"],
  summary: "Delete a library skill and drop it from every profile",
  args: "<name>",
  minArgs: 1,
  maxArgs: 1,
  async run(parsed, io) {
    const name = parsed.positionals[0] ?? "";
    const lib = await library();
    if (!lib.remove(name)) {
      io.err(`No library skill named "${name}".`);
      return EXIT_ERROR;
    }
    const file = p().config;
    const cfg = loadConfig(file);
    for (const prof of Object.values(cfg.profiles))
      if (prof.skills) prof.skills = prof.skills.filter((n) => n !== name);
    saveConfig(file, validateConfig(cfg, file));
    io.out(`Removed ${name}.`);
    await notifyReload(io);
    return EXIT_OK;
  },
};

function assign(enable: boolean): Command {
  return {
    path: ["skills", enable ? "enable" : "disable"],
    summary: enable ? "Serve a library skill to a profile" : "Stop serving a library skill to a profile",
    args: "<name> --profile <profile>",
    minArgs: 1,
    maxArgs: 1,
    options: { profile: { type: "string", short: "p" } },
    optionHelp: { profile: "Profile id" },
    async run(parsed, io) {
      const name = parsed.positionals[0] ?? "";
      const pid = typeof parsed.values.profile === "string" ? parsed.values.profile : "";
      if (!pid) {
        io.err("--profile is required.");
        return EXIT_USAGE;
      }
      if (pid === ALL_PROFILE) {
        io.err(`"all" always serves every library skill.`);
        return EXIT_USAGE;
      }
      if (enable && !(await library()).get(name)) {
        io.err(`No library skill named "${name}". See: pmcpg skills list`);
        return EXIT_ERROR;
      }
      const file = p().config;
      const cfg = loadConfig(file);
      const prof = cfg.profiles[pid];
      if (!prof) {
        io.err(`No profile named "${pid}". Profiles: ${profileIds(cfg).join(", ")}`);
        return EXIT_ERROR;
      }
      const current = new Set(prof.skills ?? []);
      if (enable) current.add(name);
      else current.delete(name);
      prof.skills = [...current];
      saveConfig(file, validateConfig(cfg, file));
      io.out(`${pid} now serves: ${prof.skills.join(", ") || "no library skills"}`);
      await notifyReload(io);
      return EXIT_OK;
    },
  };
}

const server: Command = {
  path: ["skills", "server"],
  summary: "Pass a server's skills through: off, text (Markdown and plain text only) or all (scripts too)",
  args: "<account> <off|text|all>",
  minArgs: 2,
  maxArgs: 2,
  async run(parsed, io) {
    const [account = "", mode = ""] = parsed.positionals;
    if (!["off", "text", "all"].includes(mode)) {
      io.err("Mode must be off, text or all.");
      return EXIT_USAGE;
    }
    const file = p().config;
    const cfg = loadConfig(file);
    const a = cfg.accounts[account];
    if (!a) {
      io.err(`No account named "${account}".`);
      return EXIT_ERROR;
    }
    if (mode === "off") delete a.skills;
    else a.skills = mode as "text" | "all";
    saveConfig(file, validateConfig(cfg, file));
    if (mode === "off") withStore((s) => s.forget(account));
    io.out(
      mode === "off"
        ? `Skills from ${account} are off; stored copies were deleted.`
        : `Skills from ${account}: ${mode}. The running gateway fetches them now; the first set is trusted, later changes wait for review.`,
    );
    if (mode === "all")
      io.out("Warning: scripts in these skills may run on your computer if your AI app runs them.");
    await notifyReload(io);
    return EXIT_OK;
  },
};

const review: Command = {
  path: ["skills", "review"],
  summary: "List server skills waiting for review",
  maxArgs: 0,
  run(_p, io) {
    const items = withStore((s) => s.reviews());
    if (!items.length) {
      io.out("Nothing to review.");
      return EXIT_OK;
    }
    for (const r of items) {
      io.out(`${r.accountId}/${r.path}  ${r.reason === "new" ? "new skill" : "changed"}  ${r.status}`);
      const before = new Map((r.pinnedFiles ?? []).map((f) => [f.path, f.digest]));
      for (const f of r.currentFiles) {
        const was = before.get(f.path);
        if (was === undefined) io.out(`    + ${f.path}`);
        else if (was !== f.digest) io.out(`    ~ ${f.path}`);
        before.delete(f.path);
      }
      for (const gone of before.keys()) io.out(`    - ${gone}`);
    }
    io.out(
      "Read one with: pmcpg skills show <account>/<path>. Then: pmcpg skills approve|reject <account>/<path>",
    );
    return EXIT_OK;
  },
};

function decide(approve: boolean): Command {
  return {
    path: ["skills", approve ? "approve" : "reject"],
    summary: approve
      ? "Approve a server skill waiting for review"
      : "Reject a server skill waiting for review (the approved version, if any, stays)",
    args: "<account>/<path>",
    minArgs: 1,
    maxArgs: 1,
    async run(parsed, io) {
      const id = serverId(parsed.positionals[0] ?? "");
      if (!id) {
        io.err("Give the skill as <account>/<path>, as `pmcpg skills review` lists it.");
        return EXIT_USAGE;
      }
      const ok = withStore((s) => (approve ? s.approve(id.account, id.path) : s.reject(id.account, id.path)));
      if (!ok) {
        io.err(`Nothing to review for ${id.account}/${id.path}.`);
        return EXIT_ERROR;
      }
      io.out(approve ? "Approved." : "Rejected.");
      await notifyReload(io);
      return EXIT_OK;
    },
  };
}

const show: Command = {
  path: ["skills", "show"],
  summary: "Print a skill's SKILL.md: a library skill by name, a server skill as <account>/<path>",
  args: "<name|account/path>",
  minArgs: 1,
  maxArgs: 1,
  async run(parsed, io) {
    const arg = parsed.positionals[0] ?? "";
    const id = serverId(arg);
    if (!id) {
      const e = (await library()).get(arg);
      const md = e?.files.find((f) => f.path === "SKILL.md");
      if (!e || !md) {
        io.err(`No library skill named "${arg}".`);
        return EXIT_ERROR;
      }
      io.out(new TextDecoder().decode(md.content));
      io.out(`Files: ${e.info.map((f) => `${f.path} (${f.size} bytes)`).join(", ")}`);
      return EXIT_OK;
    }
    const r = withStore((s) => s.reviews(id.account).find((x) => x.path === id.path));
    if (r) {
      io.out(`# Waiting for review (${r.reason})`);
      io.out(r.currentSkillMd);
      return EXIT_OK;
    }
    const cfg = loadConfig(p().config);
    const mode = cfg.accounts[id.account]?.skills === "all" ? "all" : "text";
    const s = withStore((st) => st.servable(id.account, mode).find((x) => x.path === id.path));
    const md = s?.files.find((f) => f.path === "SKILL.md");
    if (!s || !md) {
      io.err(`No server skill ${arg}.`);
      return EXIT_ERROR;
    }
    io.out(new TextDecoder().decode(md.content));
    io.out(`Files: ${s.files.map((f) => `${f.path} (${f.content.byteLength} bytes)`).join(", ")}`);
    return EXIT_OK;
  },
};

export const skillsCommands: Command[] = [
  list,
  add,
  remove,
  assign(true),
  assign(false),
  show,
  server,
  review,
  decide(true),
  decide(false),
];
