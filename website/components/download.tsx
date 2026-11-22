"use client";

import { DownloadIcon, MonitorIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CopyLine } from "@/components/copy-line";
import { type Release, TARGETS, type TargetId } from "@/lib/release";
import { INSTALL, RELEASE } from "@/lib/site";
import { cn } from "@/lib/utils";

type Os = "mac" | "windows" | "linux";
const OS_LABEL: Record<Os, string> = { mac: "Mac", windows: "Windows", linux: "Linux" };
const MAIN = TARGETS.filter((t) => !("musl" in t));
const MUSL = TARGETS.filter((t) => "musl" in t);

/** Best guess at the visitor's platform. Safari and Firefox on a Mac don't say which chip; Apple silicon is the default. */
async function detect(): Promise<{ target: TargetId | null; sure: boolean }> {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|Android/i.test(ua)) return { target: null, sure: false };
  let arm: boolean | null = /aarch64|arm64|armv8/i.test(ua) ? true : null;
  const uad = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ architecture?: string }> };
  }).userAgentData;
  if (uad) {
    try {
      const v = await uad.getHighEntropyValues(["architecture"]);
      if (v.architecture) arm = v.architecture === "arm";
    } catch {}
  }
  if (/Windows/i.test(ua)) return { target: arm ? "windows-arm64" : "windows-x64", sure: arm !== null };
  if (/Macintosh|Mac OS X/i.test(ua)) return { target: arm === false ? "darwin-x64" : "darwin-arm64", sure: arm !== null };
  if (/Linux/i.test(ua)) return { target: arm ? "linux-arm64" : "linux-x64", sure: arm !== null };
  return { target: null, sure: false };
}

function osOf(t: TargetId): Os {
  return t.startsWith("darwin") ? "mac" : t.startsWith("windows") ? "windows" : "linux";
}

