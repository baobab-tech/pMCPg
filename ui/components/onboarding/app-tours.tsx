"use client";

// Short illustrated walkthroughs of adding pMCPg in each AI app.
// The pictures are simple mockups drawn with divs, not screenshots: they show where to click, not pixel-exact UI.

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BlocksIcon,
  ClockIcon,
  HomeIcon,
  LibraryIcon,
  MousePointer2Icon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AppLogo, type LogoId } from "@/components/app-logos";
import { CodeBlock, CopyButton, ErrorNote, Field, RevealToken } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, type Snippet } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ConnectInfo {
  url: string;
  token: string;
  snippets: Snippet[];
}

/** URL, token and snippets for one profile (creates the profile's token if missing). */
export function useConnectInfo(profileId: string, enabled = true) {
  const [info, setInfo] = useState<ConnectInfo>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    setInfo(undefined);
    setError(undefined);
    api
      .post<ConnectInfo>(`/profiles/${profileId}/connect`)
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, [profileId, enabled]);
  return { info, error };
}

// ---- mockup pieces ----

function Win({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-background text-[11px] shadow-sm", className)}>
      <div className="flex items-center gap-1 border-b bg-muted/60 px-2 py-1.5">
        <span className="size-2 rounded-full bg-red-400" />
        <span className="size-2 rounded-full bg-amber-400" />
        <span className="size-2 rounded-full bg-green-500" />
      </div>
      <div className="flex min-h-36">{children}</div>
    </div>
  );
}

/** Highlighted target with a pointer. */
function Hi({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative rounded-md bg-brand/10 ring-2 ring-brand", className)}>
      {children}
      <MousePointer2Icon className="pointer-events-none absolute -right-2 -bottom-3 size-4 fill-foreground text-background" />
    </span>
  );
}

/** `active`: the click target (with pointer). `selected`: already open (no pointer). */
function Rail({ active, selected }: { active?: number; selected?: number }) {
  const icons = [HomeIcon, BlocksIcon, ClockIcon, LibraryIcon, SlidersHorizontalIcon];
  return (
    <div className="flex flex-col items-center gap-2 border-r bg-muted/30 px-1.5 py-2">
      {icons.map((I, i) =>
        i === active ? (
          <Hi key={I.displayName ?? i} className="flex p-1">
            <I className="size-3.5" />
          </Hi>
        ) : (
          <span
            key={I.displayName ?? i}
            className={cn("flex rounded-md p-1", i === selected ? "bg-muted text-foreground" : "text-muted-foreground")}
          >
            <I className="size-3.5" />
          </span>
        ),
      )}
    </div>
  );
}

function MenuItem({ children, hi }: { children: ReactNode; hi?: boolean }) {
  return hi ? <Hi className="block px-2 py-1">{children}</Hi> : <span className="block px-2 py-1 text-muted-foreground">{children}</span>;
}

function FakeInput({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate rounded border bg-muted/40 px-1.5 py-1 font-mono">{value}</span>
    </div>
  );
}

