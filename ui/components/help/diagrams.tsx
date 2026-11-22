import { ClaudeCopyUrl, ClaudeManagePlugins, ClaudeTurnOff } from "@/components/help/claude-screens";
import type { Diagram } from "@/lib/help";

/** Redrawn Claude Desktop screens for the "move your Claude connectors" articles. */
const CLAUDE_SCREENS = {
  "claude-manage-plugins": {
    Screen: ClaudeManagePlugins,
    caption: "In Claude Desktop: + under the message box, then Plugins, then Manage plugins (outlined).",
    alt: "Claude's + menu with Plugins outlined, and the Plugins list with Manage plugins outlined at the bottom.",
  },
  "claude-copy-url": {
    Screen: ClaudeCopyUrl,
    caption: "A connector's row, opened. Copy server URL (outlined) copies the address to paste into pMCPg.",
    alt: "Claude's Figma connector row, opened: Connector URL https://mcp.figma.com/mcp with a Copy server URL button, its tools, and Sign-in: Required.",
  },
  "claude-turn-off": {
    Screen: ClaudeTurnOff,
    caption: "After the move: the connectors you moved are off, and pmcpg (outlined) is on.",
    alt: "Claude's Plugins list: Figma off, Linear off, pmcpg on.",
  },
} as const;
type ClaudeScreen = keyof typeof CLAUDE_SCREENS;
const isClaudeScreen = (n: Diagram): n is ClaudeScreen => n in CLAUDE_SCREENS;

// The README pictures (docs/assets) come in a light and a dark file; show the one that matches the theme.
const IMAGES: Record<Exclude<Diagram, "objects" | "keychain-prompt" | ClaudeScreen>, { file: string; alt: string; caption: string }> = {
  "request-flow": {
    file: "request-flow",
    caption: "One tool call through pMCPg.",
    alt: "The AI searches for a tool, then calls it. pMCPg checks the rules and adds the saved sign-in. An email in the result is masked as [EMAIL_1] before the AI sees it, and put back when the AI uses it in a later call.",
  },
  profiles: {
    file: "profiles",
    caption: "Each AI app connects to one profile and sees only its accounts.",
    alt: "The Briefing agent connects to the Briefing profile and sees work email, work chat, shared drive and notes. The Research agent connects to the Research profile and sees notes, web search and papers. The Research agent cannot reach work email.",
  },
  "where-data-goes": {
    file: "where-data-goes",
    caption: "What stays on your computer and what reaches the cloud.",
    alt: "Your computer holds the AI apps, any local model, pMCPg and local servers. The cloud holds cloud AI models and online servers. Results going to a cloud model are masked first.",
  },
  "before-after": {
    file: "before-after",
    caption: "Before and after pMCPg: one connection per app, keys kept in one place.",
    alt: "Before: each AI app connects to every server with its own copy of each key. After: each app connects once to pMCPg, which holds the keys and connects to the servers.",
  },
};

