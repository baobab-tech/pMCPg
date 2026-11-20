"use client";

// First-run wizard, two paths (docs/plans/onboarding-v2.md):
//   A "I already use MCP servers": import → replace in your app → done
//   F "This is my first time":     explain → pick a starter → sign in → connect → try it → done

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  LockIcon,
  LogInIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CopyButton, ErrorNote, Field } from "@/components/common";
import { PasswordHelp } from "@/components/info-tip";
import { Logo } from "@/components/logo";
import { AddByUrl } from "@/components/onboarding/add-by-url";
import { ConnectApps } from "@/components/onboarding/connect-apps";
import { ImportPanel } from "@/components/onboarding/import-panel";
import { McpChatDemo } from "@/components/onboarding/mcp-chat-demo";
import { McpFlow } from "@/components/onboarding/mcp-flow";
import { type Starter, StarterTiles, starterByUrl } from "@/components/onboarding/starters";
import { ProtectionCard } from "@/components/protection-card";
import type { AuthChoice } from "@/components/server-form";
import { SessionProvider, useSession } from "@/components/session";
import { SignInDialog } from "@/components/signin-dialog";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ViewToggle } from "@/components/view";
import {
  type ActivityEntry,
  type AppConnectStatus,
  api,
  type ConnectAppId,
  errorMessage,
  type ImportScan,
  type Listing,
  type Server,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Step =
  | "password"
  | "welcome"
  | "import"
  | "replace"
  | "explain"
  | "starter"
  | "signin"
  | "connect"
  | "try"
  | "done";

const PATH_A: { step: Step; label: string }[] = [
  { step: "import", label: "Bring them in" },
  { step: "replace", label: "Use pMCPg in your app" },
  { step: "done", label: "Done" },
];
const PATH_F: { step: Step; label: string }[] = [
  { step: "explain", label: "What it is" },
  { step: "starter", label: "Pick a service" },
  { step: "signin", label: "Sign in" },
  { step: "connect", label: "Connect your AI app" },
  { step: "try", label: "Try it" },
  { step: "done", label: "Done" },
];

function Steps({ path, current }: { path: { step: Step; label: string }[]; current: Step }) {
  const at = path.findIndex((p) => p.step === current);
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {path.map((p, i) => (
        <li key={p.step} className={cn("flex items-center gap-2", i === at ? "font-medium" : "text-muted-foreground")}>
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs",
              i < at && "border-brand bg-brand text-background",
              i === at && "border-brand text-brand",
            )}
          >
            {i < at ? "✓" : i + 1}
          </span>
          {p.label}
        </li>
      ))}
    </ol>
  );
}

function StepCard({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function Nav({ onBack, children }: { onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onBack && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
      )}
      {children}
    </div>
  );
}

/** Set the pMCPg password. `required` hides "Skip". */
function PasswordForm({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const { session, setSession } = useSession();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  return (
    <form
      className="grid max-w-sm gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        if (password !== again) return setError("The two passwords don't match.");
        try {
          setSession(await api.setupPassword(password, code || undefined));
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      {session.needsSetupCode && (
        <Field label="Setup code" htmlFor="setup-code" hint="Printed in pMCPg's log when it started. It proves you run this gateway.">
          <Input id="setup-code" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" autoComplete="off" />
        </Field>
      )}
      <Field label="Password" htmlFor="setup-pw" hint="At least 8 characters.">
        <Input id="setup-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Type it again" htmlFor="setup-pw2">
        <Input id="setup-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!password}>
          Set password
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip}>
            Not now
          </Button>
        )}
      </div>
    </form>
  );
}

function ChoiceCard({
  title,
  text,
  note,
  primary,
  onClick,
}: {
  title: string;
  text: string;
  note?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid gap-1.5 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        primary ? "border-brand bg-brand/5 hover:bg-brand/10" : "hover:bg-muted/50",
      )}
    >
      <span className="flex items-center justify-between gap-2 font-medium">
        {title}
        <ArrowRightIcon className="size-4 text-muted-foreground" />
      </span>
      <span className="text-sm text-muted-foreground">{text}</span>
      {note && <span className="text-xs font-medium text-brand">{note}</span>}
    </button>
  );
}

