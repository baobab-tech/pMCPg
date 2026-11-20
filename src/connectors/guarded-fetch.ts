// Fetch for URLs a server names (OAuth discovery, registration, token, revocation): timeout,
// response size cap, https-only except loopback, and every redirect hop checked by the same rules.

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export const GUARD_TIMEOUT_MS = 10_000;
export const GUARD_MAX_BYTES = 1024 * 1024;
export const GUARD_MAX_REDIRECTS = 3;

export interface GuardedFetchOptions {
  /** Underlying fetch. Default global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /**
   * An origin also allowed over plain http: the configured server's own origin when the user set
   * `allowInsecure` for it (checkRemoteUrl already limited that to local and private addresses).
   */
  httpOrigin?: string;
}

/** Thrown for a URL or redirect the guard refuses, and for an oversize body. */
export class GuardedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardedFetchError";
  }
}

/** localhost, *.localhost, 127.0.0.0/8, ::1 and IPv4-mapped loopback. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  return /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Returns a reason when the guard refuses the URL, or undefined when it may be fetched. */
export function checkGuardedUrl(raw: string | URL, httpOrigin?: string): string | undefined {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    return "URL is not valid";
  }
  if (url.username || url.password) return "URL must not contain credentials";
  if (url.protocol === "https:") return undefined;
  if (url.protocol !== "http:") return `unsupported URL scheme ${url.protocol}`;
  if (isLoopbackHost(url.hostname) || (httpOrigin !== undefined && url.origin === httpOrigin))
    return undefined;
  return `refusing plain http to ${url.host}`;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Wraps the body so reading more than `max` bytes errors. Checks Content-Length up front. */
function capBody(res: Response, max: number): Response {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    void res.body?.cancel().catch(() => {});
    throw new GuardedFetchError(`response larger than ${max} bytes`);
  }
  if (!res.body) return res;
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > max) ctl.error(new GuardedFetchError(`response larger than ${max} bytes`));
      else ctl.enqueue(chunk);
    },
  });
  return new Response(res.body.pipeThrough(counter), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Returns a fetch that checks the URL and each redirect hop, follows at most `maxRedirects` hops,
 * aborts after `timeoutMs` (whole exchange, body included) and caps the body at `maxBytes`.
 * GET and HEAD follow redirects to any allowed URL. Other methods follow only 307/308 to the same
 * origin, so a request body and credentials never move to another host.
 */
export function guardedFetch(opts: GuardedFetchOptions = {}): FetchLike {
  const base = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? GUARD_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? GUARD_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? GUARD_MAX_REDIRECTS;
  return async (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let url = new URL(String(input));
    let req: RequestInit = { ...init, signal, redirect: "manual" };
    for (let hop = 0; ; hop++) {
      const problem = checkGuardedUrl(url, opts.httpOrigin);
      if (problem) throw new GuardedFetchError(problem);
      const res = await base(url, req);
      const location = res.headers.get("location");
      if (!REDIRECTS.has(res.status) || !location) return capBody(res, maxBytes);
      void res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new GuardedFetchError(`more than ${maxRedirects} redirects`);
      const next = new URL(location, url);
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        if ((res.status !== 307 && res.status !== 308) || next.origin !== url.origin)
          throw new GuardedFetchError(`refusing to follow a ${method} redirect to ${next.host}`);
      } else if (next.origin !== url.origin) {
        // Credentials stay with the origin they were meant for.
        const headers = new Headers(req.headers);
        for (const h of ["authorization", "cookie", "proxy-authorization"]) headers.delete(h);
        req = { ...req, headers };
      }
      url = next;
    }
  };
}
