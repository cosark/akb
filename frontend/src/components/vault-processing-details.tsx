import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchStatusStages } from "@/components/search-status-stages";
import { useOptionalSearchStatus } from "@/hooks/use-search-status";

/** Operational observations live beside Overview's queue badge, not in settings. */
export function VaultProcessingDetails({ vaultName }: { vaultName: string }) {
  const titleId = useId();
  const status = useOptionalSearchStatus();
  const observation = status?.verified
    ? status.observations.find(row => row.vaultName === vaultName)
    : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="min-h-10 px-2 text-xs text-link sm:min-h-8">
          Indexing details
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-labelledby={titleId}>
        <h2 id={titleId} className="mb-3 text-sm font-semibold">Indexing details</h2>
        <SearchStatusStages observation={observation} />
      </PopoverContent>
    </Popover>
  );
}