function Welcome({ onPick, onSkip }: { onPick: (path: "a" | "f") => void; onSkip: () => void }) {
  const [found, setFound] = useState<number>();
  useEffect(() => {
    api
      .get<ImportScan>("/import/scan")
      .then((s) => setFound(s.candidates.filter((c) => !c.alreadyAdded).length))
      .catch(() => setFound(0));
  }, []);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          pMCPg is a gateway for your MCP servers. It makes them simpler to manage and safer to use.
        </p>
      </div>
      <McpFlow />
      <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">This runs on your computer.</span> Nothing is sent to anyone
          else, except to the services you choose to add.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          title="I already use MCP servers"
          text="Bring them in from Claude, Cursor, VS Code or LM Studio, then let pMCPg look after them."
          note={found ? `Found ${found} on this computer` : undefined}
          primary={!!found}
          onClick={() => onPick("a")}
        />
        <ChoiceCard
          title="This is my first time"
          text="A short explanation, then help adding your first service."
          primary={found === 0}
          onClick={() => onPick("f")}
        />
      </div>
      <Button variant="link" className="w-fit justify-self-end px-0 text-muted-foreground" onClick={onSkip}>
        Skip setup
      </Button>
    </div>
  );
}

const WHY_NOT_BUILT_IN = [
  {
    title: "Set it up once.",
    body: "Connections added in Claude only work in Claude. The same goes for ChatGPT. Connections in pMCPg work in every AI app, so you can switch apps without starting over.",
  },
  {
    title: "Fewer tools, better picks.",
    body: "Each MCP server adds dozens of tools. With many on, the AI slows down, picks the wrong ones, and you end up turning servers on and off by hand. pMCPg searches your tools and shows the AI only the ones the task needs.",
  },
  {
    title: "Profiles.",
    body: "Built-in managers keep one list for everything. pMCPg groups connections into profiles, like Work and Personal, and gives each app only the profile it needs.",
  },
  {
    title: "Your keys, your rules.",
    body: "Keys stay on this computer. pMCPg asks before risky actions, hides personal details, and keeps one activity log for all your apps.",
  },
];

/** Closed explainer: why use pMCPg instead of an AI app's own MCP settings. */
function WhyNotBuiltIn() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="why-not-built-in"
      >
        Why can't I just use Claude or ChatGPT's MCP manager?
        <ChevronDownIcon className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul id="why-not-built-in" className="grid list-disc gap-2 border-t py-3 pr-3 pl-7 text-sm">
          {WHY_NOT_BUILT_IN.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}</span> {item.body}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Explain({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <StepCard title="What is an MCP server?">
      <McpChatDemo />
      <p className="text-sm">
        <span className="font-medium">An MCP server gives your AI app a skill</span>, like reading your notes or
        searching your team's issues. There are data MCPs, research MCPs, email MCPs and many more. pMCPg calls each
        one a connection.
      </p>
      <WhyNotBuiltIn />
      <details className="group rounded-xl border px-3 py-2 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium">
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          What pMCPg does
        </summary>
        <ul className="mt-2 grid list-disc gap-1.5 pl-9 text-muted-foreground">
          <li>Keeps the keys on this computer, hides personal details, and asks you before anything risky.</li>
          <li>You connect your AI app once. Every connection you add later just appears in it.</li>
          <li>No lock-in to Claude or ChatGPT. Every AI app reuses the same single connection to pMCPg.</li>
          <li>Keeps your AI app focused. It searches for the few tools it needs instead of loading hundreds.</li>
        </ul>
      </details>
      <Nav onBack={onBack}>
        <Button onClick={onNext}>
          Add my first connection
          <ArrowRightIcon />
        </Button>
      </Nav>
    </StepCard>
  );
}

