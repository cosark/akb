import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AssignableMemberRole = "reader" | "writer" | "admin";

const OPTIONS: AssignableMemberRole[] = ["reader", "writer", "admin"];
const LABELS = { reader: "Reader", writer: "Writer", admin: "Admin", owner: "Owner" };

/** Shared row control: draft selection during invitation, immediate save in the roster. */
export function MemberRolePicker({ value, onChange, label, disabled = false, busy = false, describedBy, className }: {
  value?: AssignableMemberRole | "owner";
  onChange: (role: AssignableMemberRole) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  describedBy?: string;
  className?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={label}
          aria-describedby={describedBy}
          aria-busy={busy || undefined}
          disabled={disabled || busy}
          className={cn("h-11 min-w-20 justify-between gap-1.5 rounded-[var(--radius-sm)] bg-surface px-2 text-xs font-medium text-foreground sm:h-9", className)}
        >
          {value ? LABELS[value] : "Select role"}
          {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden />}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-[var(--z-popover)] min-w-32 rounded-[var(--radius-sm)] border border-border bg-surface p-1 text-foreground shadow-md">
          <DropdownMenu.RadioGroup value={value ?? ""} onValueChange={(next) => {
            if (OPTIONS.includes(next as AssignableMemberRole)) onChange(next as AssignableMemberRole);
          }}>
            {OPTIONS.map((role) => (
              <DropdownMenu.RadioItem key={role} value={role} disabled={disabled || busy} className="relative flex min-h-11 cursor-pointer select-none items-center rounded-[var(--radius-sm)] py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-surface-hover data-[state=checked]:bg-surface-selected data-[state=checked]:text-surface-selected-foreground sm:min-h-9">
                <DropdownMenu.ItemIndicator className="absolute left-2.5 inline-flex">
                  <Check className="h-4 w-4" aria-hidden />
                </DropdownMenu.ItemIndicator>
                {LABELS[role]}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
