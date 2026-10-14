import type { RefObject } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCellValue, type TableCellValueText } from "@/lib/table-cell-value";
import { cn } from "@/lib/utils";

export interface ViewedTableCell {
  columnName: string;
  columnType?: string;
  /** 1-based row number as shown in the grid's `#` column. */
  rowNumber: number;
  value: unknown;
}

/**
 * Shows one table cell's complete value: the grid truncates long values, and a
 * hover tooltip cannot be selected, copied, scrolled, or opened by touch.
 */
export function TableCellViewer({
  cell,
  onOpenChange,
  returnFocusRef,
}: {
  /** The cell to show; `null` keeps the viewer closed. */
  cell: ViewedTableCell | null;
  onOpenChange: (open: boolean) => void;
  /** The control that opened the viewer; it receives focus again on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={cell !== null} onOpenChange={onOpenChange}>
      {cell && (
        <DialogContent
          className="flex max-w-3xl flex-col gap-0 overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            // The viewer has no DialogTrigger, so Radix has no element to
            // return focus to; hand it back to the cell that opened it.
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <TableCellViewerContent cell={cell} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function TableCellViewerContent({ cell }: { cell: ViewedTableCell }) {
  const value = formatCellValue(cell.value);
  return (
    <>
      <DialogHeader className="shrink-0 border-b border-border py-4 pl-5 pr-14 sm:pl-6">
        <DialogTitle className="break-all font-mono text-base tracking-normal">
          {cell.columnName}
        </DialogTitle>
        <DialogDescription>
          {cell.columnType ? `${cell.columnType} · row ${cell.rowNumber}` : `Row ${cell.rowNumber}`}
        </DialogDescription>
      </DialogHeader>
      <div
        role="region"
        aria-label="Full value"
        tabIndex={0}
        className="max-h-[60vh] min-h-0 select-text overflow-auto px-5 py-4 rail-scroll focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
      >
        <CellValueBody value={value} />
      </div>
      <div className="flex shrink-0 items-center justify-end border-t border-border bg-surface-2 px-2 py-1.5">
        {/* The "Empty string" label is not copied: an empty string copies as "". */}
        <CopyButton
          value={value.text}
          label="Copy value"
          className="h-9 w-9 focus-visible:ring-offset-surface-2"
        />
      </div>
    </>
  );
}

function CellValueBody({ value: { text, kind } }: { value: TableCellValueText }) {
  if (kind === "null") {
    return <p className="text-sm italic text-foreground-muted">null</p>;
  }
  if (kind === "json") {
    return (
      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
        {text}
      </pre>
    );
  }
  if (text === "") {
    return <p className="text-sm italic text-foreground-muted">Empty string</p>;
  }
  return (
    <p
      className={cn(
        "whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]",
        kind === "number" && "tabular-nums",
      )}
    >
      {text}
    </p>
  );
}
