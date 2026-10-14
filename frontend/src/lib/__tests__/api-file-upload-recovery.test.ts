import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { confirmVaultFileUpload, setToken, uploadVaultFile, VaultFileUploadUncertainError } from "@/lib/api";
import { INVENTORY_CHANGED_EVENT } from "@/lib/inventory-refresh";

const server = setupServer();
const id = "4f9d5609-c6c7-4b62-a8be-79308c18cb8d";
const path = `*/api/v1/files/ops/${id}`;
const result = { kind: "file", uri: `akb://ops/file/${id}`, vault: "ops", name: "report.txt", mime_type: "text/plain", size_bytes: 5 };
const file = () => new File(["saved"], "report.txt", { type: "text/plain" });
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => setToken("upload-original-account"));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => { setToken(null); server.close(); });

function reserve(transferStatus = 200, deduplicated = false) {
  const reservations = vi.fn(() => HttpResponse.json({ uri: result.uri, upload_url: "http://storage.test/upload", deduplicated }));
  const transfers = vi.fn(() => new HttpResponse(null, { status: transferStatus }));
  const deletions = vi.fn(() => new HttpResponse(null, { status: 204 }));
  server.use(http.post("*/api/v1/files/ops/upload", reservations), http.put("http://storage.test/upload", transfers), http.delete(path, deletions));
  return { reservations, transfers, deletions };
}

describe("File confirmation recovery", () => {
  it("reconciles a saved upload after its success response is lost without deleting or reserving again", async () => {
    const flow = reserve();
    const confirm = vi.fn(() => HttpResponse.error());
    const inventory = vi.fn();
    window.addEventListener(INVENTORY_CHANGED_EVENT, inventory);
    server.use(http.post(`${path}/confirm`, confirm), http.get(path, () => HttpResponse.json(result)));
    try {
      expect(await uploadVaultFile("ops", file())).toEqual(result);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(flow.reservations).toHaveBeenCalledTimes(1);
      expect(flow.transfers).toHaveBeenCalledTimes(1);
      expect(flow.deletions).not.toHaveBeenCalled();
      expect(inventory).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(INVENTORY_CHANGED_EVENT, inventory); }
  });

  it("retries confirmation on the same reservation when metadata is not visible yet", async () => {
    const flow = reserve();
    const confirm = vi.fn().mockImplementationOnce(() => new HttpResponse(null, { status: 503 })).mockImplementationOnce(() => HttpResponse.json(result));
    server.use(http.post(`${path}/confirm`, confirm), http.get(path, () => new HttpResponse(null, { status: 404 })));
    expect(await uploadVaultFile("ops", file())).toEqual(result);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(flow.reservations).toHaveBeenCalledTimes(1);
    expect(flow.transfers).toHaveBeenCalledTimes(1);
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("retains the File reference on unresolved confirmation and Check upload never uploads a duplicate", async () => {
    const flow = reserve();
    server.use(http.post(`${path}/confirm`, () => new HttpResponse(null, { status: 503 })), http.get(path, () => new HttpResponse(null, { status: 404 })));
    await expect(uploadVaultFile("ops", file())).rejects.toMatchObject({ name: "VaultFileUploadUncertainError", vault: "ops", fileId: id });
    server.use(http.post(`${path}/confirm`, () => HttpResponse.json(result)));
    expect(await confirmVaultFileUpload("ops", id)).toEqual(result);
    expect(flow.reservations).toHaveBeenCalledTimes(1);
    expect(flow.transfers).toHaveBeenCalledTimes(1);
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("uses only verified pending cancellation after transfer failure", async () => {
    const flow = reserve(503);
    const cancel = vi.fn(() => HttpResponse.json({ cancelled: true, state: "cancelled" }));
    server.use(http.post(`${path}/cancel-upload`, cancel));
    await expect(uploadVaultFile("ops", file())).rejects.toThrow("File transfer failed (503)");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it.each([404, 503])("retains the reference when pending cancellation is unavailable (%s); never uses ordinary DELETE", async (status) => {
    const flow = reserve(503);
    const cancel = vi.fn(() => new HttpResponse(null, { status }));
    server.use(http.post(`${path}/cancel-upload`, cancel));
    await expect(uploadVaultFile("ops", file())).rejects.toMatchObject({ name: "VaultFileUploadUncertainError", fileId: id });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("reconciles a peer-confirmed file instead of treating a cancellation no-op as a new-upload failure", async () => {
    const flow = reserve(503);
    server.use(http.post(`${path}/cancel-upload`, () => HttpResponse.json({ cancelled: false, state: "confirmed" })), http.post(`${path}/confirm`, () => HttpResponse.json(result)));
    expect(await uploadVaultFile("ops", file())).toEqual(result);
    expect(flow.reservations).toHaveBeenCalledTimes(1);
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("does not transfer, confirm, reconcile, or clean up in a changed account", async () => {
    const flow = reserve();
    server.use(http.post("*/api/v1/files/ops/upload", () => {
      setToken("another-account");
      return HttpResponse.json({ uri: result.uri, upload_url: "http://storage.test/upload" });
    }));
    await expect(uploadVaultFile("ops", file())).rejects.toThrow("account changed");
    expect(flow.transfers).not.toHaveBeenCalled();
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("does not reconcile or retry when the account changes while confirmation is pending", async () => {
    const flow = reserve();
    const confirm = vi.fn(() => { setToken("another-account"); return HttpResponse.error(); });
    const get = vi.fn(() => HttpResponse.json(result));
    server.use(http.post(`${path}/confirm`, confirm), http.get(path, get));
    await expect(uploadVaultFile("ops", file())).rejects.toThrow("account changed");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(flow.deletions).not.toHaveBeenCalled();
  });

  it("binds Check upload to the original session even if a stale dialog survives an account change", async () => {
    const flow = reserve();
    server.use(http.post(`${path}/confirm`, () => new HttpResponse(null, { status: 503 })), http.get(path, () => new HttpResponse(null, { status: 404 })));
    const failure = await uploadVaultFile("ops", file()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VaultFileUploadUncertainError);
    setToken("another-account");
    const confirm = vi.fn(() => HttpResponse.json(result));
    server.use(http.post(`${path}/confirm`, confirm));
    await expect((failure as VaultFileUploadUncertainError).checkUpload()).rejects.toThrow("account changed");
    expect(confirm).not.toHaveBeenCalled();
    expect(flow.reservations).toHaveBeenCalledTimes(1);
  });

  it("never deletes an adopted duplicate on uncertain confirmation", async () => {
    const flow = reserve(200, true);
    server.use(http.post(`${path}/confirm`, () => new HttpResponse(null, { status: 503 })), http.get(path, () => new HttpResponse(null, { status: 503 })));
    await expect(uploadVaultFile("ops", file())).rejects.toBeInstanceOf(VaultFileUploadUncertainError);
    expect(flow.transfers).not.toHaveBeenCalled();
    expect(flow.deletions).not.toHaveBeenCalled();
  });
});
