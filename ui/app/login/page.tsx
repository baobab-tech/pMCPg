"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { ErrorNote, Field, LocalOnlyNote } from "@/components/common";
import { PASSWORD_LABEL, PasswordHelp } from "@/components/info-tip";
import { SessionProvider, useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

function LoginForm() {
  const { setSession } = useSession();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your pMCPg password: the one you set when you started pMCPg.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              setSession(await api.login(password));
              router.replace("/");
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={PASSWORD_LABEL} htmlFor="login-password" info={<PasswordHelp />}>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Forgot it? On the computer running pMCPg, run <code className="font-mono">pmcpg ui reset-password</code>.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <SessionProvider mode="login">
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo full />
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Your private gateway between AI apps and the tools they use.
          </p>
        </div>
        <LoginForm />
        <LocalOnlyNote className="w-full max-w-sm" />
      </div>
    </SessionProvider>
  );
}
