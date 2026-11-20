// URL policy for remote servers: HTTPS, or plain HTTP to localhost and private addresses when allowed.

/** True for localhost names, loopback, RFC 1918, link-local and IPv6 unique-local addresses. */
export function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (h === "::1") return true;
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isLocalOrPrivateHost(mapped[1] as string);
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}

/** Returns a reason when the URL may not be used, or undefined when it may. */
export function checkRemoteUrl(raw: string, allowInsecure: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "server URL is not valid";
  }
  if (url.username || url.password) return "server URL must not contain credentials";
  if (url.protocol === "https:") return undefined;
  if (url.protocol !== "http:") return `unsupported URL scheme ${url.protocol}`;
  if (!allowInsecure)
    return "server URL must use https (set allowInsecure for localhost or private addresses)";
  if (!isLocalOrPrivateHost(url.hostname))
    return "plain http is allowed only for localhost and private addresses";
  return undefined;
}
