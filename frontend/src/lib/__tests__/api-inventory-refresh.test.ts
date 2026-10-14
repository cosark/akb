import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollection, deleteDocument, listVaults, updateProfile } from "@/lib/api";
import { INVENTORY_CHANGED_EVENT } from "../inventory-refresh";

const response = (status = 200) => new Response(JSON.stringify(status >= 400 ? { detail: "Failed" } : { ok: true, vaults: [], collection: {} }), { status, headers: { "Content-Type": "application/json" } });
const observed = vi.fn();
beforeEach(() => { observed.mockReset(); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response())); window.addEventListener(INVENTORY_CHANGED_EVENT, observed); });
afterEach(() => { window.removeEventListener(INVENTORY_CHANGED_EVENT, observed); vi.unstubAllGlobals(); });

describe("F30 inventory mutation signals", () => {
  it("emits once after each successful collection/document mutation", async () => {
    await createCollection("team", "guides");
    await deleteDocument("team", "guides/old.md");
    expect(observed).toHaveBeenCalledTimes(2);
  });
  it("does not emit for failed writes, account changes, or inventory reads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(503));
    await expect(createCollection("team", "guides")).rejects.toThrow("Failed");
    await updateProfile({ display_name: "Reader" });
    await listVaults();
    expect(observed).not.toHaveBeenCalled();
  });
});
