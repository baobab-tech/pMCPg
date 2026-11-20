"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorNote } from "@/components/common";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Account, api, errorMessage } from "@/lib/api";

/** Starts browser sign-in and waits for it to finish. */
export function SignInDialog({
  accountId,
  open,
  onOpenChange,
  onSignedIn,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSignedIn: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  // Callbacks in refs, so a parent re-render does not start a second sign-in.
  const done = useRef({ onOpenChange, onSignedIn });
  done.current = { onOpenChange, onSignedIn };

  useEffect(() => {
    if (!open) return;
    setUrl(undefined);
    setError(undefined);
    let stop = false;
    api
      .post<{ authorizationUrl: string }>(`/accounts/${accountId}/signin`)
      .then((r) => setUrl(r.authorizationUrl))
      .catch((e) => setError(errorMessage(e)));
    const t = setInterval(async () => {
      const list = await api.get<Account[]>("/accounts").catch(() => undefined);
      if (stop) return;
      if (list?.find((a) => a.id === accountId)?.signedIn) {
        clearInterval(t);
        toast.success(`Signed in: ${accountId}`);
        done.current.onSignedIn();
        done.current.onOpenChange(false);
      }
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [open, accountId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in: {accountId}</DialogTitle>
          <DialogDescription>
            A sign-in page should have opened in your browser. Log in there and approve access; this window updates by
            itself.
          </DialogDescription>
        </DialogHeader>
        <ErrorNote error={error} />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            <ExternalLinkIcon />
            Open the sign-in page
          </a>
        )}
        {!url && !error && <p className="text-sm text-muted-foreground">Starting sign-in…</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

