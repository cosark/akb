import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Section dividers inside the Vault settings ledger. The parent owns its panel. */
export const SettingsSection = forwardRef<HTMLElement, {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}>(({ id, title, children, className }, ref) => (
  <section ref={ref} id={id} role="region" aria-labelledby={`settings-${id}-heading`} className={cn("@container/settings-section min-w-0 scroll-mt-4", className)}>
    <h3 id={`settings-${id}-heading`} className={cn(
      "border-b border-border bg-background/60 px-4 py-2.5 text-sm font-semibold sm:px-5",
      id === "danger" ? "text-destructive" : "text-foreground",
    )}>{title}</h3>
    <div data-slot="settings-group" className="divide-y divide-border">{children}</div>
  </section>
));
SettingsSection.displayName = "SettingsSection";

/** A plain label/control row; no nested card, label fill or vertical borders. */
export function SettingRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="settings-row" className="grid min-w-0 gap-2 px-4 py-4 sm:px-5 @[48rem]/settings-section:grid-cols-[11rem_minmax(0,1fr)] @[48rem]/settings-section:gap-x-8">
      <div data-slot="settings-label" className="min-w-0 text-sm font-medium leading-6 text-foreground">
        {label}
      </div>
      <div data-slot="settings-value" className="min-w-0">
        <div className="w-full min-w-0">{children}</div>
      </div>
    </div>
  );
}
