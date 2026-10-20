import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface Bounds { top: number; right: number; width: number; height: number; modal: boolean }

/** Portal the inspector so hidden/offscreen content cannot scroll the table's parent. */
export function TableSchemaOverlay({ open, onOpenChange, anchorRef, returnFocusRef, closeFocusRef, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
  closeFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [bounds, setBounds] = useState<Bounds>({ top: 0, right: 0, width: 480, height: window.innerHeight, modal: window.innerWidth < 768 });
  const outsideInteraction = useRef(false);
  const stillOpen = useRef(open);

  useLayoutEffect(() => { stillOpen.current = open; }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const width = rect.width || window.innerWidth;
      const top = Math.max(0, rect.top);
      setBounds({
        top,
        right: rect.width ? Math.max(0, window.innerWidth - rect.right) : 0,
        width: Math.min(480, width),
        height: Math.max(0, Math.min(rect.height || window.innerHeight, window.innerHeight - top)),
        // Use the available workspace, not the browser's desktop breakpoint.
        modal: width < 768,
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [anchorRef, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={bounds.modal}>
      <DialogContent
        hideClose
        className="left-auto top-auto flex max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0"
        style={{ top: bounds.top, right: bounds.right, width: bounds.width, height: bounds.height }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          outsideInteraction.current = false;
          closeFocusRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Radix replaces its Content implementation when modal changes on
          // resize. That unmount is not a dismissal of this open inspector.
          if (!stillOpen.current && !outsideInteraction.current) returnFocusRef.current?.focus({ preventScroll: true });
        }}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && returnFocusRef.current?.contains(event.target)) {
            // The toggle owns this interaction; avoid close + immediate reopen.
            event.preventDefault();
          } else if (!bounds.modal) {
            outsideInteraction.current = true;
          }
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
