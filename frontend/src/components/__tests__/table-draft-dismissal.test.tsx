import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableCreateDialog } from "@/components/table-create-dialog";
import { TableRowDialog } from "@/components/table-row-dialog";

vi.mock("@/lib/api", () => ({ createVaultTable: vi.fn(), TableRowConflictError: class extends Error {} }));
afterEach(cleanup);
const columns = [{ name: "title", type: "text" }, { name: "score", type: "int" }, { name: "metadata", type: "jsonb" }];

function Form({ kind, onClose = vi.fn(), save = vi.fn().mockResolvedValue(undefined) }: {
  kind: "table" | "row" | "edit"; onClose?: () => void; save?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const change = (next: boolean) => { setOpen(next); if (!next) onClose(); };
  return kind === "table"
    ? <TableCreateDialog open={open} onOpenChange={change} vault="ops" initialCollection="operations" onCreated={vi.fn()} />
    : <TableRowDialog open={open} onOpenChange={change} mode={kind === "edit" ? "edit" : "create"} table="incidents" columns={columns} row={kind === "edit" ? { title: "Original", score: null } : undefined} onSave={save} />;
}

describe("table form draft dismissal", () => {
  it.each(["table", "row", "edit"] as const)("closes an unchanged %s form without confirmation", async (kind) => {
    const close = vi.fn();
    render(<Form kind={kind} onClose={close} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["table", "row", "edit"] as const)("retains a %s draft on Cancel and allows explicit discard", async (kind) => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<Form kind={kind} onClose={close} />);
    const field = screen.getByLabelText(kind === "table" ? /Table name/ : "title");
    await user.type(field, "draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(field).toHaveValue(kind === "edit" ? "Originaldraft" : "draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: /Discard (draft|changes)/ }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it.each([
    ["Escape", "row"], ["Close", "row"], ["Escape", "table"], ["Close", "table"],
  ] as const)("guards %s dismissal of a %s draft", async (method, kind) => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<Form kind={kind} onClose={close} />);
    const field = screen.getByLabelText(kind === "table" ? /Table name/ : "metadata");
    await user.type(field, "invalid-json");
    if (method === "Escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.getByRole("dialog", { name: kind === "table" ? "Discard table draft?" : "Discard row changes?" })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(field).toHaveValue("invalid-json");
  });

  it("protects an explicit nullable-state change", async () => {
    const user = userEvent.setup();
    render(<Form kind="edit" />);
    await user.click(screen.getAllByRole("checkbox", { name: "Null" })[1]);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard row changes?" })).toBeInTheDocument();
  });

  it("does not treat restored original values as dirty", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<Form kind="edit" onClose={close} />);
    const title = screen.getByLabelText("title");
    await user.clear(title);
    await user.type(title, "Original");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("protects structural column changes even without a table name", async () => {
    const user = userEvent.setup();
    render(<Form kind="table" />);
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard table draft?" })).toBeInTheDocument();
  });

  it("preserves failed row input and closes a successfully saved row without discard", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValueOnce(new Error("Temporary failure")).mockResolvedValue(undefined);
    const close = vi.fn();
    render(<Form kind="row" save={save} onClose={close} />);
    await user.type(screen.getByLabelText("title"), "Draft");
    await user.click(screen.getByRole("button", { name: "Add row" }));
    expect(await screen.findByText("Temporary failure")).toBeInTheDocument();
    expect(screen.getByLabelText("title")).toHaveValue("Draft");
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Discard row changes?" })).not.toBeInTheDocument();
  });

  it("locks dismissal while saving", async () => {
    const user = userEvent.setup();
    const save = vi.fn(() => new Promise<void>(() => {}));
    const close = vi.fn();
    render(<Form kind="row" save={save} onClose={close} />);
    await user.type(screen.getByLabelText("title"), "Draft");
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.keyboard("{Escape}");
    await user.click(within(screen.getByRole("dialog", { name: "Add row" })).getByRole("button", { name: "Close dialog" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Discard row changes?" })).not.toBeInTheDocument();
  });
});
