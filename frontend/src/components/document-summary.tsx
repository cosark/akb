import { useId, useState } from "react";
import { TextQuote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function DocumentSummary({ summary }: { summary?: string | null }) {
  if (!summary?.trim()) return null;
  // A different document/summary closes the old popover.
  return <SummaryPreview key={summary} summary={summary} />;
}

function SummaryPreview({ summary }: { summary: string }) {
  const titleId = useId();
  const textId = useId();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return <div className="document-summary">
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={250}><Tooltip open={tooltipOpen && !open} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild><PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Read document summary"
            data-reader-control data-reader-icon data-summary-open={open}
            className="document-summary-trigger text-foreground-muted hover:text-link">
            <TextQuote className="h-4 w-4" aria-hidden />
          </Button>
        </PopoverTrigger></TooltipTrigger>
        <TooltipContent side="bottom">Read summary</TooltipContent>
      </Tooltip></TooltipProvider>
      <PopoverContent align="start" side="bottom" collisionPadding={16}
        aria-labelledby={titleId} aria-describedby={textId}
        className="document-summary-popup w-[30rem] max-w-[calc(100vw-2rem)] max-h-[min(22.5rem,var(--radix-popover-content-available-height))] rounded-[var(--radius-lg)] p-5">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-sm font-semibold">Document summary</h2>
          <PopoverClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Close summary"
              className="-mr-2 -my-2 h-11 w-11 text-foreground-muted sm:h-8 sm:w-8">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </PopoverClose>
        </div>
        <p id={textId} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-muted">{summary}</p>
      </PopoverContent>
    </Popover>
  </div>;
}
