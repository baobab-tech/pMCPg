"use client";

import { EraserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { BetaBadge } from "@/components/profile-options";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

const CONSEQUENCE = "Chats that still hold old placeholders such as [EMAIL_1_k7qx] can no longer use them.";

/** Clears the gateway's placeholder map for one profile, or every profile without `profile`. */
export function ForgetMaskedButton({
  profile,
  variant = "outline",
  compact = false,
}: {
  profile?: { id: string; name: string };
  variant?: "outline" | "ghost";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = "Forget masked values";
  return (
    <>
      {compact ? (
        <Button variant={variant} size="icon-sm" aria-label={label} title={label} onClick={() => setOpen(true)}>
          <EraserIcon />
        </Button>
      ) : (
        <Button variant={variant} onClick={() => setOpen(true)}>
          <EraserIcon />
          {label}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={profile ? `Forget masked values for ${profile.name}?` : "Forget masked values for every profile?"}
        description={CONSEQUENCE}
        confirmLabel="Forget"
        onConfirm={async (password) => {
          const r = await api.post<{ sessions: number; placeholders: number }>("/privacy/reset", {
            ...(profile ? { profile: profile.id } : {}),
            password,
          });
          toast.success(`Forgot ${r.placeholders} masked value${r.placeholders === 1 ? "" : "s"}`);
        }}
      />
    </>
  );
}

/** Settings card: forget masked values for every profile. */
export function MaskedValuesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Masked values
          <BetaBadge />
        </CardTitle>
        <CardDescription>
          pMCPg remembers which real value each placeholder stands for, in memory only, so the AI can use it in later
          calls. Forget them to start over. {CONSEQUENCE}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgetMaskedButton />
      </CardContent>
    </Card>
  );
}
