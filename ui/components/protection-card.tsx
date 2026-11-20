"use client";

import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChoiceCards, ErrorNote, Field } from "@/components/common";
import { BetaBadge, MASKING_CAUTION, PRESET_OPTIONS, PRIVACY_OPTIONS } from "@/components/profile-options";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage, type Preset, type Privacy, type Profile } from "@/lib/api";

/** Privacy and approval levels of the All profile, saved on each change. */
export function ProtectionCard({ title = "Privacy and safety" }: { title?: string }) {
  const [profile, setProfile] = useState<Profile>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .get<Profile[]>("/profiles")
      .then((ps) => setProfile(ps.find((p) => p.id === "all")))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save(patch: { privacy?: Privacy; preset?: Preset }) {
    setError(undefined);
    try {
      setProfile(await api.patch<Profile>("/profiles/all", patch));
      toast.success("Saved");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Covers what passes between your AI apps and your MCP servers. What you type or upload in the AI app goes to
          its maker as usual. Change it any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {!profile ? (
          error ? null : <Skeleton className="h-40" />
        ) : (
          <>
            <Field label="Hide personal details in tool results" info={<BetaBadge />} hint={MASKING_CAUTION}>
              <ChoiceCards
                value={profile.privacy}
                onChange={(privacy) => void save({ privacy })}
                columns={3}
                options={PRIVACY_OPTIONS}
              />
            </Field>
            <Field label="Ask me before a tool runs">
              <ChoiceCards
                value={profile.preset}
                onChange={(preset) => void save({ preset })}
                columns={3}
                options={PRESET_OPTIONS}
              />
            </Field>
          </>
        )}
        <HowItWorks />
        <ErrorNote error={error} />
      </CardContent>
    </Card>
  );
}

function HowItWorks() {
  return (
    <details className="group rounded-xl border px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        How this works
      </summary>
      <ol className="mt-2 grid list-decimal gap-1.5 pl-9 text-muted-foreground">
        <li>Your AI app asks pMCPg to run a tool. pMCPg sends the request to the MCP server and brings back the result.</li>
        <li>
          With hiding on, pMCPg swaps personal details in the result for placeholders like{" "}
          <code className="font-mono text-xs">[EMAIL_1_k7qx]</code>. The real values stay on this computer, so the AI
          app and its maker never get them.
        </li>
        <li>
          If the AI uses a placeholder in a later tool call, pMCPg puts the real value back, but only for the server it
          came from.
        </li>
        <li>
          If the AI tries to send a secret, such as an API key, to a tool, pMCPg blocks the call. Secrets in results are
          always hidden, even with hiding off.
        </li>
        <li>
          “Ask me before” pauses a tool call until you approve it here. Balanced and Careful decide which calls pause.
        </li>
        <li>
          Not covered: what you type, paste or upload in the AI app itself. That goes to the app's maker as usual.
        </li>
      </ol>
    </details>
  );
}