function Terminal({ lines }: { lines: ReactNode[] }) {
  return (
    <div className="grid w-full gap-1 bg-neutral-950 p-3 font-mono text-[11px] text-neutral-100">
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static lines
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function ChatBox({ hiTools, tools }: { hiTools?: boolean; tools?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-end gap-2 p-3">
      {tools && (
        <div className="grid w-44 gap-1 self-start rounded-md border bg-popover p-2 shadow-sm">
          <span className="flex items-center justify-between">
            <span className="font-medium">pmcpg</span>
            <span className="h-3 w-5 rounded-full bg-brand" />
          </span>
          <span className="text-muted-foreground">Your tools, through pMCPg</span>
        </div>
      )}
      <div className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5">
        <PlusIcon className="size-3.5 text-muted-foreground" />
        {hiTools ? (
          <Hi className="flex p-0.5">
            <SlidersHorizontalIcon className="size-3.5" />
          </Hi>
        ) : (
          <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">Ask anything</span>
      </div>
    </div>
  );
}

function PmcpgTile({ app, label }: { app: LogoId; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-2 p-3">
      <span className="font-medium">pMCPg · Connect your AI app</span>
      <span className="flex items-center gap-2 rounded-md border px-2 py-1.5">
        <AppLogo app={app} size="sm" />
        {label}
      </span>
      <Hi className="rounded-md bg-primary px-2 py-1 text-primary-foreground">Connect {label}</Hi>
    </div>
  );
}

// ---- tours ----

interface Step {
  title: string;
  body: ReactNode;
  picture: ReactNode;
  /** Real values to copy, under the picture. */
  extra?: ReactNode;
}

function Values({ info, snippet }: { info?: ConnectInfo; snippet?: Snippet["id"] }) {
  if (!info) return <Skeleton className="h-16" />;
  const s = snippet && info.snippets.find((x) => x.id === snippet);
  if (s) return <CodeBlock code={s.code} />;
  return (
    <div className="grid gap-2">
      <Field label="Address">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">{info.url}</code>
          <CopyButton value={info.url} />
        </div>
      </Field>
      <Field label="Token">
        <RevealToken token={info.token} />
      </Field>
    </div>
  );
}

function chatgptSteps(info?: ConnectInfo): Step[] {
  return [
    {
      title: "Open Customize",
      body: "Open the ChatGPT app on your computer and click Customize in the left bar.",
      picture: (
        <Win>
          <Rail active={4} />
          <div className="flex flex-1 items-center justify-center text-muted-foreground">Where should we begin?</div>
        </Win>
      ),
    },
    {
      title: "Open Plugins",
      body: "In the Customize panel, click Plugins.",
      picture: (
        <Win>
          <Rail selected={4} />
          <div className="grid w-36 content-start gap-1 border-r p-2">
            <span className="px-2 pb-1 font-medium">Customize</span>
            <MenuItem hi>Plugins</MenuItem>
            <MenuItem>Skills</MenuItem>
          </div>
          <div className="flex-1" />
        </Win>
      ),
    },
    {
      title: "Add custom MCP server",
      body: "Click Add at the top right, then Add custom MCP server.",
      picture: (
        <Win>
          <Rail selected={4} />
          <div className="relative flex-1 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Plugins</span>
              <span className="rounded-full border px-2 py-0.5">Add ▾</span>
            </div>
            <div className="absolute top-10 right-3 grid w-44 gap-0.5 rounded-md border bg-popover p-1 shadow-sm">
              <MenuItem>Create plugin</MenuItem>
              <MenuItem>Add a marketplace</MenuItem>
              <MenuItem hi>Add custom MCP server</MenuItem>
              <MenuItem>Record a skill</MenuItem>
            </div>
          </div>
        </Win>
      ),
    },
    {
      title: "Paste the address and token",
      body: "Name it pmcpg. Paste the address below as the server URL. If it asks how to sign in, pick the token (API key or bearer) option and paste the token.",
      picture: (
        <Win>
          <div className="grid flex-1 content-start gap-2 p-3">
            <span className="text-sm font-medium">Add custom MCP server</span>
            <FakeInput label="Name" value="pmcpg" />
            <FakeInput label="URL" value={info?.url ?? "http://127.0.0.1:…/mcp"} />
            <FakeInput label="Token" value="••••••••••••" />
          </div>
        </Win>
      ),
      extra: <Values info={info} />,
    },
    {
      title: "Use it in a chat",
      body: "Start a new chat. The pmcpg tools are listed with your plugins; turn them on there if they are off.",
      picture: (
        <Win>
          <Rail />
          <ChatBox tools />
        </Win>
      ),
    },
  ];
}

function claudeDesktopSteps(info?: ConnectInfo): Step[] {
  return [
    {
      title: "Let pMCPg add itself",
      body: "Pick Claude Desktop here and click Connect. pMCPg adds itself to Claude Desktop's settings file and keeps a backup of the old one.",
      picture: (
        <Win>
          <PmcpgTile app="claude-desktop" label="Claude Desktop" />
        </Win>
      ),
    },
    {
      title: "Restart Claude Desktop",
      body: "Quit Claude Desktop completely (Claude menu → Quit, or right-click the tray icon on Windows), then open it again.",
      picture: (
        <Win>
          <div className="grid w-44 content-start gap-0.5 p-2">
            <span className="px-2 pb-1 font-medium">Claude</span>
            <MenuItem>About Claude</MenuItem>
            <MenuItem>Settings…</MenuItem>
            <MenuItem hi>Quit Claude</MenuItem>
          </div>
        </Win>
      ),
    },
    {
      title: "Check the tools menu",
      body: "In a new chat, open the tools menu next to the message box. pmcpg should be listed and turned on.",
      picture: (
        <Win>
          <ChatBox hiTools tools />
        </Win>
      ),
    },
    {
      title: "Doing it by hand instead",
      body: "Open Settings → Developer → Edit Config, paste this into the file, save, and restart Claude Desktop.",
      picture: (
        <Win>
          <div className="grid w-32 content-start gap-0.5 border-r p-2">
            <MenuItem>General</MenuItem>
            <MenuItem>Connectors</MenuItem>
            <MenuItem hi>Developer</MenuItem>
          </div>
          <div className="flex flex-1 items-start justify-end p-3">
            <Hi className="rounded-md border px-2 py-1">Edit Config</Hi>
          </div>
        </Win>
      ),
      extra: <Values info={info} snippet="claude-desktop" />,
    },
  ];
}

function autoSteps(app: LogoId, label: string, restart: string, check: string, checkPicture: ReactNode): Step[] {
  return [
    {
      title: "Let pMCPg add itself",
      body: `Pick ${label} here and click Connect. pMCPg shows the change first and keeps a backup.`,
      picture: (
        <Win>
          <PmcpgTile app={app} label={label} />
        </Win>
      ),
    },
    { title: "Reload the app", body: restart, picture: <Win>{checkPicture}</Win> },
    { title: "Check pmcpg is there", body: check, picture: <Win>{checkPicture}</Win> },
  ];
}

const listPicture = (where: string) => (
  <div className="grid flex-1 content-start gap-1 p-3">
    <span className="font-medium">{where}</span>
    <span className="flex items-center justify-between rounded-md border px-2 py-1.5">
      <Hi className="px-1">pmcpg</Hi>
      <span className="h-3 w-5 rounded-full bg-brand" />
    </span>
  </div>
);

function tourFor(app: TourApp, info?: ConnectInfo, profile = "all"): { label: string; steps: Step[] } {
  switch (app) {
    case "chatgpt":
      return { label: "ChatGPT Desktop", steps: chatgptSteps(info) };
    case "claude-desktop":
      return { label: "Claude Desktop", steps: claudeDesktopSteps(info) };
    case "claude-code":
      return {
        label: "Claude Code",
        steps: [
          {
            title: "Let pMCPg add itself",
            body: "Pick Claude Code here and click Connect. pMCPg runs Claude Code's own “mcp add” command for you.",
            picture: (
              <Win>
                <PmcpgTile app="claude-code" label="Claude Code" />
              </Win>
            ),
          },
          {
            title: "Check it in Claude Code",
            body: "Start Claude Code in a terminal and type /mcp. pmcpg should be listed as connected.",
            picture: (
              <Win>
                <Terminal lines={["$ claude", "> /mcp", <span key="ok">pmcpg · <span className="text-green-400">✔ connected</span></span>]} />
              </Win>
            ),
          },
        ],
      };
    case "cursor":
      return {
        label: "Cursor",
        steps: autoSteps(
          "cursor",
          "Cursor",
          "Restart Cursor, or reload the window.",
          "Open Cursor Settings and find the MCP section. pmcpg should be listed and turned on.",
          listPicture("Cursor Settings · MCP"),
        ),
      };
    case "vscode":
      return {
        label: "VS Code",
        steps: autoSteps(
          "vscode",
          "VS Code",
          "Reload the VS Code window (Command Palette → Developer: Reload Window).",
          "Open the Command Palette and run “MCP: List Servers”. pmcpg should be listed; start it if it is stopped.",
          listPicture("MCP: List Servers"),
        ),
      };
    case "lm-studio":
      return {
        label: "LM Studio",
        steps: autoSteps(
          "lm-studio",
          "LM Studio",
          "Restart LM Studio.",
          "In a chat, open the tools (plug) menu. pmcpg should be listed; turn it on.",
          listPicture("Integrations"),
        ),
      };
    case "perplexity":
      return {
        label: "Perplexity",
        steps: [
          {
            title: "Open Connectors",
            body: "In the Perplexity Mac app, open Settings → Connectors and add a connector.",
            picture: (
              <Win>
                <div className="grid w-32 content-start gap-0.5 border-r p-2">
                  <MenuItem>Account</MenuItem>
                  <MenuItem hi>Connectors</MenuItem>
                </div>
                <div className="flex flex-1 items-start justify-end p-3">
                  <span className="rounded-md border px-2 py-1">+ Add connector</span>
                </div>
              </Win>
            ),
          },
          {
            title: "Paste the command",
            body: "Name it pmcpg and paste this command. pMCPg passes its token for you.",
            picture: (
              <Win>
                <div className="grid flex-1 content-start gap-2 p-3">
                  <FakeInput label="Name" value="pmcpg" />
                  <FakeInput label="Command" value={`pmcpg connect ${profile}`} />
                </div>
              </Win>
            ),
            extra: <CodeBlock code={`pmcpg connect ${profile}`} />,
          },
        ],
      };
  }
}

/** Every app with a logo has a tour. */
export type TourApp = LogoId;

/** Step-by-step dialog for one app. */
export function AppTour({
  app,
  profile,
  open,
  onOpenChange,
}: {
  app: TourApp;
  profile: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { info, error } = useConnectInfo(profile, open);
  const [i, setI] = useState(0);
  const { label, steps } = tourFor(app, info, profile);
  const step = steps[Math.min(i, steps.length - 1)];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setI(0);
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AppLogo app={app} size="sm" />
            Add pMCPg to {label}
          </DialogTitle>
          <DialogDescription>
            Step {i + 1} of {steps.length}. The pictures are simplified; your app may look a little different.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" aria-hidden="true">
          {steps.map((s, n) => (
            <span key={s.title} className={cn("h-1 flex-1 rounded-full", n <= i ? "bg-brand" : "bg-muted")} />
          ))}
        </div>
        <div className="rounded-xl bg-muted/40 p-3">{step.picture}</div>
        <div className="grid gap-1">
          <p className="font-medium">
            {i + 1}. {step.title}
          </p>
          <p className="text-muted-foreground">{step.body}</p>
        </div>
        {step.extra}
        <ErrorNote error={error} />
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => setI(i - 1)} disabled={i === 0}>
            <ArrowLeftIcon />
            Back
          </Button>
          {i < steps.length - 1 ? (
            <Button onClick={() => setI(i + 1)}>
              Next
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
