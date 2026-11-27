"use client";

import {
  ActivityIcon,
  BoxesIcon,
  CableIcon,
  CircleHelpIcon,
  DownloadIcon,
  HomeIcon,
  KeyRoundIcon,
  LayersIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Logo } from "@/components/logo";
import { useSession } from "@/components/session";
import { ThemeToggle } from "@/components/theme";
import { useView, ViewToggle } from "@/components/view";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, type Status } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  simpleLabel?: string;
  icon: typeof HomeIcon;
  /** In Simple view: always, never, or only when the status says there is something to see. */
  simple: boolean | ((s: Status) => boolean);
  badge?: (s: Status) => number | null;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon, simple: true },
  { href: "/servers/", label: "Servers", simpleLabel: "Connections", icon: BoxesIcon, simple: true },
  { href: "/import/", label: "Import", icon: DownloadIcon, simple: false },
  { href: "/profiles/", label: "Profiles", icon: LayersIcon, simple: false },
  {
    href: "/skills/",
    label: "Skills",
    icon: SparklesIcon,
    simple: (s) => !!s.features.skills,
    badge: (s) => s.skillReviews ?? null,
  },
  { href: "/connect/", label: "Connect your AI app", simpleLabel: "AI apps", icon: CableIcon, simple: true },
  {
    href: "/approvals/",
    label: "Approvals",
    icon: ShieldCheckIcon,
    simple: true,
    badge: (s) => s.pendingApprovals,
  },
  { href: "/activity/", label: "Activity", icon: ActivityIcon, simple: (s) => s.features.activity },
  {
    href: "/quarantine/",
    label: "Tool review",
    icon: ShieldAlertIcon,
    simple: (s) => !!s.quarantined,
    badge: (s) => s.quarantined,
  },
  // Logins are managed inside each server card; this list is for finer control.
  { href: "/accounts/", label: "All accounts", icon: KeyRoundIcon, simple: false },
  { href: "/settings/", label: "Settings", icon: SettingsIcon, simple: true },
  { href: "/help/", label: "Help", icon: CircleHelpIcon, simple: true },
];

export { Logo };

function HelpButton() {
  return (
    <Link href="/help/" aria-label="Help" title="Help" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
      <CircleHelpIcon />
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const { advanced } = useView();
  const { data: status } = useApi<Status>("/status", { pollMs: 15000 });
  const items = NAV.filter((n) =>
    advanced || n.simple === true ? true : typeof n.simple === "function" ? !!status && n.simple(status) : false,
  );
  return (
    <nav className="grid gap-0.5">
      {items.map(({ href, label: fullLabel, simpleLabel, icon: Icon, badge }) => {
        const label = !advanced && simpleLabel ? simpleLabel : fullLabel;
        const count = status && badge ? badge(status) : null;
        const active = href === "/" ? current === "/" : current.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
            {!!count && (
              <span className="ml-auto rounded-full bg-brand px-1.5 text-xs font-medium text-background tabular-nums">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const signOut = session.passwordSet ? (
    <Button
      variant="ghost"
      size="sm"
      className="justify-start"
      onClick={async () => {
        await api.logout().catch(() => {});
        router.replace("/login/");
      }}
    >
      <LogOutIcon />
      Sign out
    </Button>
  ) : null;

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar p-3 md:flex">
        <div className="px-2 py-2">
          <Logo />
        </div>
        <div className="mt-4 flex-1">
          <Nav />
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-1 pt-3 pb-2">
          <span className="text-xs text-muted-foreground">View</span>
          <ViewToggle />
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {signOut ?? <span className="px-2 text-xs text-muted-foreground">Local only</span>}
          <div className="flex items-center">
            <HelpButton />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2 md:hidden">
          <Logo />
          <div className="flex items-center gap-1">
            <HelpButton />
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
              <MenuIcon />
            </Button>
          </div>
        </header>
        {open && (
          <div className="border-b bg-sidebar p-3 md:hidden">
            <Nav onNavigate={() => setOpen(false)} />
            <div className="mt-2 flex items-center justify-between border-t px-1 pt-2">
              <span className="text-xs text-muted-foreground">View</span>
              <ViewToggle />
            </div>
            {signOut && <div className="mt-2 border-t pt-2">{signOut}</div>}
          </div>
        )}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
