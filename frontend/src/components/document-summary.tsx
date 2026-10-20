import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function DocumentSummary({ summary }: { summary?: string | null }) {
  if (!summary?.trim()) return null;
  // A different document/summary closes the old popover and resets its scan.
  return <SummaryPreview key={summary} summary={summary} />;
}

function SummaryPreview({ summary }: { summary: string }) {
  const titleId = useId();
  const textId = useId();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;
    let active = true;
    const measure = () => {
      const distance = text.scrollWidth - viewport.clientWidth;
      // Carry the last word past the 2rem fade so it is readable at rest.
      if (active) setOverflow(distance > 1 ? distance + 32 : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, []);

  return <div className="document-summary">
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="Read document summary"
          className="document-summary-trigger min-w-0 max-w-full gap-1.5 px-1.5 text-xs font-normal text-foreground-muted hover:text-link">
          <span className="shrink-0">Summary</span>
          <span ref={viewportRef} aria-hidden className="document-summary-excerpt" data-overflow={overflow > 1 || undefined}>
            <span ref={textRef} className="document-summary-track"
              style={{ "--summary-overflow": overflow, "--summary-pan-distance": `${-overflow}px` } as CSSProperties}>
              {summary}
            </span>
          </span>
          <ChevronDown className="document-summary-chevron h-3 w-3 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" collisionPadding={16}
        aria-labelledby={titleId} aria-describedby={textId}
        className="w-[30rem] max-w-[calc(100vw-2rem)] max-h-[min(22.5rem,var(--radix-popover-content-available-height))] rounded-[var(--radius-lg)] p-5">
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
