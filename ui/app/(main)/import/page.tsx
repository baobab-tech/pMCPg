"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/common";
import { ImportPanel } from "@/components/onboarding/import-panel";

export default function ImportPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Import from your AI apps"
        description="Servers you already set up in Claude Desktop, Claude Code, LM Studio, Cursor or VS Code, or in a server list file someone exported. Your keys stay out of it: you type them here."
      />
      <ImportPanel onPasteUrl={() => router.push("/servers/?add=1")} />
    </>
  );
}
