import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableCellViewer, type ViewedTableCell } from "@/components/table-cell-viewer";
import { formatCellValue } from "@/lib/table-cell-value";

describe("formatCellValue", () => {
  it.each([
    [{ service: "gateway", tags: ["api"] }, '{\n  "service": "gateway",\n  "tags": [\n    "api"\n  ]\n}', "json"],
    [[1, 2], "[\n  1,\n  2\n]", "json"],
    ["first line\nsecond line", "first line\nsecond line", "text"],
    ["", "", "text"],
    [42.5, "42.5", "number"],
    [Number.NaN, "—", "number"],
    [Number.POSITIVE_INFINITY, "—", "number"],
    [false, "false", "boolean"],
    [null, "null", "null"],
    [undefined, "null", "null"],
  ])("renders %j as its full text", (value, text, kind) => {
    expect(formatCellValue(value)).toEqual({ text, kind });
  });
});

function Harness({ cell }: { cell: ViewedTableCell }) {
  const [viewed, setViewed] = useState<ViewedTableCell | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setViewed(cell)}>
        Open cell
      </button>
      <TableCellViewer
        cell={viewed}
        onOpenChange={(open) => !open && setViewed(null)}
        returnFocusRef={trigger}
      />
    </>
  );
}

describe("TableCellViewer", () => {
  it("is closed until a cell is given", () => {
    render(<TableCellViewer cell={null} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the dialog after the column and describes its type and row", async () => {
    const user = userEvent.setup();
    render(<Harness cell={{ columnName: "payload", columnType: "jsonb", rowNumber: 12, value: { ok: true } }} />);
    await user.click(screen.getByRole("button", { name: "Open cell" }));

    const dialog = screen.getByRole("dialog", { name: "payload" });
    expect(dialog).toHaveAccessibleDescription("jsonb · row 12");
    expect(within(dialog).getByRole("region", { name: "Full value" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Copy value" })).toBeInTheDocument();
  });

  it("describes only the row when the column type is unknown", async () => {
    const user = userEvent.setup();
    render(<Harness cell={{ columnName: "note", rowNumber: 3, value: "Ready" }} />);
    await user.click(screen.getByRole("button", { name: "Open cell" }));
    expect(screen.getByRole("dialog", { name: "note" })).toHaveAccessibleDescription("Row 3");
  });

  it("marks an empty string instead of showing an empty box", async () => {
    const user = userEvent.setup();
    render(<Harness cell={{ columnName: "note", columnType: "text", rowNumber: 1, value: "" }} />);
    await user.click(screen.getByRole("button", { name: "Open cell" }));
    const body = within(screen.getByRole("dialog")).getByRole("region", { name: "Full value" });
    expect(within(body).getByText("Empty string")).toHaveClass("italic", "text-foreground-muted");
  });

  it("returns focus to the opening control when closed", async () => {
    const user = userEvent.setup();
    render(<Harness cell={{ columnName: "note", rowNumber: 1, value: "Ready" }} />);
    const open = screen.getByRole("button", { name: "Open cell" });
    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(open).toHaveFocus());
  });
});
