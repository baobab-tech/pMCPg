// Downstream errors as results. The server wrote the error text, so it can carry personal data, secrets
// from a stack trace, or injected instructions. As a thrown error it would skip the "after" steps
// (masking, secret redaction, data-flow tracking) and reach the model verbatim.
import { GatewayError, type ToolResult } from "../core/types.ts";
import type { CallContext } from "./step.ts";

type Forward = (ctx: CallContext) => Promise<ToolResult>;

/** Wraps `forward` so a downstream error comes back as an error result that the after steps process. */
export function catchDownstreamErrors(forward: Forward): Forward {
  return async (ctx) => {
    try {
      return await forward(ctx);
    } catch (e) {
      if (!(e instanceof GatewayError) || e.code !== "downstream-error") throw e;
      return { isError: true, content: [{ type: "text", text: `downstream-error: ${e.message}` }] };
    }
  };
}
