"use client";

import { useState } from "react";
import { api, type CatalogResponse, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";

/** The catalog view. Loading reads the saved copy; only refresh() contacts pmcpg.io. */
export function useCatalog() {
  const q = useApi<CatalogResponse>("/catalog");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();

  async function refresh() {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      q.setData(await api.post<CatalogResponse>("/catalog/refresh"));
    } catch (e) {
      setRefreshError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  return { ...q, refresh, refreshing, refreshError };
}
