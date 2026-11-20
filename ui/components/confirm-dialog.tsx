"use client";

import { type ReactNode, useState } from "react";
import { ErrorNote, Field } from "@/components/common";
import { PASSWORD_HINT, PASSWORD_LABEL, PasswordHelp } from "@/components/info-tip";
import { useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";

/** Confirmation for destructive actions. Asks for the pMCPg password again when one is set. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Remove",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: (password: string | undefined) => Promise<void>;
}) {
  const { session } = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPassword("");
          setError(undefined);
        }
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              await onConfirm(session.passwordSet ? password : undefined);
              setPassword("");
              onOpenChange(false);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {session.passwordSet && (
            <Field label={PASSWORD_LABEL} htmlFor="confirm-password" hint={PASSWORD_HINT} info={<PasswordHelp />}>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          <ErrorNote error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || (session.passwordSet && !password)}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
