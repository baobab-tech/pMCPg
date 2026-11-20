"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

/** Load a GET endpoint; optional polling. */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api.get<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the path changes
  useEffect(() => {
    setLoading(true);
    void reload();
    if (!opts.pollMs) return;
    const t = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(t);
  }, [path, opts.pollMs, reload]);

  return { data, error, loading, reload, setData };
}
