import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileUploadDialog } from "@/components/file-upload-dialog";
import { CurrentUserProvider } from "@/contexts/current-user-context";
import { setToken, uploadVaultFile, VaultFileUploadUncertainError, type CurrentUser } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), uploadVaultFile: vi.fn() }));
const account = { user_id: "alice", username: "alice" } as CurrentUser;
const uploaded = { kind: "file" as const, uri: "akb://ops/file/same-id", vault: "ops", name: "report.txt", mime_type: "text/plain", size_bytes: 5 };
beforeEach(() => { vi.resetAllMocks(); setToken("upload-dialog-session"); });
afterEach(cleanup);
function form(onUploaded = vi.fn(), revision = 0, checking = false, identity = "alice", onOpenChange = vi.fn(), visible = true) {
  return <CurrentUserProvider user={{ ...account, user_id: identity }} revision={revision} checking={checking}><FileUploadDialog open visible={visible} onOpenChange={onOpenChange} vault="ops" onUploaded={onUploaded} initialCollection="initial" /></CurrentUserProvider>;
}
function choose() { fireEvent.change(screen.getByLabelText(/^File/), { target: { files: [new File(["saved"], "report.txt")] } }); }

describe("upload uncertainty actions", () => {
  it("offers Check upload using the original reference instead of a new upload retry", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const uncertainty = new VaultFileUploadUncertainError("ops", "same-id", new Error("response lost"));
    vi.mocked(uploadVaultFile).mockRejectedValue(uncertainty);
    const check = vi.spyOn(uncertainty, "checkUpload").mockResolvedValue(uploaded);
    render(form(saved));
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    expect(await screen.findByText("Upload confirmation unavailable")).toBeInTheDocument();
    expect(screen.getByText(/may already be saved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry.*upload/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^File/)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check upload" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(uploaded));
    expect(check).toHaveBeenCalledOnce();
    expect(uploadVaultFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the chosen File and form fields across same-account foreground proof", async () => {
    const user = userEvent.setup();
    const view = render(form());
    const nativePicker = screen.getByLabelText(/^File/);
    choose();
    await user.clear(screen.getByLabelText(/^Collection/));
    await user.type(screen.getByLabelText(/^Collection/), "changed/collection");
    await user.type(screen.getByLabelText(/^Description/), "My original source");
    view.rerender(form(undefined, 0, true));
    expect(screen.queryByRole("dialog", { name: "Upload a file" })).not.toBeInTheDocument();
    view.rerender(form(undefined, 1));
    expect(screen.getByLabelText(/^File/)).toBe(nativePicker);
    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Collection/)).toHaveValue("changed/collection");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("My original source");
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
    expect(uploadVaultFile).not.toHaveBeenCalled();
  });

  it("delivers one pending upload success after proof resumes, without another reservation", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const close = vi.fn();
    let resolve!: (result: typeof uploaded) => void;
    vi.mocked(uploadVaultFile).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(form(saved, 0, false, "alice", close));
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    view.rerender(form(saved, 0, true, "alice", close));
    await act(async () => resolve(uploaded));
    expect(saved).not.toHaveBeenCalled();
    view.rerender(form(saved, 1, false, "alice", close));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(uploaded));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
    expect(uploadVaultFile).toHaveBeenCalledTimes(1);
    view.rerender(form(saved, 2, false, "alice", close));
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("keeps a still-pending upload busy after proof resumes", async () => {
    const user = userEvent.setup();
    let resolve!: (result: typeof uploaded) => void;
    vi.mocked(uploadVaultFile).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(form());
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    view.rerender(form(undefined, 0, true));
    view.rerender(form(undefined, 1));
    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByLabelText(/^File/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Preparing upload/ })).toBeDisabled();
    expect(uploadVaultFile).toHaveBeenCalledTimes(1);
    await act(async () => resolve(uploaded));
  });

  it("retains a completed receipt until caller visibility is restored after checking ends", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const close = vi.fn();
    let resolve!: (result: typeof uploaded) => void;
    vi.mocked(uploadVaultFile).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(form(saved, 0, false, "alice", close));
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    view.rerender(form(saved, 1, false, "alice", close, false));
    await act(async () => resolve(uploaded));
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    view.rerender(form(saved, 2, false, "alice", close, true));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(uploaded));
    expect(close).toHaveBeenCalledOnce();
    view.rerender(form(saved, 3, false, "alice", close, true));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(uploadVaultFile).toHaveBeenCalledTimes(1);
  });

  it("preserves the draft when the caller temporarily hides newly unverified write controls", () => {
    const view = render(form());
    choose();
    view.rerender(form(undefined, 1, false, "alice", undefined, false));
    expect(screen.queryByRole("dialog", { name: "Upload a file" })).not.toBeInTheDocument();
    view.rerender(form(undefined, 2));
    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
  });

  it("accepts the native picker's late change while its foreground proof hides the dialog", () => {
    const view = render(form());
    const picker = screen.getByLabelText(/^File/);
    view.rerender(form(undefined, 0, true));
    fireEvent.change(picker, { target: { files: [new File(["saved"], "report.txt")] } });
    view.rerender(form(undefined, 1));
    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeEnabled();
  });

  it("restores an uncertain upload and checks the same ref after foreground proof", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const uncertainty = new VaultFileUploadUncertainError("ops", "same-id", new Error("response lost"));
    const check = vi.spyOn(uncertainty, "checkUpload").mockResolvedValue(uploaded);
    vi.mocked(uploadVaultFile).mockRejectedValue(uncertainty);
    const view = render(form(saved));
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    await screen.findByRole("button", { name: "Check upload" });
    view.rerender(form(saved, 0, true));
    view.rerender(form(saved, 1));
    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByLabelText(/^File/)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Check upload" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(uploaded));
    expect(check).toHaveBeenCalledOnce();
    expect(uploadVaultFile).toHaveBeenCalledTimes(1);
  });

  it.each(["account", "session"])("ignores a late success only when the real %s owner changes", async (change) => {
    const user = userEvent.setup();
    const saved = vi.fn();
    let resolve!: (result: typeof uploaded) => void;
    vi.mocked(uploadVaultFile).mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(form(saved));
    choose();
    await user.click(screen.getByRole("button", { name: "Upload file" }));
    if (change === "session") setToken("replaced-session");
    view.rerender(form(saved, 1, false, change === "account" ? "bob" : "alice"));
    await act(async () => resolve(uploaded));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled());
    expect(saved).not.toHaveBeenCalled();
  });
});