/** Waits for the AI app's first tool call through pMCPg. */
function TryIt({
  starter,
  serverName,
  onNext,
  onBack,
}: {
  starter?: Starter;
  serverName?: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const [since] = useState(() => Date.now());
  const [seen, setSeen] = useState<ActivityEntry>();
  const [available, setAvailable] = useState(true);
  const prompt =
    starter?.prompt ?? (serverName ? `Using ${serverName}, what can you do for me?` : "What tools can you use through pMCPg?");

  useEffect(() => {
    if (seen) return;
    const poll = async () => {
      try {
        for (const type of ["call", "search"] as const) {
          const r = await api.get<Listing<ActivityEntry>>(`/activity?type=${type}&limit=1`);
          if (!r.available) return setAvailable(false);
          const hit = r.items.find((e) => e.at >= since);
          if (hit) return setSeen(hit);
        }
      } catch {
        // Keep waiting; the user can skip.
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => clearInterval(t);
  }, [since, seen]);

  return (
    <StepCard title="Try it" description="Open your AI app (restart it if it was open) and ask:">
      <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3">
        <SparklesIcon className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="flex-1 text-sm">{prompt}</p>
        <CopyButton value={prompt} />
      </div>
      {available &&
        (seen ? (
          <p className="flex items-center gap-2 text-sm font-medium text-brand">
            <CheckCircle2Icon className="size-4" />
            {seen.event.type === "call"
              ? `pMCPg saw your app use ${String(seen.event.tool ?? "a tool").split("__")[0]}.`
              : "pMCPg saw your app look for tools. It works."}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-50" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
            </span>
            Waiting for your AI app…
          </p>
        ))}
      <Nav onBack={onBack}>
        <Button variant={seen ? "default" : "ghost"} onClick={onNext}>
          {seen ? "Next" : "Skip"}
        </Button>
      </Nav>
    </StepCard>
  );
}

function Done({ onFinish, error }: { onFinish: (to?: string) => void; error?: string }) {
  const { session } = useSession();
  const [servers, setServers] = useState<number>();
  const [apps, setApps] = useState<AppConnectStatus[]>([]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => {
    api
      .get<Server[]>("/servers")
      .then((s) => setServers(s.length))
      .catch(() => {});
    api
      .get<AppConnectStatus[]>("/connect/status")
      .then(setApps)
      .catch(() => {});
  }, []);
  const connected = apps.filter((a) => a.connected).map((a) => a.label);
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex items-start gap-3">
          <CheckCircle2Icon className="mt-0.5 size-6 shrink-0 text-brand" />
          <div>
            <p className="text-lg font-semibold">You're set</p>
            <p className="text-sm text-muted-foreground">
              {servers === undefined
                ? ""
                : `${servers} connection${servers === 1 ? "" : "s"}${
                    connected.length ? `, used by ${connected.join(", ")}` : ". Connect an AI app any time from AI apps"
                  }.`}
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm font-medium">Next, if you like</p>

      {!session.passwordSet && (
        <StepCard
          title={
            <>
              Protect this page with a password
              <PasswordHelp />
            </>
          }
          description="Recommended if other people use this computer."
        >
          {passwordOpen ? (
            <PasswordForm onDone={() => setPasswordOpen(false)} onSkip={() => setPasswordOpen(false)} />
          ) : (
            <Button variant="outline" className="w-fit" onClick={() => setPasswordOpen(true)}>
              <LockIcon />
              Set a password
            </Button>
          )}
        </StepCard>
      )}

      <ProtectionCard />

      <Card>
        <CardContent className="flex items-start gap-3 text-sm">
          <LayersIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Different apps, different connections?</span> Every AI app sees
            all your connections for now. Profiles let you give each app only some; find them in Advanced view.{" "}
            <button type="button" className="underline underline-offset-3" onClick={() => onFinish("/profiles/")}>
              Open profiles
            </button>
          </p>
        </CardContent>
      </Card>

      <ErrorNote error={error} />
      <Button className="w-fit" onClick={() => onFinish()}>
        Go to Home
        <ArrowRightIcon />
      </Button>
    </div>
  );
}

function SetupWizard() {
  const { session } = useSession();
  const mustSetPassword = session.passwordRequired && !session.passwordSet;
  const [step, setStepRaw] = useState<Step>(mustSetPassword ? "password" : "welcome");
  const [path, setPath] = useState<"a" | "f">();
  const [history, setHistory] = useState<Step[]>([]);
  const [importedFrom, setImportedFrom] = useState<ConnectAppId[]>([]);
  const [starterUrl, setStarterUrl] = useState<string>();
  const [server, setServer] = useState<{ server: Server; auth: AuthChoice }>();
  const [signingIn, setSigningIn] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [connectedApp, setConnectedApp] = useState<ConnectAppId>();
  const [error, setError] = useState<string>();

  const go = (s: Step) => {
    setHistory((h) => [...h, step]);
    setStepRaw(s);
  };
  const back = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setStepRaw(prev);
  };

  async function finish(to = "/") {
    try {
      await api.post("/setup/done");
      // Full load, so the app's session context starts fresh.
      window.location.assign(to);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const starter = starterByUrl(starterUrl);
  const account = server?.server.accounts[0];
  const pathSteps = path === "a" ? PATH_A : path === "f" ? PATH_F : undefined;

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="flex items-center justify-between gap-2">
        <Logo full />
        <div className="flex items-center gap-2">
          <ViewToggle />
          <ThemeToggle />
        </div>
      </div>
      {pathSteps && step !== "welcome" && step !== "password" && <Steps path={pathSteps} current={step} />}

      {step === "password" && (
        <StepCard
          title={
            <>
              Set a password for this page
              <PasswordHelp />
            </>
          }
          description="pMCPg is reachable from other machines, so a password is required."
        >
          <PasswordForm onDone={() => go("welcome")} />
        </StepCard>
      )}

      {step === "welcome" && (
        <Welcome
          onPick={(p) => {
            setPath(p);
            go(p === "a" ? "import" : "explain");
          }}
          onSkip={() => void finish()}
        />
      )}

      {step === "import" && (
        <StepCard
          title="Bring in your MCP servers"
          description="Pick the ones pMCPg should look after."
        >
          <ImportPanel
            onPasteUrl={() => {
              setPath("f");
              go("starter");
            }}
            onDone={(apps) => {
              setImportedFrom(apps);
              go("replace");
            }}
            onBack={back}
          />
        </StepCard>
      )}

      {step === "replace" && (
        <StepCard
          title="Use pMCPg in your AI app"
          description="Your app gets one pMCPg entry with all your connections. pMCPg shows what changes and keeps a backup. It can also remove the old entries, so tools don't show up twice."
        >
          <ConnectApps initialApp={importedFrom[0]} onConnected={setConnectedApp} />
          <Nav onBack={back}>
            <Button variant={connectedApp ? "default" : "ghost"} onClick={() => go("done")}>
              {connectedApp ? "Next" : "Skip for now"}
            </Button>
          </Nav>
        </StepCard>
      )}

      {step === "explain" && <Explain onBack={back} onNext={() => go("starter")} />}

      {step === "starter" && (
        <StepCard title="Pick a service" description="Start with one. You can add more any time.">
          <StarterTiles value={starterUrl} onPick={setStarterUrl} />
          <AddByUrl
            url={starterUrl}
            onAdded={(s, auth) => {
              setServer({ server: s, auth });
              setSignedIn(false);
              go(auth === "oauth" ? "signin" : "connect");
            }}
          />
          <Nav onBack={back}>
            <Button variant="link" className="w-fit text-muted-foreground" onClick={() => go("connect")}>
              I'll add one later
            </Button>
          </Nav>
        </StepCard>
      )}

      {step === "signin" && server && account && (
        <StepCard
          title={`Sign in to ${server.server.name}`}
          description="You log in on the provider's own page. pMCPg keeps the sign-in encrypted on this computer."
        >
          <Nav onBack={back}>
            {signedIn ? (
              <span className="flex items-center gap-2 text-sm font-medium text-brand">
                <CheckCircle2Icon className="size-4" />
                Signed in
              </span>
            ) : (
              <Button onClick={() => setSigningIn(true)}>
                <LogInIcon />
                Sign in
              </Button>
            )}
            <Button variant={signedIn ? "default" : "ghost"} onClick={() => go("connect")}>
              {signedIn ? "Next" : "Skip for now"}
            </Button>
          </Nav>
          <SignInDialog accountId={account} open={signingIn} onOpenChange={setSigningIn} onSignedIn={() => setSignedIn(true)} />
        </StepCard>
      )}

      {step === "connect" && (
        <StepCard
          title="Connect your AI app"
          description="Pick the app you use. pMCPg shows the change, keeps a backup, and does it for you."
        >
          <ConnectApps onConnected={setConnectedApp} />
          <Nav onBack={back}>
            <Button variant={connectedApp ? "default" : "ghost"} onClick={() => go(connectedApp ? "try" : "done")}>
              {connectedApp ? "Next: try it" : "Skip for now"}
            </Button>
          </Nav>
        </StepCard>
      )}

      {step === "try" && (
        <TryIt starter={starter} serverName={server?.server.name} onBack={back} onNext={() => go("done")} />
      )}

      {step === "done" && <Done onFinish={finish} error={error} />}
      {step !== "welcome" && step !== "done" && step !== "password" && <ErrorNote error={error} />}
    </div>
  );
}

export default function SetupPage() {
  return (
    <SessionProvider mode="setup">
      <div className="min-h-svh p-4 py-10 sm:p-10">
        <SetupWizard />
      </div>
    </SessionProvider>
  );
}
