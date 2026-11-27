# Skills

pMCPg keeps a library of [Agent Skills](https://agentskills.io/specification), assigns them to profiles, and serves each profile's skills to every connected AI client. It can also pass through skills that upstream MCP servers publish, after the user turns that on and reviews them.

Research behind this design, as of 2026-11-27:

- The MCP Skills extension, `io.modelcontextprotocol/skills` ([SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension.md)), is Final since 2026-09-13. It adds `skills/list`, `skills/get` and an optional `resources/directory/read`; skill files are `skill://` resources with SHA-256 digests.
- Clients with native support: Claude Code (beta, shown as `server:skill`) and VS Code 1.147 (beta, consent per server). ChatGPT and Codex rolled theirs back in November 2026. Other clients have none.
- The TypeScript SDK 2.4.0 ships `ext/skills`: `SkillsExtension` (server side, `@experimental`) and `SkillsClient` (lists, reads and verifies files).

## Two kinds of skills

| | Library skills | Server skills |
|---|---|---|
| Written by | The user, or a file the user imported | The operator of an upstream MCP server |
| Stored | `<data dir>/skills/<name>/` | `state.db` (`skill_files`), fetched from the server |
| Assigned | Per profile (`profiles.<id>.skills`); "All" holds every library skill | With their account: a profile that holds the account gets its approved skills |
| Default | Served once assigned | Off per account (`accounts.<id>.skills: off`) |
| Files | Every file | `text`: `.md`, `.markdown` and `.txt` only. `all`: every file |
| Trust | The user's own content | Untrusted. Pinned on first use, held for review when they change |
| URI | `skill://library/<name>/<file>` | `skill://accounts/<account>/<skill path>/<file>` |
| Tool-path name | `skill:<name>` | `skill:<account>/<skill path>` |

`library` and `accounts` are fixed URI prefixes, so a library skill and an account can share a name without their URIs overlapping.

## How clients reach skills

**Native path.** The front door declares the Skills extension (and the `resources` capability) on a profile that has at least one skill. It serves `skills/list`, `skills/get` and `resources/read` through one `SkillSource` per profile. Every entry carries `_meta["io.pmcpg/origin"]`: `"library"` or `"account:<id>"`. Claude Code shows the skills as `pmcpg:<name>`. A profile without skills declares nothing new.

**Tool path.** Clients without native support use the same two front-door tools:

- The `search_tools` description lists the profile's skills after its tools. The server instructions get one line of skill names.
- `search_tools` returns up to 3 matching skills after the tool hits, as `{ name: "skill:<id>", kind: "skill", description, inputSchema }`.
- `call_tool name="skill:<id>"` returns the skill's `SKILL.md` with a header naming its origin and listing its files. `arguments.file` reads one supporting file. Binary files return their size only.

Skill names start with `skill:`. Account slugs cannot contain `:`, so a skill name never collides with a tool name. Skill reads skip the tool pipeline: they carry no user data and call no server.

A client with native support also sees the tool path. Both read the same bytes.

## Scripts

pMCPg never runs a skill's files. It stores and serves bytes. A client that runs a bundled script does so through its own shell tool and its own approval prompt; the spec requires hosts to ask per skill before code from an MCP-served skill runs. Clients on the tool path receive scripts as text. Server skills default to `text`, which drops scripts and binaries before they are fetched.

## Pinning server skills

A server skill's pin is the SHA-256 of its full upstream resource set (every relative path, digest and size, sorted), whatever the file mode. A change to any file, including a dropped script, changes the pin.

1. The first sync after an account's skills are turned on pins every listed skill (trust on first use, while the user is looking).
2. Each later sync compares. A new skill is held back: no client sees it. A changed skill is held too; clients keep getting the approved version.
3. Skill review in the web UI (and `pmcpg skills review`) shows the old and new `SKILL.md` and which files were added, changed or removed. Approve pins the new set. Reject keeps the approved version and hides this one until it changes again.
4. A skill the server stops listing is forgotten; if it returns, it is reviewed as new.
5. Turning an account's skills off, or removing the account, forgets its pins and files.

Every fetched file is checked against the server's listed size and digest (`SkillsClient.read`). pMCPg checks the digest again before storing. A failure skips that skill and records an `account-state` event with status `skill-skipped`. Skills with `"resources": "dynamic"` cannot be pinned and are skipped. Skills over the SDK limits (512 files, 16 MiB) are skipped.

Files are fetched when the account's tools are listed: at start for remote accounts, after sign-in, on reload, on "Test" in the UI, and when the server reports a change. pMCPg serves the stored copy; clients never reach the upstream server for a skill.

## Library rules

- A skill is a folder whose `SKILL.md` starts with YAML frontmatter holding `name` and `description`. `name` must equal the folder name: 1 to 64 lowercase letters, digits and single dashes.
- File paths are relative, `/`-separated, with no `.` or `..` segments, no backslashes, and no symlinks.
- Limits per skill: 512 files and 16 MiB in total. The web UI's upload is capped by its 1 MiB request limit; larger skills go through `pmcpg skills add <folder>`.
- The library folder is created owner-only (0700). The gateway re-reads it at start and on reload; the CLI writes it directly, then asks a running gateway to reload.

## Where to change things

| Need | Web UI | CLI | `config.yaml` |
|---|---|---|---|
| Add, edit or delete a library skill | Skills page | `pmcpg skills add <folder>`, `remove` | (files in `<data dir>/skills/`) |
| Serve a library skill to a profile | Profiles, edit | `pmcpg skills enable <name> --profile <p>` | `profiles.<id>.skills` |
| Pass a server's skills through | Skills page, per account | `pmcpg skills server <account> off\|text\|all` | `accounts.<id>.skills` |
| Review a held server skill | Skills page | `pmcpg skills review`, `show`, `approve`, `reject` | |

## Security

| Threat | Control |
|---|---|
| A server publishes instructions that steer the model (prompt injection) | Server skills are off by default; the tool path labels them as written by the server and untrusted; the native path carries origin in the URI and `_meta` |
| A server changes a skill after approval (rug pull) | Pinning on the full resource set; a changed skill waits for review while the approved version stays served |
| A skill ships a script that runs on the user's machine | pMCPg never runs files; `text` mode drops scripts; clients gate execution |
| A skill impersonates another (same name) | URIs and tool-path names carry the origin (`library/` or `accounts/<id>/`) |
| A library path escapes the folder | Relative paths only, no `..`, symlinks refused (the SDK's `nodeSkillFiles`) |
| Skill content leaks into logs | Events carry skill names, file paths and counts, never content |
| New outbound calls | None. Server skills come only from configured servers, over their existing connection |

## Contract changes

- `src/core/config.ts`: optional `ProfileDef.skills` (library skill names, `SkillName`) and `AccountDef.skills` (`off`, `text` or `all`). Absent means no skills, as before.
- `src/connectors/connector.ts`: optional `listSkills` and `readSkillFile` on `Connector`, so test fakes stay valid.
- `src/store/db.ts`: migration 3 adds `skill_pins`, `skill_pin_accounts`, `skill_quarantine` and `skill_files`.
- `src/store/events.ts`: `skill-read` and `skills-changed`.
- `src/gateway/handle.ts`: optional `skills: SkillsHandle`.
- New module contract `src/skills/skills.ts`: `SkillsHandle`, `ServedSkill`, `SKILL_PREFIX`.

## Not in this release

- Importing skills from the catalog. The catalog format belongs to the catalog work.
- Version history of library skills. Every edit changes the digests, which is how native clients notice.
- Hiding the tool path from clients that declare native support.
- Secret scanning of server skill text.
