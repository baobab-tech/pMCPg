// A fake catalog host on 127.0.0.1 for fetch tests. Serves /catalog.json and /catalog.json.sig with an
// ETag, answers 304 to a matching If-None-Match, and counts requests. Tests change `state` between calls.

export interface FakeCatalogState {
  bytes: Uint8Array;
  sig: string;
  etag: string;
  /** Answer the catalog path with this status and no body. */
  status?: number;
  /** Redirect the catalog path here. */
  redirect?: string;
}

export interface FakeCatalogServer {
  url: string;
  sigUrl: string;
  state: FakeCatalogState;
  requests: { path: string; ifNoneMatch: string | null }[];
  stop(): void;
}

export function startFakeCatalog(initial: FakeCatalogState): FakeCatalogServer {
  const requests: FakeCatalogServer["requests"] = [];
  const self: FakeCatalogServer = {
    url: "",
    sigUrl: "",
    state: initial,
    requests,
    stop: () => server.stop(true),
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const inm = req.headers.get("if-none-match");
      requests.push({ path, ifNoneMatch: inm });
      const s = self.state;
      if (path === "/catalog.json") {
        if (s.redirect) return new Response(null, { status: 302, headers: { location: s.redirect } });
        if (s.status) return new Response(null, { status: s.status });
        if (inm && inm === s.etag) return new Response(null, { status: 304, headers: { etag: s.etag } });
        return new Response(s.bytes, { headers: { etag: s.etag, "content-type": "application/json" } });
      }
      if (path === "/catalog.json.sig") return new Response(s.sig);
      return new Response("not found", { status: 404 });
    },
  });
  self.url = `http://127.0.0.1:${server.port}/catalog.json`;
  self.sigUrl = `${self.url}.sig`;
  return self;
}
