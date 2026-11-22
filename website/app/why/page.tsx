import { ArrowRightIcon, HeartIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GITHUB, ISSUES, ROADMAP } from "@/lib/site";

export const metadata: Metadata = {
  title: "Why",
  description:
    "Baobab Tech is a small tech practice building AI tools for social impact. Organizations should control their data and their connectors.",
};

const MEANS = [
  { title: "It runs where you are", body: "On your computer, or on your own server with Docker. Not in our cloud: we run no service that holds your data." },
  {
    title: "Your connectors stay yours",
    body: "Your connector list and sign-ins live in your keychain, not in an AI vendor's account. Switch AI apps without setting everything up again.",
  },
  { title: "We hold nothing", body: "No account, no telemetry, no update ping. Baobab Tech never sees your data, your keys or how you use it." },
  { title: "You decide what the AI can do", body: "Rules, approvals and an activity log you keep. Masking for what connectors send to a cloud model." },
  { title: "Open source", body: "Apache 2.0. Read the code, audit it, fork it, run your own." },
  { title: "Small on purpose", body: "Few features, done well. One binary you can understand." },
];

export default function Why() {
  return (
    <main>
      <section className="relative overflow-x-clip border-b">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_20%_0%,var(--brand-soft),transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl px-4 pt-16 pb-14">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <HeartIcon className="size-3.5 fill-rose-500 text-rose-500" /> Built by Baobab Tech
          </p>
          <h1 className="text-[clamp(2rem,5vw,3.2rem)] leading-[1.06] font-bold tracking-tight text-balance">
            Small tech, so your organization keeps control
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Baobab Tech is a small tech practice. We build AI tools for social impact organizations: nonprofits, NGOs,
            foundations and development agencies.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-3xl gap-14 px-4 py-14">
        <section>
          <h2 className="text-2xl font-bold tracking-tight">Not the Big Tech way</h2>
          <div className="mt-4 grid gap-4 text-muted-foreground">
            <p>
              Today, connecting AI to your work usually means handing it to a few cloud companies. Your connectors, the
              sign-ins behind them and the data they reach sit in a vendor's account, on the vendor's terms. Change
              vendors and you start again.
            </p>
            <p>
              We think it should work the other way round.{" "}
              <b className="text-foreground">
                Organizations should be in control of their data, and of the connectors that reach it.
              </b>{" "}
              The AI app is a guest: it gets the tools a task needs, under rules you set, and you can see what it did.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold tracking-tight">What that means in pMCPg</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {MEANS.map((m) => (
              <div key={m.title} className="rounded-2xl border bg-card p-5">
                <h3 className="font-semibold">{m.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{m.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold tracking-tight">Who it's for</h2>
          <div className="mt-4 grid gap-4 text-muted-foreground">
            <p>
              Anyone can use pMCPg. We build it with social impact organizations in mind: small teams with sensitive
              data, little IT time, and funders and communities who expect that data to be looked after.
            </p>
            <p>
              A catalog with presets for fundraising, grants research, M&amp;E and reporting, communications and program
              data, with strict privacy defaults, is coming.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-brand/40 bg-[linear-gradient(100deg,var(--brand-soft),transparent_70%)] p-6">
          <h2 className="text-xl font-bold tracking-tight">Build it with us</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            pMCPg is open source. Tell us what your organization needs, or send a fix.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
            <a href={GITHUB} className="text-brand hover:underline">
              GitHub
            </a>
            <a href={ISSUES} className="text-brand hover:underline">
              Issues
            </a>
            <a href={ROADMAP} className="text-brand hover:underline">
              Roadmap
            </a>
            <Link href="/#install" className="inline-flex items-center gap-1 text-brand hover:underline">
              Install pMCPg <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
