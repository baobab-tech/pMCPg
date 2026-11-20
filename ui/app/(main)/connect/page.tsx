"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/common";
import { ConnectApps, WhereItWorks } from "@/components/onboarding/connect-apps";

function ConnectInner() {
  const params = useSearchParams();
  return (
    <>
      <PageHeader
        title="Connect your AI app"
        description="Pick the app you use. pMCPg shows what it will change, keeps a backup, and does it for you. “Show me how” on each app walks you through it."
      />
      <div className="mb-5">
        <WhereItWorks />
      </div>
      <ConnectApps initialProfile={params.get("profile") ?? "all"} initialApp={params.get("app") ?? undefined} />
    </>
  );
}

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectInner />
    </Suspense>
  );
}
