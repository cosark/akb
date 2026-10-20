import type { ReactNode } from "react";
import type { VaultRow } from "@/components/vault-list";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getVaultInfo, listVaults } from "@/lib/api";
import { notifyInventoryChanged, changesInventory } from "@/lib/inventory-refresh";
import { HOME_INVENTORY_TTL, useHomeVaultDirectory, useHomeVaultMetrics } from "../use-home-inventory";

vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), getVaultInfo: vi.fn(), listVaults: vi.fn() }));
const vaults: VaultRow[] = [{ id: "v1", name: "team", role: "reader", description: "", status: "active" }];
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { vi.mocked(listVaults).mockReset().mockResolvedValue({ vaults }); vi.mocked(getVaultInfo).mockReset().mockResolvedValue({ document_count: 3 }); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

describe("F01/F30 Home inventory ownership and recovery", () => {
  it("does not treat a failed card lookup as done forever; Retry keeps missing values absent", async () => {
    vi.mocked(getVaultInfo).mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => useHomeVaultMetrics(vaults, "reader", false, 0), setup());
    await waitFor(() => expect(result.current.team.error).toBe(true));
    expect(result.current.team.metrics).toBeUndefined();
    act(() => result.current.team.retry());
    await waitFor(() => expect(result.current.team.metrics).toEqual({ document_count: 3 }));
    expect(result.current.team.error).toBe(false);
    expect(result.current.team.metrics?.table_count).toBeUndefined();
  });
  it("hides previous Vault data during proof and ignores the old account/revision response", async () => {
    let finish!: (value: { document_count: number }) => void;
    vi.mocked(getVaultInfo).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ account, checking, revision }) => useHomeVaultMetrics(vaults, account, checking, revision), { ...setup(), initialProps: { account: "a", checking: false, revision: 0 } });
    rerender({ account: "a", checking: true, revision: 0 });
    expect(result.current.team.metrics).toBeUndefined();
    rerender({ account: "b", checking: false, revision: 1 });
    await waitFor(() => expect(result.current.team.metrics?.document_count).toBe(3));
    await act(async () => finish({ document_count: 99 }));
    expect(result.current.team.metrics?.document_count).toBe(3);
  });
  it.each(["document creation", "file deletion", "table row edit", "resource move"])("refreshes cards and directory after successful %s", async () => {
    const { result } = renderHook(() => ({ directory: useHomeVaultDirectory("reader", false, 0), metrics: useHomeVaultMetrics(vaults, "reader", false, 0) }), setup());
    await waitFor(() => expect(result.current.metrics.team.metrics?.document_count).toBe(3));
    vi.mocked(getVaultInfo).mockResolvedValue({ document_count: 4 });
    act(() => notifyInventoryChanged("team"));
    await waitFor(() => expect(result.current.metrics.team.metrics?.document_count).toBe(4));
    expect(listVaults).toHaveBeenCalledTimes(2);
  });
  it("refreshes a mounted card at the foreground TTL", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHomeVaultMetrics(vaults, "reader", false, 0), setup());
    await act(() => vi.advanceTimersByTimeAsync(2));
    expect(result.current.team.metrics?.document_count).toBe(3);
    vi.mocked(getVaultInfo).mockResolvedValue({ document_count: 7 });
    await act(() => vi.advanceTimersByTimeAsync(HOME_INVENTORY_TTL + 2));
    expect(result.current.team.metrics?.document_count).toBe(7);
  });
  it("discards private snapshots when a background refresh reports lost access", async () => {
    const { result } = renderHook(() => ({ directory: useHomeVaultDirectory("reader", false, 0), metrics: useHomeVaultMetrics(vaults, "reader", false, 0) }), setup());
    await waitFor(() => expect(result.current.metrics.team.metrics?.document_count).toBe(3));
    expect(result.current.directory.vaults).toHaveLength(1);
    vi.mocked(listVaults).mockRejectedValue(new ApiError("Denied", 403, {}));
    vi.mocked(getVaultInfo).mockRejectedValue(new ApiError("Denied", 403, {}));
    act(() => notifyInventoryChanged("team"));
    await waitFor(() => expect(result.current.directory.error).toBe(true));
    await waitFor(() => expect(result.current.metrics.team.error).toBe(true));
    expect(result.current.directory.vaults).toEqual([]);
    expect(result.current.metrics.team.metrics).toBeUndefined();
  });
  it("replaces an initial pre-write flight rather than allowing it to satisfy mutation refresh", async () => {
    let finish!: (value: { document_count: number }) => void;
    vi.mocked(getVaultInfo).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => ({ directory: useHomeVaultDirectory("reader", false, 0), metrics: useHomeVaultMetrics(vaults, "reader", false, 0) }), setup());
    await waitFor(() => expect(getVaultInfo).toHaveBeenCalledTimes(1));
    vi.mocked(getVaultInfo).mockResolvedValue({ document_count: 4 });
    act(() => notifyInventoryChanged("team"));
    await waitFor(() => expect(result.current.metrics.team.metrics?.document_count).toBe(4));
    await act(async () => finish({ document_count: 99 }));
    expect(result.current.metrics.team.metrics?.document_count).toBe(4);
  });
  it("only treats successful content write paths as inventory changes", () => {
    for (const path of ["/documents/team/one", "/files/team/one", "/tables/team/one/rows/id", "/vaults/team/import", "/collections/team"]) expect(changesInventory(path, "POST")).toBe(true);
    for (const path of ["/auth/me", "/auth/change-password", "/publications/team/one", "/tables/team/sql", "/vaults/team/write-policy"]) expect(changesInventory(path, "POST")).toBe(false);
    expect(changesInventory("/documents/team", "GET")).toBe(false);
  });
});
