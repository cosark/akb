import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeleteVaultDialog } from "../delete-vault-dialog";

afterEach(cleanup);

it("keeps available inventory in the destructive confirmation, including known zeroes", () => {
  render(<DeleteVaultDialog open onOpenChange={vi.fn()} vault="fixture" onDeleted={vi.fn()}
    inventory={{ documents: 18, tables: 2, files: 0 }} />);
  expect(screen.getByLabelText("Resources to be deleted")).toHaveTextContent("18 documents · 2 tables · 0 files");
  expect(screen.getByRole("button", { name: "Delete forever" })).toBeDisabled();
});

it("does not invent inventory when an older backend omits it", () => {
  render(<DeleteVaultDialog open onOpenChange={vi.fn()} vault="fixture" onDeleted={vi.fn()}
    inventory={{ documents: undefined, tables: undefined, files: undefined }} />);
  expect(screen.queryByLabelText("Resources to be deleted")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveTextContent("This cannot be undone.");
});
