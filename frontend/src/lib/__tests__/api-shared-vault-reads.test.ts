import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSharedVaultReads, getVaultInfo, listVaults, setToken } from "@/lib/api";

beforeEach(() => { clearSharedVaultReads(); setToken("shared-read-test"); });
afterEach(() => { clearSharedVaultReads(); setToken(null); vi.unstubAllGlobals(); });

describe("shared Vault read ownership", () => {
  it.each([getVaultInfo.bind(null, "ops"), listVaults])("deduplicates only reads owned by the current verification", async (read) => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetch = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve)));
    vi.stubGlobal("fetch", fetch);
    const old = read();
    expect(read()).toBe(old);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    clearSharedVaultReads();
    const fresh = read();
    expect(fresh).not.toBe(old);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resolvers[0](new Response(JSON.stringify({ role: "admin" }), { status: 200 }));
    await old;
    // Resolving the old flight cannot remove a still-pending fresh flight.
    expect(read()).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
    resolvers[1](new Response(JSON.stringify({ role: "reader" }), { status: 200 }));
    expect(await fresh).toEqual({ role: "reader" });
  });

  it("detaches in-flight reads after a local account carrier changes", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const previous = getVaultInfo("ops");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    setToken("other-account");
    const current = getVaultInfo("ops");
    expect(current).not.toBe(previous);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
