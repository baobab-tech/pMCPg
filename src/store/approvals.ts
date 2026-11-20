// Approvals contract. Implementation owner: p2-policy (table `approvals` in state.db).
// The policy step creates a request and waits; the web UI (or CLI) decides it.

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  id: string;
  createdAt: number;
  profileId: string;
  /** Qualified tool name. */
  tool: string;
  /** Why approval is needed, in plain words for the UI ("Sends data out after reading a web page"). */
  reason: string;
  status: ApprovalStatus;
  decidedAt?: number;
  /**
   * The call's arguments as the tool will receive them (placeholders restored to real values; secrets
   * redacted), so the person deciding sees what they approve. In memory only: never written to state.db,
   * events or logs, and gone once the request is decided or the gateway restarts.
   */
  preview?: string;
}

export interface ApprovalStore {
  create(req: { profileId: string; tool: string; reason: string; preview?: string }): ApprovalRequest;
  /** Resolves when decided or after timeoutMs (then "expired"). */
  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<ApprovalStatus>;
  decide(id: string, decision: "approved" | "denied"): void;
  list(filter?: { status?: ApprovalStatus; limit?: number }): ApprovalRequest[];
  /** Notified on create and decide, for live UI updates. */
  subscribe(listener: (req: ApprovalRequest) => void): () => void;
}
