import { useRef, type RefObject } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FilePlus, Plus, Table2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VaultCreateMenu({ triggerRef, onDocument, onTable, onUpload }: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDocument: () => void;
  onTable: () => void;
  onUpload: () => void;
}) {
  const launching = useRef(false);
  return <DropdownMenu.Root modal={false} onOpenChange={open => { if (open) launching.current = false; }}>
    <DropdownMenu.Trigger asChild>
      <Button ref={triggerRef} variant="accent" size="sm" className="min-h-11 sm:min-h-8 [@media(pointer:coarse)]:min-h-11" aria-label="New content">
        <Plus className="h-4 w-4" aria-hidden />New<ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} aria-label="Create content"
        onCloseAutoFocus={event => { if (launching.current) event.preventDefault(); }}
        className="z-[var(--z-popover)] min-w-48 rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-md">
        {[
          { label: "New document", Icon: FilePlus, action: onDocument },
          { label: "New table", Icon: Table2, action: onTable },
          { label: "Upload file", Icon: Upload, action: onUpload },
        ].map(({ label, Icon, action }) => <DropdownMenu.Item key={label}
          onSelect={() => {
            launching.current = true;
            // The shared document dialog records the active element. Record a
            // persistent trigger, not a menu item that disappears on selection.
            triggerRef.current?.focus();
            action();
          }}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm text-foreground outline-none data-[highlighted]:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Icon className="h-4 w-4 text-foreground-muted" aria-hidden />{label}
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
