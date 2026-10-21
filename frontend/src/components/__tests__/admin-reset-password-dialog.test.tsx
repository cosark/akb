import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdminResetPasswordDialog } from "../admin-reset-password-dialog";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ adminResetPassword: vi.fn(), authSessionSnapshot: vi.fn(() => ({ generation: 0 })), isCurrentAuthSession: vi.fn(() => true) }));

afterEach(cleanup);

describe("AdminResetPasswordDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports busy ownership and never places a late target-A receipt into target B", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.adminResetPassword>>) => void;
    vi.mocked(api.adminResetPassword).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const busy = vi.fn();
    const { rerender } = render(<AdminResetPasswordDialog userId="a" username="alice" open onOpenChange={vi.fn()} onBusyChange={busy} />);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(busy).toHaveBeenLastCalledWith(true);
    rerender(<AdminResetPasswordDialog userId="b" username="bob" open onOpenChange={vi.fn()} onBusyChange={busy} />);
    await act(async () => resolve({ temporary_password: "private-A-password", username: "alice" })); // pragma: allowlist secret — synthetic receipt fixture
    expect(screen.queryByTestId("temp-password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeEnabled();
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("clears a one-time receipt when its session no longer owns it", async () => {
    vi.mocked(api.adminResetPassword).mockResolvedValue({ temporary_password: "private-password", username: "alice" }); // pragma: allowlist secret — synthetic receipt fixture
    render(<AdminResetPasswordDialog userId="a" username="alice" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await screen.findByTestId("temp-password");
    vi.mocked(api.isCurrentAuthSession).mockReturnValueOnce(false);
    fireEvent(window, new Event("storage"));
    expect(screen.queryByTestId("temp-password")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-password");
  });

  it("calls adminResetPassword on Generate and surfaces temp password", async () => {
    (api.adminResetPassword as any).mockResolvedValue({
      temporary_password: "Abcd-1234-EfGh",
      username: "alice",
    });
    render(
      <AdminResetPasswordDialog userId="u1" username="alice" open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    const pre = await screen.findByTestId("temp-password");
    expect(pre.textContent).toBe("Abcd-1234-EfGh");
    expect(api.adminResetPassword).toHaveBeenCalledWith("u1");
  });

  it("renders error inline when adminResetPassword rejects", async () => {
    (api.adminResetPassword as any).mockRejectedValue(new Error("boom"));
    render(
      <AdminResetPasswordDialog userId="u1" username="alice" open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });

  it("Copy button writes temp password to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText }, configurable: true, writable: true,
    });
    (api.adminResetPassword as any).mockResolvedValue({
      temporary_password: "Xyz1-Wow2-Yes3", username: "bob",
    });
    render(
      <AdminResetPasswordDialog userId="u2" username="bob" open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await screen.findByTestId("temp-password");
    const btn = screen.getByRole("button", { name: /copy temporary password/i });
    btn.click();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Xyz1-Wow2-Yes3"));
    expect(await screen.findByRole("button", { name: "Temporary password copied" })).toBeInTheDocument();
  });

  it.each(["unavailable", "denied"])("F27: keeps a selectable secret and honest recovery when clipboard is %s", async state => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: state === "unavailable" ? undefined : { writeText: vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")) } });
    vi.mocked(api.adminResetPassword).mockResolvedValue({ temporary_password: "private-example", username: "reader" }); // pragma: allowlist secret — synthetic receipt fixture
    render(<AdminResetPasswordDialog userId="reader" username="reader" open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const value = await screen.findByTestId("temp-password");
    fireEvent.click(screen.getByRole("button", { name: "Copy temporary password" }));
    expect(await screen.findByText(/Copy was blocked/)).toBeVisible();
    expect(value).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("button", { name: "Temporary password copied" })).not.toBeInTheDocument();
  });
});
