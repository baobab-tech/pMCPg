"use client";

import { EyeIcon, EyeOffIcon, HourglassIcon, ShieldCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyConfirm } from "@/components/watermelon/copy-confirm";
import type { AccountState } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

const STATE_LABEL: Record<AccountState["status"], string> = {
  connected: "Connected",
  stopped: "Idle",
  starting: "Starting",
  "sign-in-needed": "Sign-in needed",
  unreachable: "Can't reach",
  error: "Error",
};

export function StateBadge({ state }: { state: AccountState }) {
  const tone =
    state.status === "connected"
      ? "bg-brand/15 text-brand"
      : state.status === "sign-in-needed" || state.status === "unreachable"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : state.status === "error"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={cn("gap-1.5", tone)} title={"reason" in state ? state.reason : undefined}>
      <span className="size-1.5 rounded-full bg-current" />
      {STATE_LABEL[state.status]}
    </Badge>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  return <CopyConfirm value={value} copyText={label} />;
}

export function CodeBlock({ code, className, copy = true }: { code: string; className?: string; copy?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <pre className={cn("overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all", copy && "pr-24")}>
        {code}
      </pre>
      {copy && (
        <div className="absolute top-2 right-2">
          <CopyButton value={code} />
        </div>
      )}
    </div>
  );
}

/** Write-only field: never pre-filled, value hidden by default. */
export function SecretInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pr-9 font-mono"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <p className="font-medium">{title}</p>
        {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}

export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <HourglassIcon className="size-8 text-muted-foreground" />
        <p className="font-medium">{title}: coming soon</p>
        <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}

export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm whitespace-pre-line text-destructive" role="alert">
      {error}
    </p>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  info,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  /** Rendered next to the label, e.g. an InfoTip. */
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {info}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Large radio choices with a title and a plain-words description. */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  columns = 1,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; description?: ReactNode; disabled?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-3")}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/50",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border",
                  selected ? "border-brand bg-brand" : "border-input",
                )}
              >
                {selected && <span className="size-1.5 rounded-full bg-background" />}
              </span>
              {o.title}
            </span>
            {o.description && <span className="pl-6 text-xs text-muted-foreground">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RevealToken({ token }: { token: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2 py-1.5 font-mono text-xs">
        {show ? token : "•".repeat(Math.min(token.length, 32))}
      </code>
      <Button variant="outline" size="sm" onClick={() => setShow((s) => !s)}>
        {show ? <EyeOffIcon /> : <EyeIcon />}
        {show ? "Hide" : "Show"}
      </Button>
      <CopyButton value={token} />
    </div>
  );
}

/** Reassurance shown on the login and first-run pages. */
export function LocalOnlyNote({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm", className)}>
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">This runs on your computer.</span> Nothing is sent to anyone
        else, except to the online servers you choose to add.
      </p>
    </div>
  );
}
