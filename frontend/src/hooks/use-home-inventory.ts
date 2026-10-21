import { useEffect } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, clearSharedVaultReads, getVaultInfo, listVaults } from "@/lib/api";
import { INVENTORY_CHANGED_EVENT } from "@/lib/inventory-refresh";
import { validCount } from "@/lib/workspace-summary";
import type { VaultRow } from "@/components/vault-list";

export const HOME_INVENTORY_TTL = 30_000;
export interface VaultMetrics { document_count?: number; table_count?: number; file_count?: number }
const denied = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status);

export function useHomeVaultDirectory(userId: string, checking: boolean, revision: number) {
  const client = useQueryClient();
  const directory = useQuery({
    queryKey: ["home-vault-directory", userId, revision],
    queryFn: async () => {
      const result = await listVaults();
      if (!Array.isArray(result.vaults)) throw new Error("Invalid Vault directory");
      return result.vaults as VaultRow[];
    },
    enabled: !!userId && !checking, retry: false,
    staleTime: HOME_INVENTORY_TTL, refetchInterval: HOME_INVENTORY_TTL,
    refetchOnMount: "always", refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const refresh = async () => {
      if (checking || !userId) return;
      // A pre-write flight cannot fulfill the post-write snapshot, even if it
      // was the first card request and had no cached result to invalidate.
      clearSharedVaultReads();
      const keys = ["home-vault-directory", "home-vault-metrics", "workspace-summary"].map(key => [key, userId]);
      await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })));
      await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })));
    };
    window.addEventListener(INVENTORY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(INVENTORY_CHANGED_EVENT, refresh);
  }, [client, checking, userId]);
  return { directory, vaults: !checking && !denied(directory.error) && directory.data ? directory.data : [],
    loading: checking || directory.isPending, error: !checking && directory.isError };
}

export function useHomeVaultMetrics(vaults: VaultRow[], userId: string, checking: boolean, revision: number) {
  const queries = useQueries({ queries: vaults.map(vault => ({
    queryKey: ["home-vault-metrics", userId, revision, vault.id, vault.name],
    queryFn: async (): Promise<VaultMetrics> => {
      const data = await getVaultInfo(vault.name);
      const metrics: VaultMetrics = {};
      for (const key of ["document_count", "table_count", "file_count"] as const) if (validCount(data?.[key])) metrics[key] = data[key];
      return metrics;
    },
    enabled: !!userId && !checking, retry: false,
    staleTime: HOME_INVENTORY_TTL, refetchInterval: HOME_INVENTORY_TTL,
    refetchOnMount: "always" as const, refetchOnWindowFocus: false,
  })) });
  return Object.fromEntries(vaults.map((vault, index) => {
    const query = queries[index];
    return [vault.name, { metrics: checking || denied(query.error) ? undefined : query.data,
      ready: !checking && !query.isPending, error: !checking && query.isError,
      retry: () => void query.refetch() }];
  }));
}
