import { forwardRef, type ReactNode } from "react";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/** Quiet group boundaries without repeating a title inside a card header. */
export const SettingsSection = forwardRef<HTMLElement, {
  id: string;
  title: string;
  children: ReactNode;
}>(({ id, title, children }, ref) => (
  <section ref={ref} id={id} role="region" aria-labelledby={`settings-${id}-heading`} className="scroll-mt-4">
    <h2 id={`settings-${id}-heading`} className={cn(
      "mb-3 text-base font-semibold",
      id === "danger" ? "text-destructive" : "text-foreground",
    )}>{title}</h2>
    <Panel variant="workspace" flush data-slot="settings-group" className={cn(
      "divide-y divide-border",
      id === "danger" ? "border-destructive" : "border-border-strong",
    )}>{children}</Panel>
  </section>
));
SettingsSection.displayName = "SettingsSection";

/** Shared label/value surface for all settings, including the inline Guide. */
export function SettingRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="settings-row" className="grid min-w-0 @[48rem]/vault-settings:grid-cols-[11rem_minmax(0,1fr)]">
      <div data-slot="settings-label" className="min-w-0 border-b border-border bg-background px-4 py-3 text-sm font-medium text-foreground @[48rem]/vault-settings:border-b-0 @[48rem]/vault-settings:border-r @[48rem]/vault-settings:py-4">
        {label}
      </div>
      <div data-slot="settings-value" className="min-w-0 bg-surface p-4">
        <div className="w-full min-w-0 max-w-4xl">{children}</div>
      </div>
    </div>
  );
}
