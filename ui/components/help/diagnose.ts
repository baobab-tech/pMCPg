// Plain-words diagnosis of one account, from the state and reason the gateway reports
// (src/connectors/stdio.ts and remote.ts set them).
import type { Account } from "../../lib/api";

export interface Diagnosis {
  title: string;
  detail: string;
  /** A button the help page can offer. */
  fix?: "signin" | "keys";
  /** Help article with more. */
  article?: string;
}

export function diagnose(a: Account): Diagnosis {
  const missing = [...a.headers, ...a.env].filter((s) => !s.set).map((s) => s.name);
  const reason = "reason" in a.state ? a.state.reason : "";

  if (a.auth === "oauth" && (a.state.status === "sign-in-needed" || a.signedIn === false)) {
    return {
      title: "Sign-in needed",
      detail:
        a.signedIn === false
          ? "This account has never been signed in. Sign in once in your browser; pMCPg keeps the sign-in fresh after that."
          : "The service no longer accepts the saved sign-in. This happens when a password changes, access is revoked or a sign-in expires. Sign in again; nothing else changes.",
      fix: "signin",
      article: "sign-in-needed",
    };
  }
  if (a.state.status === "sign-in-needed") {
    return {
      title: "The service rejected the key",
      detail:
        "The server answered “not allowed”. The API key may be wrong, expired or missing a permission. Paste a fresh key from the service.",
      fix: "keys",
      article: "sign-in-needed",
    };
  }
  if (missing.length) {
    return {
      title: `A key is missing: ${missing.join(", ")}`,
      detail: "This server needs a value pMCPg doesn't have yet. Imported servers keep only the names of their keys; type the values here.",
      fix: "keys",
      article: "server-wont-start",
    };
  }
  if (/command not found/i.test(reason)) {
    const cmd = reason.split(":").pop()?.trim() ?? "";
    const node = /^(npx|node|npm|pnpx|bunx)$/.test(cmd);
    const uv = /^(uvx|uv|python3?)$/.test(cmd);
    return {
      title: `pMCPg can't find “${cmd}”`,
      detail: node
        ? "This server runs with Node.js. Install Node.js (it includes npx), then restart pMCPg."
        : uv
          ? "This server runs with uv (Python). Install uv, then restart pMCPg."
          : "The command that starts this server is not installed, or not on the PATH pMCPg sees. Install it, then restart pMCPg.",
      article: "npx-uvx-not-found",
    };
  }
  if (a.state.status === "error" && /exited/i.test(reason)) {
    return {
      title: "The server stopped on its own",
      detail:
        "The server started, then quit. Usually a key or setting it needs is wrong. Check its keys, then test again. Running its command in a terminal shows its own error message.",
      fix: a.headers.length || a.env.length ? "keys" : undefined,
      article: "server-wont-start",
    };
  }
  if (a.state.status === "unreachable" && /timed? ?out|timeout/i.test(reason)) {
    return {
      title: "The server took too long",
      detail:
        a.transport === "stdio"
          ? "The first start can be slow while npx or uvx download the server. Test again in a minute."
          : "The server did not answer in time. It may be busy or down. Test again in a minute.",
      article: "server-wont-start",
    };
  }
  if (a.state.status === "unreachable") {
    return {
      title: "pMCPg can't reach this server",
      detail:
        a.transport === "stdio"
          ? "The server didn't start. Check its keys, then test again."
          : "Check your internet connection and the server's web address. pMCPg retries on its own.",
      article: "server-wont-start",
    };
  }
  if (a.state.status === "error") {
    return {
      title: "Something went wrong",
      detail: "The message above comes from the server. Check the server's address or command, and its keys.",
      article: "server-wont-start",
    };
  }
  if (a.state.status === "stopped") {
    return {
      title: "Idle: nothing wrong",
      detail: "Accounts start when an AI app first uses them and stop after 10 minutes without use. Test it to start it now.",
    };
  }
  if (a.state.status === "starting") return { title: "Starting", detail: "Give it a few seconds, then test it." };
  if (a.tools === 0) {
    return {
      title: "Connected, but no tools",
      detail: "The server answered but offers no tools. New tools may be waiting in Tool review before the AI can see them.",
      article: "tool-review",
    };
  }
  return {
    title: "Working",
    detail: a.profiles.length
      ? "This account is connected. If your AI app can't see its tools, check that the app uses a profile listed below."
      : "This account is connected but in no profile, so no AI app can use it. Add it to a profile.",
    article: "profiles",
  };
}
