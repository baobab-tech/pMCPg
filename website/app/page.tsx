import { HeartIcon } from "lucide-react";
import Link from "next/link";
import { AudienceCopy, AudienceProvider, AudienceToggle } from "@/components/audience";
import { BeforeAfter } from "@/components/before-after";
import { HeroCta } from "@/components/hero-cta";
import { LiveExample } from "@/components/live-example";
import { Features, HowItWorks, Install, InstallTabs, Privacy, Teams } from "@/components/sections";

export default function Home() {
  return (
    <AudienceProvider>
      <main>
        <section className="relative overflow-x-clip">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_45%_at_75%_30%,var(--brand-soft),transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-12 px-4 pt-12 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start lg:gap-14">
            <div className="lg:pt-6">
              <Link
                href="/why/"
                className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
              >
                Built with <HeartIcon className="size-3.5 fill-rose-500 text-rose-500" />
                by Baobab Tech
                <span className="whitespace-nowrap text-brand">Why →</span>
              </Link>
              <div>
                <AudienceToggle />
              </div>
              <div className="mt-7">
                <AudienceCopy />
              </div>
              <HeroCta />
              <div className="mt-7 max-w-xl">
                <InstallTabs compact />
              </div>
            </div>
            <BeforeAfter />
          </div>
        </section>

        <section className="relative overflow-x-clip border-t py-20 sm:py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_0%,var(--brand-soft),transparent_70%)]" />
          <div className="relative mx-auto max-w-6xl px-4">
            <h2 className="text-center text-[clamp(1.6rem,3.4vw,2.4rem)] font-bold tracking-tight">
              One question, two connectors
            </h2>
            <p className="mx-auto mt-3 mb-12 max-w-xl text-center text-muted-foreground">
              Follow one request from Claude, through pMCPg, to DevExplorer and your CRM and back.
            </p>
            <LiveExample />
          </div>
        </section>

        <HowItWorks />
        <Features />
        <Privacy />
        <Teams />
        <Install />
      </main>
    </AudienceProvider>
  );
}
