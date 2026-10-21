import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, listVaults, type CurrentUser } from "@/lib/api";
import { useVaults } from "../use-vaults";

let identity: CurrentUser | null;
let proof: { checking: boolean; revision: number };
vi.mock("@/contexts/current-user-context", () => ({
  useCurrentUser: () => identity,
  useAccessVerification: () => proof,
}));
vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), listVaults: vi.fn() }));
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => {
  identity = { user_id: "account-a", username: "a", email: "a@example.test", display_name: null, is_admin: false, auth_method: "local", key_class: null };
  proof = { checking: false, revision: 0 };
  vi.mocked(listVaults).mockReset();
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

describe("Vault rail account/proof ownership", () => {
  it("hides the previous directory and blocks manual refresh while checking", async () => {
    vi.mocked(listVaults).mockResolvedValueOnce({ vaults: [{ id: "a", name: "private-a" }] }).mockResolvedValueOnce({ vaults: [] });
    const { result, rerender } = renderHook(useVaults, setup());
    await waitFor(() => expect(result.current.vaults[0]?.name).toBe("private-a"));
    proof = { checking: true, revision: 0 }; rerender();
    expect(result.current.vaults).toEqual([]);
    act(() => result.current.refetch());
    expect(listVaults).toHaveBeenCalledTimes(1);
    proof = { checking: false, revision: 1 }; rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vaults).toEqual([]);
  });
  it("cannot render an old account's delayed request in the new account", async () => {
    let finish!: (value: { vaults: { id: string; name: string }[] }) => void;
    vi.mocked(listVaults).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ vaults: [{ id: "b", name: "private-b" }] });
    const { result, rerender } = renderHook(useVaults, setup());
    await waitFor(() => expect(listVaults).toHaveBeenCalledTimes(1));
    identity = { ...identity!, user_id: "account-b" }; rerender();
    await waitFor(() => expect(result.current.vaults[0]?.name).toBe("private-b"));
    await act(async () => finish({ vaults: [{ id: "a", name: "private-a" }] }));
    expect(result.current.vaults[0]?.name).toBe("private-b");
  });
  it("clears an owned cached snapshot when refresh confirms lost access", async () => {
    vi.mocked(listVaults).mockResolvedValueOnce({ vaults: [{ id: "a", name: "private-a" }] }).mockRejectedValueOnce(new ApiError("Denied", 403, {}));
    const { result } = renderHook(useVaults, setup());
    await waitFor(() => expect(result.current.vaults).toHaveLength(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.vaults).toEqual([]);
  });
  it("does not fetch without a verified account", () => {
    identity = null;
    const { result } = renderHook(useVaults, setup());
    act(() => result.current.refetch());
    expect(listVaults).not.toHaveBeenCalled();
    expect(result.current.vaults).toEqual([]);
  });
});
