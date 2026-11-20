# Plan: skills

Status: exploring. Tracked in the [roadmap](../roadmap.md).

## Goal

Install an Agent Skill once in pMCPg and use it from every connected AI app. Skills are added, reviewed, pinned and assigned to profiles the way MCP servers are today.

Today each app keeps its own copy: `~/.claude/skills` for Claude Code, uploads for claude.ai, other folders for other agents. Copies drift, and nobody reviews what changed.

## What a skill is

An [Agent Skill](https://agentskills.io/specification) is a folder with a `SKILL.md` file and optional supporting files.

```
pdf-forms/
├── SKILL.md          # YAML frontmatter + Markdown instructions
├── scripts/fill.py   # optional: code the agent may run
├── references/       # optional: docs loaded on demand
└── assets/           # optional: templates, images
```

- **Frontmatter.** `name` (lowercase letters, digits and hyphens, matches the folder) and `description` are required. `license`, `compatibility`, `metadata` and `allowed-tools` are optional.
- **Progressive disclosure.** The agent sees only names and descriptions at first. It reads the body of `SKILL.md` when a task matches, and other files only when the body points to them.
- **Scripts run in the AI app,** not in the server that hosts the skill. Claude Code, for example, runs `scripts/fill.py` with the user's own rights.

## Serving skills to AI apps

Two paths, both from one skill store.

### 1. MCP Skills extension (SEP-2640)

The [Skills extension](https://modelcontextprotocol.io/seps/2640-skills-extension) (`io.modelcontextprotocol/skills`) serves skills over MCP resources:

- `skills/list` returns each skill's `SKILL.md` URI, its frontmatter, and every file with its SHA-256 digest and size.
- `skills/get` returns one entry by URI.
- Files are read with `resources/read` at `skill://<prefix>/<skill>/<path>`.
- The client verifies each file against the listed digest before it loads it.

SDK v2 (2.4.0, already a dependency) ships both sides: `SkillsExtension` with a custom `SkillSource` in `@modelcontextprotocol/server/ext/skills`, and `SkillsClient` in `@modelcontextprotocol/client/ext/skills`. The front door attaches one `SkillsExtension` per profile, backed by a `SkillSource` that returns only that profile's approved skills. No new runtime dependency.

### 2. Fallback through `search_tools` / `call_tool`

Most AI apps do not support the extension yet. For them, skills are a built-in account, `skills`, served in-process like the `files` account in [vault drop](vault-drop.md):

| Tool | Does | Annotations |
|---|---|---|
| `skills__list` | Name and description of each skill in this profile | read-only |
| `skills__get` | Body of one skill's `SKILL.md`, plus the list of its other files | read-only |
| `skills__read` | One supporting file, as text | read-only |

`search_tools` indexes skill descriptions, so "fill in this PDF form" finds `skills__get` with the `pdf-forms` skill named in the result. The front door keeps its two tools; policy, events and the activity log apply unchanged.

MCP prompts (one prompt per skill, shown as a slash command in some apps) are a possible third path. Not in the first version.

## First version

- **Add** a skill from a local folder, a `.zip`, or a Git URL (`pmcpg skill add <path|url>`, and "Add skill" in the web UI). pMCPg copies it to `$PMCPG_HOME/skills/<name>/`.
- **Import** skills from AI apps that keep them on disk (`~/.claude/skills`, project `.claude/skills`), as onboarding imports servers.
- **Review** before use: the UI shows `SKILL.md`, the file list, and flags scripts and executable files.
- **Assign** skills to profiles, like accounts. A skill is off in every profile until assigned.
- **Serve** through both paths above.
- **Update** from the original source on request, with a diff of changed files and a new review.
- **Remove** a skill and its files.

Not in the first version: a skill catalog, publishing skills, skills from downstream MCP servers (read with `SkillsClient` and passed through), MCP prompts.

## Security

A skill is instructions plus code that the AI app may run with the user's rights. pMCPg treats it like a stdio server.

- **Review and approval.** A new skill is quarantined until the user approves it. Skills with scripts show a warning: "This skill contains code your AI app can run on this computer."
- **Pinning.** Approval pins the SHA-256 digest of every file. The SEP-2640 entry carries the same digests, so clients check them too. A changed file on disk quarantines the skill again, as a changed tool definition does.
- **Instruction-only option.** A per-profile switch serves `SKILL.md` and references but withholds `scripts/`.
- **Limits.** 512 files and 16 MiB per skill (the SDK's `SKILL_LIMITS`). Symlinks and special files are refused.
- **No execution in pMCPg.** The gateway never runs skill scripts.
- **Network.** Only Git URLs the user enters are fetched, over `https:`.
- **Events.** `skill-read` events carry the skill name and file path, never file contents.
- **Prompt injection.** Skill text reaches the model as instructions. Review is the control; masking does not apply to skill content.

## Contract changes

- `src/core/config.ts`: a `skills` section (source, profiles, `allowScripts`).
- `src/store/db.ts`: a new migration for skill pins and approvals.
- `src/gateway/handle.ts`: skill list, approve, assign and remove for the web UI.

## Open questions

- Where do clients that support SEP-2640 surface skills from a server, and do they run its scripts?
- One `skill://` prefix for all profiles, or one per profile?
- Should a skill be able to require an account (a skill that drives the Notion server is useless without it)?
