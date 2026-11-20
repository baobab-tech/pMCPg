// Resolve: maps a qualified name to a ToolRef and rejects tools outside the profile.
import { ALL_PROFILE, type ProfileDef } from "../core/config.ts";
import { GatewayError, type ToolRef } from "../core/types.ts";
import type { ToolIndex } from "../search/search.ts";
import type { CallContext, Step } from "./step.ts";

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}$`);
}

/** Why the tool is outside the profile, or undefined when it is inside. */
export function outsideProfile(profileId: string, profile: ProfileDef, tool: ToolRef): string | undefined {
  if (profileId !== ALL_PROFILE && !profile.accounts.includes(tool.accountId)) {
    return `account ${tool.accountId} is not in profile ${profileId}`;
  }
  if (profile.deny.some((g) => globToRegExp(g).test(tool.qualifiedName))) {
    return `tool is hidden in profile ${profileId}`;
  }
  return undefined;
}

/** Looks the name up in the profile's index. Throws GatewayError on unknown or out-of-profile tools. */
export function resolveTool(index: ToolIndex, profileId: string, profile: ProfileDef, name: string): ToolRef {
  const tool = index.get(profileId, name);
  if (!tool) throw new GatewayError("unknown-tool", `No tool named "${name}". Use search_tools to find one.`);
  const why = outsideProfile(profileId, profile, tool);
  if (why) throw new GatewayError("not-in-profile", why);
  return tool;
}

/** First pipeline step. Re-checks profile membership so no later step sees an out-of-profile tool. */
export const resolveStep: Step = {
  name: "resolve",
  phase: "before",
  async run(ctx: CallContext) {
    const why = outsideProfile(ctx.profileId, ctx.profile, ctx.tool);
    if (why) throw new GatewayError("not-in-profile", why);
  },
};
