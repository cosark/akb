import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, listVaults } from "@/lib/api";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";

export interface VaultSummary {
  id: string;
  name: string;
  role?: string;
  is_pinned?: boolean;
}

/**
 * Fetches the current user's vault list. Exposes a stable `refetch` so
 * mutation sites (vault create/delete) can invalidate after success via
 * `VaultRefreshContext`. New account/proof keys never inherit a directory;
 * transient failures retain only a snapshot owned by the same proof.
 */
export function useVaults() {
  const user = useCurrentUser();
  const { checking, revision } = useAccessVerification();
  const query = useQuery({
    queryKey: ["vault-rail-directory", user?.user_id, revision],
    queryFn: async () => {
      const result = await listVaults();
      if (!Array.isArray(result.vaults)) throw new Error("Invalid vault directory");
      return result.vaults as VaultSummary[];
    },
    enabled: !!user && !checking,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const denied = query.error instanceof ApiError && [401, 403].includes(query.error.status);
  const vaults = user && !checking && !denied ? query.data ?? [] : [];
  const userId = user?.user_id;
  const refetchQuery = query.refetch;
  const refetch = useCallback(() => { if (userId && !checking) void refetchQuery(); }, [userId, checking, refetchQuery]);
  return { vaults, loading: checking || query.isPending || query.isFetching, error: !checking && query.isError, refetch };
}
