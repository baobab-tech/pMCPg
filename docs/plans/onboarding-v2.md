# Plan: onboarding v2 and Simple / Advanced view

Status: approved 2026-11-07, building. Tracked in the [roadmap](../roadmap.md).

## Goal

A non-technical user goes from a fresh install to "my AI app uses pMCPg" in under five minutes, without meeting the words transport, header, stdio or token. Power users switch to Advanced and see everything they see today.

## Today

- `/setup` is a four-step wizard: password, add or import, sign in (first OAuth server only), connect an AI app.
- It assumes the user knows what an MCP server is. "Add your servers" opens on "Paste a URL".
- Sign-in covers one server. Imported servers that need sign-in or values are left for the Accounts page.
- Servers and Accounts are separate pages, though almost every server has exactly one account. Users find the split confusing.
- Connect offers removing imported entries (`suggestedRemove`), but the replace step is not explained.
- Home's checklist tracks servers, sign-in, password and "more than one profile". It never checks that an AI app is connected.

## Flow

```
            Welcome
   ┌───────────┴───────────┐
"I already use MCP"   "This is my first time"
   │                       │
 A1 Import                F1 What is this?
 A2 Fill in / sign in     F2 Pick a starter
 A3 Replace in your app   F3 Sign in
   │                      F4 Connect one app
   │                      F5 Try it
   └───────────┬───────────┘
            Done: "You're set"
```

The password moves off the first screen. It becomes one card on the Done screen and one item on the Home checklist. If a password is required (non-localhost bind, setup code), the wizard opens on it, as today.

### W. Welcome

```
┌──────────────────────────────────────────────────────────┐
│ [logo] Private MCP Gateway                      Simple ▾ │
│                                                          │
│ Welcome. pMCPg lets your AI apps use tools like email,   │
│ files and calendars, while your keys stay here.          │
│ ⓘ This runs on your computer. Nothing is sent to anyone. │
│                                                          │
│ ┌─────────────────────────┐ ┌─────────────────────────┐  │
│ │ I already use MCP       │ │ This is my first time   │  │
│ │ servers                 │ │                         │  │
│ │ Bring them in from      │ │ We'll explain and help  │  │
│ │ Claude, Cursor, VS Code │ │ you add your first one. │  │
│ │ (found 4 on this Mac)   │ │                         │  │
│ └─────────────────────────┘ └─────────────────────────┘  │
│                                     Skip setup →         │
└──────────────────────────────────────────────────────────┘
```

- API: `GET /import/scan` on load. When it finds servers, the first card shows the count and gets the primary style.
- "Skip setup" calls `POST /setup/done` and opens Home.

### Path A: I already use MCP servers

**A1. Bring them in.** The existing `ImportPanel`: found servers, grouped "Online" and "On this computer", all ticked. Below it, "Can't see your Claude or ChatGPT servers?" opens the paste-a-list dialog (built by the Import cloud MCPs session). Nothing is found → the panel says so and offers the paste dialog and "Paste one URL".
- API: `GET /import/scan`, `POST /import/apply { keys }`. Paste-a-list uses whatever endpoint that session ships.

**A2. Finish setting them up.** One list of what the import left to do, from the `ImportOutcome`s: "Sign in" for `needsSignIn`, "Add value" for `missingValues`, "Couldn't reach" for `probeError`. Each row has one button; done rows turn green. "Do this later" is always there.
- API: `POST /accounts/:id/signin` (via `SignInDialog`), `PATCH /accounts/:id` for values (via `KeysDialog`), `POST /accounts/:id/test`.

```
│ Finish setting up                               2 of 4 done│
│ ✓ notion       Signed in                                   │
│ ✓ filesystem   Ready                                       │
│ ○ linear       Needs you to sign in          [ Sign in ]   │
│ ○ github       Needs a value: access token   [ Add value ] │
│                                   Do this later   Next →   │
```

