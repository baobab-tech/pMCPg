"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Switch light or dark theme"
    >
      <SunIcon className="hidden size-4 dark:block" />
      <MoonIcon className="size-4 dark:hidden" />
    </button>
  );
}