function Figure({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="grid gap-2">
      <div className="overflow-x-auto rounded-xl border bg-card p-2">{children}</div>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

/** Servers, accounts, profiles and apps: drawn with theme colours so it follows light and dark. */
function ObjectsDiagram() {
  const box = (x: number, y: number, w: number, label: string, sub?: string, strong = false) => (
    <g key={`${x}-${y}`}>
      <rect
        x={x}
        y={y}
        width={w}
        height={sub ? 44 : 32}
        rx={8}
        className={strong ? "fill-brand/10 stroke-brand" : "fill-background stroke-border"}
        strokeWidth={1.5}
      />
      <text x={x + 12} y={y + (sub ? 19 : 21)} className="fill-foreground text-[12px] font-medium">
        {label}
      </text>
      {sub && (
        <text x={x + 12} y={y + 35} className="fill-muted-foreground font-mono text-[10px]">
          {sub}
        </text>
      )}
    </g>
  );
  const line = (x1: number, y1: number, x2: number, y2: number) => (
    <path
      key={`${x1}-${y1}-${x2}-${y2}`}
      d={`M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`}
      className="fill-none stroke-muted-foreground/50"
      strokeWidth={1.5}
    />
  );
  const head = (x: number, label: string) => (
    <text x={x} y={20} className="fill-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
      {label}
    </text>
  );
  return (
    <svg viewBox="0 0 640 250" className="min-w-[560px]" role="img" aria-labelledby="objects-title">
      <title id="objects-title">
        Two servers, Gmail and Notes. Gmail has a work and a personal account. The Work profile holds work Gmail and
        Notes and is used by Claude Desktop. The Personal profile holds personal Gmail and Notes and is used by LM
        Studio.
      </title>
      {head(10, "Servers")}
      {head(170, "Accounts")}
      {head(330, "Profiles")}
      {head(500, "AI apps")}
      {line(130, 72, 170, 62)}
      {line(130, 72, 170, 122)}
      {line(130, 192, 170, 192)}
      {line(290, 62, 330, 82)}
      {line(290, 192, 330, 82)}
      {line(290, 122, 330, 172)}
      {line(290, 192, 330, 172)}
      {line(470, 82, 500, 82)}
      {line(470, 172, 500, 172)}
      {box(10, 50, 120, "Gmail", "a web address")}
      {box(10, 170, 120, "Notes", "a command")}
      {box(170, 46, 120, "gmail-work")}
      {box(170, 106, 120, "gmail-personal")}
      {box(170, 176, 120, "notes")}
      {box(330, 60, 140, "Work", "/p/work/mcp", true)}
      {box(330, 150, 140, "Personal", "/p/personal/mcp", true)}
      {box(500, 66, 130, "Claude Desktop")}
      {box(500, 156, 130, "LM Studio")}
    </svg>
  );
}

/** The macOS keychain access prompt, redrawn so it follows the theme and reads as text. */
function KeychainPrompt() {
  const btn = "rounded-md px-3 py-1 text-[13px] font-medium";
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border bg-zinc-100 p-4 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
      <div className="flex gap-3">
        <svg viewBox="0 0 40 48" className="size-11 shrink-0" aria-hidden="true">
          <path d="M10 22V14a10 10 0 0 1 20 0v8" className="fill-none stroke-zinc-400" strokeWidth={4} />
          <rect x={4} y={20} width={32} height={26} rx={4} className="fill-amber-400 dark:fill-amber-500" />
          <rect x={20} y={32} width={18} height={14} rx={3} className="fill-zinc-900" />
          <text x={29} y={41.5} textAnchor="middle" className="fill-green-400 font-mono text-[5px]">
            pmcpg
          </text>
        </svg>
        <div className="grid gap-2">
          <p className="text-sm leading-snug font-semibold">
            pmcpg wants to use your confidential information stored in “private-mcp-gateway” in your keychain.
          </p>
          <p className="text-xs">To allow this, enter the “login” keychain password.</p>
          <div className="flex items-center gap-2 text-xs">
            Password:
            <span className="flex-1 rounded-md border-2 border-blue-500/60 bg-white px-2 py-0.5 tracking-widest dark:bg-zinc-700">
              ••••••••
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <span className={`${btn} mr-auto bg-zinc-200 ring-2 ring-brand dark:bg-zinc-600`}>Always Allow</span>
        <span className={`${btn} bg-zinc-200 dark:bg-zinc-600`}>Deny</span>
        <span className={`${btn} bg-blue-500 text-white`}>Allow</span>
      </div>
    </div>
  );
}

export function HelpDiagram({ name }: { name: Diagram }) {
  if (name === "keychain-prompt") {
    return (
      <Figure caption="The macOS prompt. Enter your Mac login password, then choose Always Allow (outlined). Development builds show “bun” instead of “pmcpg”.">
        <div className="p-3" role="img" aria-label="macOS dialog: pmcpg wants to use your confidential information stored in private-mcp-gateway in your keychain. A password field and three buttons: Always Allow, Deny, Allow.">
          <KeychainPrompt />
        </div>
      </Figure>
    );
  }
  if (isClaudeScreen(name)) {
    const { Screen, caption, alt } = CLAUDE_SCREENS[name];
    return (
      <Figure caption={caption}>
        <div className="p-3" role="img" aria-label={alt}>
          <Screen />
        </div>
      </Figure>
    );
  }
  if (name === "objects") {
    return (
      <Figure caption="A server is where tools come from. An account is one sign-in to it. A profile picks accounts and has its own address; each AI app connects to one profile.">
        <ObjectsDiagram />
      </Figure>
    );
  }
  const img = IMAGES[name];
  return (
    <Figure caption={img.caption}>
      {/* biome-ignore lint/performance/noImgElement: static export, plain files */}
      <img src={`/help/${img.file}-light.svg`} alt={img.alt} className="w-full min-w-[560px] dark:hidden" />
      {/* biome-ignore lint/performance/noImgElement: static export, plain files */}
      <img src={`/help/${img.file}-dark.svg`} alt="" className="hidden w-full min-w-[560px] dark:block" />
    </Figure>
  );
}
