import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword, configureAuthTransport, getToken, setToken } from "../api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { configureAuthTransport("local"); setToken("session-a"); });
afterEach(() => { setToken(null); configureAuthTransport(null); vi.unstubAllGlobals(); });

describe("password change session boundary", () => {
  it("keeps typed incorrect-current-password errors local to the form", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ detail: { message: "Current password is incorrect", code: "current_password_incorrect" } }, 400));
    vi.stubGlobal("fetch", fetch);
    await expect(changePassword("wrong", "new-password")).rejects.toMatchObject({ status: 400, detail: { code: "current_password_incorrect" } });
    expect(getToken()).toBe("session-a");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("proves the existing session before translating a legacy backend's 401", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ user_id: "a", username: "alice" }));
    vi.stubGlobal("fetch", fetch);
    await expect(changePassword("wrong", "new-password")).rejects.toMatchObject({ status: 400, detail: { code: "current_password_incorrect" } });
    expect(fetch.mock.calls[1][0]).toBe("/api/v1/auth/me");
    expect(getToken()).toBe("session-a");
  });
  it("still expires a genuine invalid session when the proof returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 401)));
    await expect(changePassword("old", "new-password")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
  });
  it("never proves or clears a newer login after a late legacy 401", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    vi.stubGlobal("fetch", fetch);
    const request = changePassword("old", "new-password");
    setToken("session-b");
    resolve(json({}, 401));
    await expect(request).rejects.toMatchObject({ status: 401, name: "DeferredSessionError" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(getToken()).toBe("session-b");
  });
  it("does not misreport a failed proof as an incorrect password", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ detail: "Unavailable" }, 503)));
    await expect(changePassword("old", "new-password")).rejects.toMatchObject({ status: 503 });
    expect(getToken()).toBe("session-a");
  });
  it("returns a successful receipt for the caller's explicit sign-in transition", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: true })));
    await expect(changePassword("old", "new-password")).resolves.toEqual({ ok: true });
  });
  it.each([{}, { ok: false }, null])("keeps an unverified successful HTTP response %j distinct from password-change success", async receipt => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(receipt)));
    await expect(changePassword("old", "new-password")).rejects.toMatchObject({ status: 502, detail: { code: "password_change_unverified" } });
    expect(getToken()).toBe("session-a");
  });
  it("does not translate a legacy 401 after a malformed identity proof", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({})));
    await expect(changePassword("old", "new-password")).rejects.toMatchObject({ status: 502, detail: { code: "session_proof_unverified" } });
    expect(getToken()).toBe("session-a");
  });
});
