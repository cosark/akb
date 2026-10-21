import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableCreateDialog } from "@/components/table-create-dialog";
import { createVaultTable } from "@/lib/api";

vi.mock("@/lib/api", async () => ({ ...await vi.importActual("@/lib/api"), createVaultTable: vi.fn() }));
beforeEach(() => { vi.mocked(createVaultTable).mockReset(); });
afterEach(cleanup);

describe("table creation across foreground proof", () => {
  it("preserves the draft and collection when only visibility changes", async () => {
    const user = userEvent.setup();
    const props = { open: true, vault: "team", initialCollection: "notes", onOpenChange: vi.fn(), onCreated: vi.fn() };
    const { rerender } = render(<TableCreateDialog {...props} />);
    await user.type(screen.getByLabelText(/^Table name/), "incidents");
    await user.clear(screen.getByLabelText(/^Collection/));
    await user.type(screen.getByLabelText(/^Collection/), "reports");
    rerender(<TableCreateDialog {...props} visible={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<TableCreateDialog {...props} visible />);
    expect(screen.getByLabelText(/^Table name/)).toHaveValue("incidents");
    expect(screen.getByLabelText(/^Collection/)).toHaveValue("reports");
  });
  it("delivers completion once after the latest proof permits the dialog", async () => {
    const user = userEvent.setup();
    let finish!: (result: Awaited<ReturnType<typeof createVaultTable>>) => void;
    vi.mocked(createVaultTable).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const props = { open: true, vault: "team", onOpenChange: vi.fn(), onCreated: vi.fn() };
    const { rerender } = render(<TableCreateDialog {...props} />);
    await user.type(screen.getByLabelText(/^Table name/), "incidents");
    await user.type(screen.getByLabelText("Name", { exact: true }), "title");
    await user.click(screen.getByRole("button", { name: /^Create table$/ }));
    rerender(<TableCreateDialog {...props} visible={false} />);
    await act(async () => finish({} as Awaited<ReturnType<typeof createVaultTable>>));
    expect(props.onCreated).not.toHaveBeenCalled();
    rerender(<TableCreateDialog {...props} visible />);
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("incidents"));
    rerender(<TableCreateDialog {...props} visible />);
    expect(props.onCreated).toHaveBeenCalledTimes(1);
  });
});
