"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, type Session, setUnauthorizedHandler } from "@/lib/api";

interface SessionContextValue {
  session: Session;
  refresh: () => Promise<Session>;
  setSession: (s: Session) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/**
 * Loads the session and routes: not signed in → /login, first run → /setup.
 * `mode` says which kind of page this is, so it does not redirect to itself.
 */
export function SessionProvider({ children, mode }: { children: ReactNode; mode: "app" | "login" | "setup" }) {
  const [session, setSession] = useState<Session | undefined>();
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    const s = await api.session();
    setSession(s);
    return s;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => router.replace("/login/"));
    void refresh();
  }, [refresh, router]);

  useEffect(() => {
    if (!session) return;
    if (mode === "app") {
      if (!session.authenticated) router.replace(session.passwordSet ? "/login/" : "/setup/");
      else if (!session.setupDone) router.replace("/setup/");
    } else if (mode === "login") {
      if (session.authenticated) router.replace("/");
      else if (!session.passwordSet) router.replace("/setup/");
    } else if (mode === "setup") {
      if (!session.authenticated && session.passwordSet) router.replace("/login/");
    }
  }, [session, mode, router]);

  const ready =
    session &&
    (mode === "app"
      ? session.authenticated && session.setupDone
      : mode === "login"
        ? !session.authenticated && session.passwordSet
        : session.authenticated || !session.passwordSet);

  if (session?.needsLaunchLink) return <LaunchLinkNeeded />;
  if (!session || !ready)
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground" data-path={pathname}>
        Loading…
      </div>
    );
  return <SessionContext.Provider value={{ session, refresh, setSession }}>{children}</SessionContext.Provider>;
}

/** Without a password, the UI opens only through a one-time link, so other local users cannot take it over. */
function LaunchLinkNeeded() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="max-w-md space-y-3 text-sm">
        <h1 className="text-lg font-semibold">Open pMCPg from your computer</h1>
        <p>For your safety, this page opens only through a one-time link.</p>
        <p>
          Run <code className="rounded bg-muted px-1 py-0.5 font-mono">pmcpg open</code> in a terminal on this
          computer. It opens the web UI signed in.
        </p>
        <p className="text-muted-foreground">
          Set a password in Settings to sign in with it instead.
        </p>
      </div>
    </div>
  );
}
