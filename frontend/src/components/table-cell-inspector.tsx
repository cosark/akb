import type { RefObject } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeSnippet } from "@/components/ui/code-snippet";

export interface InspectedTableCell { column: string; row: number; value: string }

export function TableCellInspector({ cell, onClose, returnFocusRef }: {
  cell: InspectedTableCell | null; onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return <Dialog open={cell !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl" onCloseAutoFocus={event => {
      event.preventDefault(); returnFocusRef.current?.focus({ preventScroll: true });
    }}>
      <DialogHeader><DialogTitle>Cell value</DialogTitle><DialogDescription>Row {cell?.row} · {cell?.column}. Read, select, or copy the full value.</DialogDescription></DialogHeader>
      {cell && <CodeSnippet code={cell.value} filename={cell.column} />}
    </DialogContent>
  </Dialog>;
}
