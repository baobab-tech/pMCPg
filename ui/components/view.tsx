"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Simple / Advanced view. A per-browser preference in localStorage; Simple by default.
// Simple hides details; it never removes a capability: every hidden control is one switch away.

export type View = "simple" | "advanced";

const KEY = "pmcpg.view";

interface ViewContextValue {
  view: View;
  advanced: boolean;
  setView: (v: View) => void;
}

const ViewContext = createContext<ViewContextValue>({ view: "simple", advanced: false, setView: () => {} });

function read(): View {
  try {
    return localStorage.getItem(KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>("simple");

  useEffect(() => {
    setViewState(read());
    // Keep several tabs in step.
    const onStorage = (e: StorageEvent) => e.key === KEY && setViewState(read());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Private window or blocked storage: the choice lasts for this page only.
    }
  }, []);

  return <ViewContext.Provider value={{ view, advanced: view === "advanced", setView }}>{children}</ViewContext.Provider>;
}

export function useView(): ViewContextValue {
  return useContext(ViewContext);
}

/** Renders its children only in Advanced view. */
export function AdvancedOnly({ children }: { children: ReactNode }) {
  return useView().advanced ? children : null;
}

/** Renders its children only in Simple view. */
export function SimpleOnly({ children }: { children: ReactNode }) {
  return useView().advanced ? null : children;
}

/** "Simple · Advanced" segmented switch. */
export function ViewToggle({ className }: { className?: string }) {
  const { view, setView } = useView();
  return (
    <div role="radiogroup" aria-label="View" className={cn("inline-flex rounded-md border p-0.5 text-xs", className)}>
      {(["simple", "advanced"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => setView(v)}
          className={cn(
            "rounded-[5px] px-2 py-1 capitalize transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/** Shown in Simple view where options are hidden; switches to Advanced. */
export function MoreInAdvanced({ label = "More options in Advanced view" }: { label?: string }) {
  const { setView } = useView();
  return (
    <button
      type="button"
      onClick={() => setView("advanced")}
      className="w-fit text-left text-xs text-muted-foreground underline-offset-3 hover:text-foreground hover:underline"
    >
      {label}
    </button>
  );
}