const AFTER: Record<Os, { unpack: React.ReactNode }> = {
  mac: {
    unpack: (
      <>
        Double-click it to unpack. Then, in Terminal in that folder, clear the Gatekeeper flag (v0.1 isn't notarized yet) and move pmcpg onto your path:
        <CopyLine className="mt-2" text="xattr -d com.apple.quarantine pmcpg && sudo mv pmcpg /usr/local/bin/" />
      </>
    ),
  },
  windows: {
    unpack: (
      <>
        Unzip it. If Windows shows "Windows protected your PC", choose <b>More info</b>, then <b>Run anyway</b>. Or
        unblock it in PowerShell first:
        <CopyLine className="mt-2" text="Unblock-File .\pmcpg.exe" />
      </>
    ),
  },
  linux: {
    unpack: (
      <>
        Unpack it and move <code className="rounded bg-muted px-1 font-mono text-[0.9em]">pmcpg</code> onto your path,
        for example <code className="rounded bg-muted px-1 font-mono text-[0.9em]">~/.local/bin</code>.
      </>
    ),
  },
};

export function Download({ release }: { release: Release }) {
  const [target, setTarget] = useState<TargetId>("darwin-arm64");
  const [guess, setGuess] = useState<{ target: TargetId | null; sure: boolean } | null>(null);

  useEffect(() => {
    detect().then((g) => {
      setGuess(g);
      if (g.target) setTarget(g.target);
    });
  }, []);

  const os = osOf(target);
  const t = TARGETS.find((x) => x.id === target) ?? TARGETS[0];
  const file = release.files[target];
  const date = new Date(release.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const pickOs = (o: Os) => setTarget(o === "mac" ? "darwin-arm64" : o === "windows" ? "windows-x64" : "linux-x64");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          <b className="text-foreground">pMCPg {release.version}</b> · released {date}
        </p>
        <a href={RELEASE} className="text-brand underline underline-offset-3">
          All releases and checksums
        </a>
      </div>

      {guess && !guess.target && (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          <MonitorIcon className="size-4 shrink-0 text-brand" />
          pMCPg runs on a computer. Open this page on your Mac, Windows or Linux machine, or pick one below.
        </p>
      )}

      <div className="rounded-2xl border border-brand/50 bg-card p-5 shadow-[0_0_60px_-30px_var(--brand)] sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xl font-bold tracking-tight">For {t.label}</h3>
          <div className="inline-flex rounded-lg border bg-panel p-0.5 text-sm" role="tablist" aria-label="Operating system">
            {(Object.keys(OS_LABEL) as Os[]).map((o) => (
              <button
                key={o}
                type="button"
                role="tab"
                aria-selected={os === o}
                onClick={() => pickOs(o)}
                className={cn(
                  "rounded-md px-3 py-1",
                  os === o ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {OS_LABEL[o]}
              </button>
            ))}
          </div>
        </div>
        {guess?.target && os === osOf(guess.target) && target === "darwin-arm64" && !guess.sure && (
          <p className="mt-2 text-xs text-muted-foreground">
            Not sure which Mac you have? Apple menu → About This Mac: "Chip" means Apple silicon, "Processor" means
            Intel.
          </p>
        )}

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-semibold tracking-wide text-brand uppercase">Recommended</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Paste this into {os === "windows" ? "PowerShell" : "Terminal"}. It checks the download, starts pMCPg at
              login, adds a pMCPg launcher with your apps, and opens the web UI. Run it again to upgrade.
            </p>
            <CopyLine className="mt-3" text={os === "windows" ? INSTALL.windows : INSTALL.unix} />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Or download it</p>
            {file ? (
              <a
                href={file}
                className="mt-2.5 flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <DownloadIcon className="size-4" />
                Download for {t.label}
              </a>
            ) : (
              <p className="mt-2.5 text-sm text-muted-foreground">Not in this release.</p>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">.{t.ext} · {release.version}</p>
          </div>
        </div>

        <div className="mt-7 border-t pt-5">
          <p className="text-sm font-semibold">After a direct download</p>
          <ol className="mt-3 grid gap-3 text-sm text-muted-foreground">
            <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
              <span className="font-semibold text-brand">1</span>
              <div>{AFTER[os].unpack}</div>
            </li>
            <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
              <span className="font-semibold text-brand">2</span>
              <div>
                {os === "windows"
                  ? "Move pmcpg.exe to a folder you keep. In PowerShell, in that folder, start it at login and open the web UI. This also adds a pMCPg launcher to the Start menu:"
                  : "Start it at login and open the web UI. This also adds a pMCPg launcher with your apps:"}
                <CopyLine
                  className="mt-2"
                  text={os === "windows" ? ".\\pmcpg.exe service install; .\\pmcpg.exe open" : "pmcpg service install && pmcpg open"}
                />
              </div>
            </li>
            <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-2">
              <span className="font-semibold text-brand">3</span>
              <div>
                In the web UI, import the servers from your AI apps or paste a server's URL. Then connect your AI app.
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold">All platforms</p>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {MAIN.map((x) => {
            const href = release.files[x.id];
            return (
              <div
                key={x.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border bg-card py-2 pr-2 pl-3.5 text-sm",
                  x.id === target && "border-brand",
                )}
              >
                <button type="button" onClick={() => setTarget(x.id)} className="min-w-0 truncate text-left hover:text-brand">
                  {x.label}
                </button>
                {href && (
                  <a
                    href={href}
                    aria-label={`Download for ${x.label}`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-brand"
                  >
                    <DownloadIcon className="size-4" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Alpine / musl:{" "}
          {MUSL.map((x, i) => (
            <span key={x.id}>
              {i > 0 && " · "}
              {release.files[x.id] ? (
                <a href={release.files[x.id]} className="text-brand underline underline-offset-3">
                  {x.id.includes("arm64") ? "ARM64" : "x64"}
                </a>
              ) : (
                x.label
              )}
            </span>
          ))}
        </p>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold">For developers</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 md:grid-cols-3">
          {[
            { label: "npm", cmd: INSTALL.npm },
            { label: "Homebrew", cmd: INSTALL.brew },
            { label: "Docker", cmd: INSTALL.docker },
          ].map((d) => (
            <div key={d.label}>
              <p className="mb-1 text-xs text-muted-foreground">{d.label}</p>
              <CopyLine text={d.cmd} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
