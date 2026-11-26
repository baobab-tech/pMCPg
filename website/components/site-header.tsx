import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { latestRelease } from "@/lib/release";
import { GITHUB } from "@/lib/site";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#teams", label: "Teams" },
  { href: "/help/", label: "Guides" },
  { href: "/why/", label: "Why" },
];

export async function SiteHeader() {
  const release = await latestRelease();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-heading text-[17px] font-bold tracking-tight">
          <Logo />
          pMCPg
        </Link>
        <a
          href="/#download"
          className="hidden rounded-full border px-2.5 py-0.5 text-xs text-brand hover:border-brand sm:inline"
        >
          Download v{release.version}
        </a>
        <nav className="ml-auto hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Link
            href="/why/"
            className="rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            Why
          </Link>
          <a
            href={GITHUB}
            className="rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
