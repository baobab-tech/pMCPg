import Link from "next/link";
import { Logo } from "@/components/logo";
import { DOCS, GITHUB, ISSUES, RELEASE, ROADMAP, SECURITY } from "@/lib/site";

export function SiteFooter() {
  const links = [
    { href: GITHUB, label: "GitHub" },
    { href: RELEASE, label: "Releases" },
    { href: DOCS, label: "Docs" },
    { href: SECURITY, label: "Security" },
    { href: ROADMAP, label: "Roadmap" },
    { href: ISSUES, label: "Issues" },
  ];
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted-foreground md:grid-cols-[1fr_auto]">
        <div className="grid gap-2">
          <span className="flex items-center gap-2 font-heading font-bold text-foreground">
            <Logo className="size-6" /> Private MCP Gateway
          </span>
          <p>Apache 2.0. Built by Baobab Tech, with a focus on social impact organizations.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/help/" className="hover:text-foreground">
            Guides
          </Link>
          {links.map((l) => (
            <a key={l.label} href={l.href} className="hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
