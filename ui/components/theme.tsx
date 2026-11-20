"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { MotionConfig } from "motion/react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemes>
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Switch light or dark"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </Button>
  );
}
