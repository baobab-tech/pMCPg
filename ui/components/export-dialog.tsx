"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock, ErrorNote } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, type ExportFormat, type ExportResult } from "@/lib/api";
import { useApi } from "@/lib/hooks";

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const formats = useApi<ExportFormat[]>(open ? "/export/formats" : null);
  const [format, setFormat] = useState("mcp-json");
  const [share, setShare] = useState(false);
  const [result, setResult] = useState<ExportResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(undefined);
    api
      .get<ExportResult>(`/export?format=${encodeURIComponent(format)}&share=${share ? "1" : "0"}`)
      .then((r) => live && setResult(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [open, format, share]);

  const hint = formats.data?.find((f) => f.id === format)?.hint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export server list</DialogTitle>
          <DialogDescription>
            A file other AI apps can read. Keys and sign-ins are never included: after importing, enter keys or sign in
            again.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup value={format} onValueChange={(v) => setFormat(String(v))} className="sm:grid-cols-2">
          {(formats.data ?? []).map((f) => (
            <label key={f.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40">
              <RadioGroupItem value={f.id} />
              {f.label}
            </label>
          ))}
        </RadioGroup>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={share} onCheckedChange={setShare} />
          For sharing: one entry per server, no account names or home folder
        </label>

        <ErrorNote error={error ?? formats.error} />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {result && (
          <>
            {result.count === 0 && <p className="text-sm text-muted-foreground">No servers to export in this format.</p>}
            {!!result.placeholders.length && (
              <p className="text-xs text-muted-foreground">To fill in after importing: {result.placeholders.join(", ")}</p>
            )}
            {!!result.signIn.length && (
              <p className="text-xs text-muted-foreground">Sign in again: {result.signIn.join(", ")}</p>
            )}
            {result.skipped.map((s) => (
              <p key={s.name} className="text-xs text-muted-foreground">
                Left out {s.name}: {s.reason}
              </p>
            ))}
            <CodeBlock code={result.content} className="max-h-80 overflow-y-auto" />
          </>
        )}

        <DialogFooter>
          <Button disabled={!result} onClick={() => result && download(result.filename, result.content)}>
            <DownloadIcon />
            Download {result?.filename ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
