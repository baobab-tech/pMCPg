"use client";

import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider mode="app">
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
