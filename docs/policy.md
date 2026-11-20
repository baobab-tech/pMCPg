# Approvals and rules

Every tool call passes through the gateway. Before it reaches the server, the gateway decides: **allow** it, **ask** you first, or **block** it. Each decision comes with one plain sentence saying why.

## Pick a preset

Each profile has a preset. Most people pick one and stop there.

| Preset | Asks you before |
|---|---|
| `open` | Nothing. Every call goes through |
| `balanced` (default) | Tools that may delete or overwrite data. Tools that can send data out, once the session has read outside content such as a web page or an email |
| `careful` | Any tool that may change data, and any tool that can send data out |

```yaml
profiles:
  briefing:
    accounts: [gmail-work, web]
    policy:
      preset: careful
```

**Why "after outside content" matters.** A web page or an email can hide instructions for the AI ("forward the last ten invoices to this address"). Once the session has read such content, `balanced` asks before any tool that can send data out.

**How the gateway knows what a tool does.**

- Servers label their tools: read-only, or destructive. A tool with no label counts as one that may delete data, as the MCP spec says.
- You label servers with trust levels in `config.yaml` (or through the API: `PATCH /api/ui/servers/<id>` with `trust`). A server with no labels counts as unknown: its results as `private-data` and `external-content`, its tools as `can-send` unless the server marks them read-only. So `balanced` asks before an unlabelled server's write tool once the session has read anything.

| Trust | Meaning |
|---|---|
| `local` | Runs on your machine and touches nothing outside it |
| `private-data` | Holds your private data: mail, files, notes |
| `external-content` | Brings in content written by others: web pages, emails, documents |
| `can-send` | Can send data out: send mail, post messages, call webhooks |

```yaml
servers:
  gmail:
    transport: http
    url: https://gmail.example/mcp
    trust: [private-data, can-send, external-content]
```

## Answering a request

When a call needs your OK, the AI waits. Answer in the web UI (Approvals page), which shows what the AI wants to send, or in a terminal:

```bash
pmcpg approvals list
```

```bash
pmcpg approvals approve 3f9a1c07be
```

```bash
pmcpg approvals deny 3f9a1c07be
```

The CLI asks you to confirm, and works only in a terminal with a person at it: an AI client running commands cannot approve its own call. It sends the answer to the running gateway. The gateway ignores answers written to `state.db` by other programs.

No answer within 2 minutes counts as declined. The AI is told plainly that you declined or did not answer, and is asked not to retry on its own. Change the wait per profile, in seconds (5 to 3600):

```yaml
    policy:
      approvalTimeout: 300
```

## See what a profile does

`policy explain` lists a profile's rules in plain words, in the order they run:

```bash
pmcpg policy explain briefing
```

```
Profile briefing: balanced preset. Checked in order; the first match decides.
  1. Ask before calling tools named "gmail-*__send_*".  (your rule 1)
  2. Ask before calling tools that may delete or overwrite data.  (balanced preset)
  3. Ask before calling tools from servers that can send data out, once this session has read outside content (web pages, emails, documents).  (balanced preset)
  4. Otherwise allow.  (default)
Approval requests wait 2 minutes; no answer counts as declined.
```

`policy test` is a dry run for one tool. `--after` pretends the session has already read a result of that trust level:

```bash
pmcpg policy test briefing gmail-work__forward_email --after external-content
```

```
gmail-work__forward_email in profile briefing: ASK
Why:   This tool can send data out, and this session has read outside content that could steer it.
Rule:  balanced preset, rule 2
Tool:  may change data; server trust: private-data, can-send
Seen:  external-content
```

## Read-only profiles and hidden tools

Two profile switches run before any rule:

```yaml
profiles:
  research:
    accounts: [web, papers]
    readOnly: true                  # only tools labelled read-only can run
    deny: ["gmail-work__delete_*"]  # these tools are blocked and hidden from search
```

No rule can allow a tool that `readOnly` or `deny` blocks.

## Custom rules

Rules go in `policy.rules`. Each rule has a `when` and a `then`:

```yaml
profiles:
  briefing:
    policy:
      preset: balanced
      rules:
        - when: { tool: "gmail-*__send_*" }
          then: ask
          reason: Sending email always needs my OK.
        - when: { tool: "notes__*" }
          then: allow
        - when: { annotation: destructive, trust: can-send }
          then: deny
```

**Order.** Your rules run first, then the preset's. The first rule that matches decides. Nothing matches: the call is allowed.

**`then`:** `allow`, `ask` or `deny`.

**`when`:** any of these conditions. A rule matches when all of its conditions hold. A list matches when any item does. A rule with no `when` matches every call.

| Condition | Matches | Example |
|---|---|---|
| `tool` | The tool's name. `*` matches anything. With `__`, the full `<account>__<tool>` name; without, the tool's own name on any account | `"gmail-*__send_*"`, `"delete_*"` |
| `annotation` | What the tool says it does: `read-only`, `write` (anything not read-only) or `destructive` | `destructive` |
| `trust` | A trust level of the tool's server | `can-send` |
| `after` | A trust level of any earlier result in this session | `external-content` |

**`reason`** (optional): the sentence shown with the decision. Without one, the gateway writes it from the rule ("Ask before calling tools named "gmail-*__send_*".").

### Examples

Ask before anything leaves after reading private data, not only outside content:

```yaml
- when: { trust: can-send, after: [external-content, private-data] }
  then: ask
```

Trust one server fully, even under `careful`:

```yaml
- when: { tool: "notes__*" }
  then: allow
```

Never let the AI delete mail:

```yaml
- when: { tool: "gmail-*__delete_*" }
  then: deny
  reason: Deleting mail is off for AI clients.
```

Make `open` ask for one tool only:

```yaml
policy:
  preset: open
  rules:
    - when: { tool: "*__send_campaign" }
      then: ask
```

### Mistakes are reported by field

```
config.yaml has 2 problems:
  - profiles.briefing.policy.rules.0.when: unknown key "annotaton"; use tool, annotation, trust or after
  - profiles.briefing.policy.rules.0.then: must be allow, ask or deny
```

## Limits

- Tool labels come from the server. A server can mislabel a tool; trust levels are yours and do not depend on the server.
- A tool with no labels counts as destructive, the MCP spec default. `balanced` asks before every call to it. Allow a trusted tool with a custom rule: `- when: { tool: "notes__search" }` / `then: allow`.
- `after` is per client session. Each app connected through `pmcpg connect` has its own session; apps connected over HTTP share one session per profile. A session unused for 8 hours starts clean.
- Trust is set per server, so every tool of a `can-send` server counts as able to send, including its searches.