**A3. Replace them in your app.** For each app the servers came from (from the scan's `foundIn`), one card: "Claude Desktop: replace 3 servers with pMCPg". Shows the before/after list in plain words, "A backup is saved first", one button. Removing the old entries is offered, not ticked: the card lists the entries the gateway now provides (`suggestedRemove`) with "Also remove these from Claude Desktop" unticked. Until the user ticks it, the app keeps its own entries next to pMCPg.
- API: `GET /connect/:app/plan?remove=…`, `POST /connect/:app { profile: "all", remove, password? }`.
- After: the plan's `after` steps ("Quit and reopen Claude Desktop").

```
│ Claude Desktop                                              │
│   Before: filesystem, linear, github                        │
│   After:  pMCPg  (gives Claude all 4 servers)               │
│   A backup is saved first.          [ Replace in Claude ]   │
│ Claude Code                                                 │
│   Before: notion                                            │
│   After:  pMCPg                     [ Replace in Claude Code ]│
```

Then Done.

### Path F: This is my first time

**F1. What is an MCP server?** Three short lines and a picture: your AI app → pMCPg → servers (Gmail, Notion, files). "A server gives your AI app a skill, like reading your calendar. pMCPg holds the keys, hides personal details, and asks you before risky actions." One button: "Add my first server". No API.

```
│  [Claude] ──▶ [pMCPg 🔒] ──▶ [Notion] [Linear] [Files]     │
│  A server gives your AI app a skill, like reading your     │
│  notes. pMCPg keeps the keys here and asks you before      │
│  anything risky.                       [ Add my first → ]  │
```

**F2. Pick a starter.** A short list of public servers that work today (see *Starter list*), each a tile with a logo and one line. Last tile: "I have a URL" opens `AddByUrl`. Clicking a tile probes it, then adds it.
- API: `POST /probe { url }`, `POST /servers { … }`.

```
│ Pick one to start. You can add more later.                │
│ [DeepWiki]  Ask about any public code project  · no sign-in│
│ [Notion]    Your pages and notes               · sign in   │
│ [Linear]    Your team's issues                 · sign in   │
│ [Hugging Face] Models, datasets, papers        · no sign-in│
│ [+ I have a URL]                                           │
```

**F3. Sign in.** Only when the probe says OAuth or a key. Same as today's step 2, for the chosen server. Skipped when no sign-in is needed.
- API: `POST /accounts/:id/signin`, or `PATCH /accounts/:id` for a key.

**F4. Connect your AI app.** The existing `ConnectApps` tiles. In Simple view the plan preview, file path and "Other apps: one URL and a token" sit under "Show details".
- API: `GET /connect/:app/plan`, `POST /connect/:app`.

**F5. Try it.** "Open Claude and ask:" plus one suggested prompt for the chosen starter ("Using DeepWiki, what does the vercel/next.js repo do?"). The page waits for the first `search` or `call` event and shows "pMCPg saw your app use DeepWiki ✓". "Skip" is always there.
- API: `GET /activity?type=call&limit=1`, polled every 2 s while the screen is open. Falls back to `search` events. Hidden when `features.activity` is false.

### D. You're set

```
│ ✓ You're set. Claude Desktop now reaches 4 servers through │
│   pMCPg.                                                   │
│                                                            │
│ Next, if you like:                                         │
│ [🔒 Protect this page with a password]      Set password  │
│ [👁 Hide personal details   Standard ▾]     (profile All)  │
│ [✋ Ask me before risky actions  Balanced ▾]               │
│ [▦ Separate profiles for each app]          Learn more    │
│                                              [ Go to Home ]│
```

- Privacy and approvals pickers edit the All profile in place: `PATCH /profiles/all { privacy | preset }`. Same `PRIVACY_OPTIONS` / `PRESET_OPTIONS` words as the Profiles page.
- "Go to Home" calls `POST /setup/done`.

### Home checklist

Rebuilt from real state, shown until every item is done or dismissed (dismissal in `localStorage`).

| Item | Done when | Source |
|---|---|---|
| Add a server | `servers > 0` | `/status` |
| Finish signing in | no account in `sign-in-needed` or missing values | `/status`, `/accounts` |
| Connect an AI app | at least one app has a pMCPg entry | **new**: see *API gaps* |
| Your app used pMCPg | one `call` event exists | `/activity?type=call&limit=1` |
| Protect this page | `passwordSet` | session |

"Make a profile for each AI app" leaves the checklist; it is a next step, not setup.

## Simple / Advanced view

- A switch in the sidebar footer (next to the theme toggle) and on the wizard header: "Simple · Advanced".
- Stored in `localStorage` key `pmcpg.view`; default `simple`. Read through a `useView()` hook and a `<Advanced>` wrapper that renders its children only in Advanced. No server state.
- Simple hides; it never removes a capability. Every hidden control is reachable by switching to Advanced, and Simple pages show "More options in Advanced view" where something is hidden.

| Page | Simple | Advanced adds |
|---|---|---|
| Nav | Home, Connections, AI apps, Approvals, Settings. Activity and Tool review appear when they have something to show | Servers and Accounts as separate pages (replacing Connections), Import, Profiles, Activity, Tool review always |
| Home | Status line, checklist, servers needing attention, approvals waiting | Gateway URL, stats cards, account ids |
| Connections | One row per service (see *Connections*): name, logo, status in words ("Ready", "Sign in needed"), which login, Sign in / Add value / Remove | Separate Servers list: transport, command or URL, headers, env names, trust levels, `allowInsecure`, Test with raw output |
| Add server | URL box or starter tiles; import as a button | Command (stdio) form, transport choice, header name, bearer switch, manual OAuth client ID/secret, URL parameters |
| Accounts | Inside each connection | Separate Accounts list as today, "Add another account for this service" |
| Profiles | Hidden from nav; the All profile's privacy and approval level live on Settings | Full page: per-profile URL, token, accounts, custom rules, read-only |
| AI apps (Connect) | App tiles, "Replace" with before/after in words | Plan preview, file path, commands, profile picker, generic URL + token snippet |
| Approvals | Pending list with Allow / Deny | Policy rule that triggered it, history |
| Activity | Last 20 calls in words ("Claude used Notion: search pages") | Filters, event types, timings, masked counts |
| Tool review | New or changed tools with Accept / Block | Description and schema diff |
| Settings | Password, privacy level, approval level, theme | Host, port, key source, raw config path |

Plain words in Simple: "connection" for a server and its account; "sign in" for OAuth; "key" or "value" for headers and env; "AI app" for client; "Hide personal details" for privacy; "Ask me before" for presets.

## Connections (Simple view)

Simple view shows one **connection** per service: Gmail, Linear, Files. A connection is a server plus its one account, shown together. The data model and `config.yaml` stay as they are (server + account); this is presentation only.

- Where the model first matters (the Connections page header and A2), one sentence: "A connection is a service pMCPg reaches for you, signed in with one of your logins."
- Each row: logo, name, status in words, the login it uses ("olivier@work", from the account label), and one action (Sign in, Add value, Fix). Expanding a row shows sign-in state, keys and values (write-only), tools count, Sign out, Remove.
- Remove in Simple removes the account and, when it was the server's last account, the server too.
- Adding a connection creates the server and its first account in one step, as `POST /servers { account }` already does.
- "Add another account for this service" (work vs personal Gmail) is Advanced only. In Advanced, Connections is replaced by separate Servers and Accounts pages, as today.
- A service that already has two accounts (made in Advanced or the CLI) still shows in Simple; see open question 5.
- Data: join `GET /servers` and `GET /accounts` in the UI. No new endpoint.

```
│ Connections                                   [ + Add ]   │
│ A connection is a service pMCPg reaches for you, signed   │
│ in with one of your logins.                               │
│ [N] Notion     olivier@baobab.tech   ● Ready           ›  │
│ [L] Linear     not signed in         ● Sign in needed [Sign in]│
│ [F] Files      on this computer      ● Ready           ›  │
│ [G] GitHub     needs a value         ● [Add value]        │
```

## Starter list

The catalog does not exist yet ([catalog](../catalog.md)). Until it does, the UI ships a static list of public remote servers that answer the probe today. Each entry is a URL, a name, one line, and a sample prompt. The probe decides the sign-in type at click time, so a wrong label cannot mislead. The list says "A few public servers to start with. More in the catalog later." Starter list (URLs checked again at build time):

| Server | URL | Sign-in |
|---|---|---|
| DeepWiki | `https://mcp.deepwiki.com/mcp` | none |
| Hugging Face | `https://huggingface.co/mcp` | none (optional sign-in) |
| Notion | `https://mcp.notion.com/mcp` | OAuth |
| Linear | `https://mcp.linear.app/mcp` | OAuth |
| Atlassian | `https://mcp.atlassian.com/v1/sse` | OAuth |

Services without dynamic registration (Slack, Gmail, Google Drive, Microsoft 365) are left out: each needs the user to create their own OAuth app. They come back when the catalog can ship a verified client, or through "I have a URL" in Advanced.

No network call happens until the user clicks a tile.

## API

Everything uses existing endpoints. `GET /api/ui/connect/status` (added on main for this plan) returns `[{ app, label, installed, connected, profiles }]` per AI app: `connected` means a user-level entry points at this gateway, `profiles` lists the profiles those entries use. It feeds the Home checklist, the AI apps page ("Connected ✓") and path A3.

## Build status

- Done: Simple / Advanced switch (`ui/components/view.tsx`), nav per view, Connections page, add dialog with starters, AI apps page (connected state, remove offered), Settings privacy and approvals, Home checklist, two-path wizard, Done screen.
- Path A includes the paste-a-list dialog for claude.ai and ChatGPT connectors (from the import panel); Connections keeps the help tips.
- Not yet: Simple wording for Approvals, Activity and Tool review (they keep their current layout).

## Tray / menu bar (not built)

Decision stays: autostart plus web UI. A tray later would be a small separate process that talks to the running gateway; the gateway binary does not change shape.

**What it offers.**
- Status dot: green running, amber something needs attention (sign-in, tool review), grey paused, red not reachable.
- "Open pMCPg" (opens `http://127.0.0.1:7431/`).
- "3 approvals waiting" (opens Approvals); the count also shows as a badge.
- Pause / Resume: the front door answers every call with "pMCPg is paused" until resumed.
- Quit pMCPg (stops the service until next login; offers "Also stop starting at login").

**How it talks to the gateway.** Polls the local admin API every few seconds with the admin token from the keychain, as the CLI does. Needs two small additions: `GET /api/status` (counts only) and `POST /api/pause` / `resume`.

**Simplest build per OS, no UI framework.**

| OS | Approach | Size / toolchain |
|---|---|---|
| macOS | ~150 lines of Swift: `NSStatusItem`, `NSMenu`, `URLSession`. Built with `swiftc`, shipped inside the `.pkg`, `LSUIElement` so it has no Dock icon | ~200 KB; Xcode CLI tools in CI (already needed for signing) |
| Windows | ~150 lines of C# WinForms `NotifyIcon`, compiled with the `csc.exe` that ships with .NET Framework 4.8 on every Windows 10/11 | ~20 KB; no extra install |
| Linux | Optional. GNOME shows no tray without an extension. Offer a desktop notification for pending approvals (`notify-send`) and the web UI; revisit a StatusNotifierItem over D-Bus if users ask | none |

One cross-platform option instead: a Go program with `fyne.io/systray` (one codebase, ~5 MB per OS). More uniform, but adds a Go toolchain to CI. The native route keeps each piece tiny and uses toolchains the release already has.

## Decisions

Agreed with the user on 2026-11-07.

1. **Starter list:** DeepWiki, Hugging Face, Notion, Linear, Atlassian. No services that need a self-made OAuth app.
2. **Password:** optional, offered on the Done screen and the Home checklist; first only when required.
3. **Replace:** removing the AI app's old entries is offered, never ticked by default.
4. **Profiles in Simple:** hidden; the All profile's privacy and approval levels live on Settings.
5. **Two accounts for one service:** one connection with both logins listed inside.
6. **The word:** "Connections".
