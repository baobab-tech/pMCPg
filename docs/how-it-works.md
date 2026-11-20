# How it works

The AI sees two tools, `search_tools` and `call_tool`. Every call passes through the gateway, which checks policy, adds credentials, and filters the result.

## How a request flows

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/request-flow-dark.svg">
    <img alt="Animation in four steps: the AI searches for a tool; the AI calls it and the gateway checks policy and adds the saved sign-in; the result containing jane@acme.org is masked to [EMAIL_1] before the AI sees it; when the AI replies to [EMAIL_1], the gateway puts jane@acme.org back." src="assets/request-flow-light.svg" width="100%">
  </picture>
</p>

1. The AI searches for a tool. The gateway returns only the matches.
2. The AI calls the tool. The gateway checks your rules and adds the saved sign-in. The AI never sees your keys.
3. The result comes back. For a cloud model, `jane@acme.org` becomes `[EMAIL_1]` before it reaches the AI.
4. The AI replies to `[EMAIL_1]`. The gateway puts `jane@acme.org` back before the call reaches the email server.

Real placeholders also carry a short tag, for example `[EMAIL_1_k7qx]`. The tag changes on every gateway run, so an old placeholder never restores a different person's value.

## Profiles

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/profiles-dark.svg">
    <img alt="The Briefing agent connects to the Briefing profile and sees work email, work chat, shared drive and notes. The Research agent connects to the Research profile and sees notes, web search and papers. Research cannot reach work email." src="assets/profiles-light.svg" width="100%">
  </picture>
</p>

- A profile is a set of accounts for one purpose.
- Each profile has its own address. Point each AI agent at the profile it needs.
- An agent sees only its profile's tools. The AI cannot switch profiles.
- One account can sit in several profiles. You sign in once.
- A default **All** profile holds every account, for people who want one connection for everything.

## Profile URLs

Each profile has its own endpoint and its own client token.

| Endpoint | Profile |
|---|---|
| `http://127.0.0.1:7431/p/briefing/mcp` | Briefing |
| `http://127.0.0.1:7431/p/research/mcp` | Research |
| `http://127.0.0.1:7431/mcp` | All (every account) |

- Isolation comes from the connection. A client on `/p/research/mcp` cannot see or call Briefing's tools, whatever the model asks.
- When a profile holds two accounts of one server, tools are named `server@account__tool`, for example `gmail@work__search`.
- Each stdio server runs once per account. Profiles that share an account share the process.

## Search

- `search_tools` takes a `query` and a `limit` (default 5, max 10) and returns matching tools with full input schemas and annotations.
- Ranking is BM25 over tool names, titles, descriptions and parameter names.
- Tool lists are cached, so search works while a stdio server is stopped. Stdio servers start on first use and stop after 10 idle minutes.
- Tools of accounts that need sign-in, quarantined tools and tools blocked by policy never appear in results.

## Architecture

```mermaid
flowchart LR
  C[AI client] -->|MCP: search_tools, call_tool| FD
  B[Browser] -->|HTTP, localhost| UI
  subgraph G[Private MCP Gateway]
    FD[Front door<br/>one URL per profile] --> P[Pipeline]
    P --> R1[Resolve] --> R2[Policy] --> R3[Re-hydrate] --> R4[Inject credentials] --> R5[Forward]
    R5 --> R6[Scan] --> R7[Mask] --> R8[Log] --> R9[Return]
    UI[Web UI] --- V[(Vault<br/>encrypted in state.db,<br/>key in OS keychain)]
    R4 --- V
    R8 --- L[(state.db<br/>log, pins, approvals)]
  end
  R5 --> S1[Local server<br/>stdio]
  R5 --> S2[Remote server<br/>HTTPS + OAuth]
  R5 --> S3[Remote server<br/>HTTPS + API key]
```

Design details: [Concept](concept.md) (what and why, threat model) and [Design](design.md) (stack, data model, process model).

---

[← Back to README](../README.md)
