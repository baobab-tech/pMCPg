"use client";

import Link from "next/link";
import { useAudience } from "@/components/audience";
import { Button } from "@/components/ui/button";

export function HeroCta() {
  const { audience } = useAudience();
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Button size="lg" nativeButton={false} className="bg-brand text-primary-foreground hover:bg-brand/90" render={<a href="#install" />}>
        Install
      </Button>
      <Button size="lg" variant="outline" nativeButton={false} render={<Link href={audience.cta.href} />}>
        {audience.cta.label}
      </Button>
    </div>
  );
}
