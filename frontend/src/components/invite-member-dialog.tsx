import { useEffect, useMemo, useState, type RefObject } from "react";
import { Box, Check, Search, UserPlus, UserRound, X } from "lucide-react";
import { searchUsers, grantAccess } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberRolePicker, type AssignableMemberRole } from "@/components/member-role-picker";
import { cn } from "@/lib/utils";

interface UserHit {
  id: string;
  username: string;
  display_name?: string | null;
  email: string;
  account_kind: "human" | "service";
  account_status: string;
}

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: string;
  /** Durable IDs already in the vault — hidden from search results. */
  existingUserIds: Set<string>;
  onInvited: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const ROLE_LABELS: Record<AssignableMemberRole, string> = {
  reader: "Reader",
  writer: "Writer",
  admin: "Admin",
};

export function InviteMemberDialog({
  open,
  onOpenChange,
  vault,
  existingUserIds,
  onInvited,
  returnFocusRef,
}: InviteMemberDialogProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 250);
  const [hits, setHits] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [role, setRole] = useState<AssignableMemberRole>("reader");
  const [searchError, setSearchError] = useState("");
  const [grantError, setGrantError] = useState("");
  const [retry, setRetry] = useState(0);
  const [granting, setGranting] = useState(false);

  const exclusionKey = useMemo(
    () => Array.from(existingUserIds).sort().join(","),
    [existingUserIds],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setSelected(null);
      setRole("reader");
      setSearchError("");
      setGrantError("");
    }
  }, [open]);

  useEffect(() => {
    if (selected && existingUserIds.has(selected.id)) {
      setSelected(null);
      setGrantError("");
    }
  }, [selected, existingUserIds]);

  // Keep old rows while the next directory request is pending, but disable
  // them so a stale search result cannot be invited accidentally.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSearching(true);
    setSearchError("");
    searchUsers(debouncedQuery || undefined)
      .then((result) => {
        if (cancelled) return;
        setHits((result.users || []).filter((user) => !existingUserIds.has(user.id)));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setHits([]);
        setSearchError(errorMessage(caught, "Could not load accounts"));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => { cancelled = true; };
    // The canonical exclusion key avoids restarting on equivalent Set instances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, open, exclusionKey, retry]);

  function chooseRole(user: UserHit, nextRole: AssignableMemberRole) {
    if (granting) return;
    setSelected(user);
    setRole(nextRole);
    setGrantError("");
  }

  async function handleGrant() {
    if (!selected || granting || existingUserIds.has(selected.id)) return;
    setGranting(true);
    setGrantError("");
    try {
      await grantAccess(vault, { id: selected.id, username: selected.username }, role);
      onInvited();
      onOpenChange(false);
    } catch (caught: unknown) {
      setGrantError(errorMessage(caught, "Failed to grant access"));
    } finally {
      setGranting(false);
    }
  }

  const pendingSearch = searching || query.trim() !== debouncedQuery;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !granting && onOpenChange(nextOpen)}>
      <DialogContent
        className="flex max-w-2xl flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border bg-surface px-4 py-4 pr-12 sm:px-5 sm:pr-14">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
            <DialogTitle className="text-base">Invite member</DialogTitle>
            <span className="ml-1 inline-flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
              <Box className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate" title={vault}>{vault}</span>
            </span>
          </div>
          <DialogDescription className="text-xs">
            Choose one account and a role. Access applies to this vault.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
          <Label htmlFor="invite-search" className="sr-only">Search AKB accounts</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" aria-hidden />
            <Input
              id="invite-search"
              type="search"
              placeholder="Search name, username, or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={granting}
              className="bg-surface pl-9"
              autoFocus
            />
          </div>
          <p className="mt-2 text-xs text-foreground-muted">Existing vault members are hidden.</p>
        </div>

        <div data-testid="invite-body" className="rail-scroll min-h-0 max-h-80 flex-1 overflow-y-auto overscroll-contain" aria-busy={pendingSearch}>
          {searchError ? (
            <div className="p-4 sm:p-5">
              <Alert variant="destructive" title="Could not load accounts">
                {searchError}
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => setRetry((current) => current + 1)}>Try again</Button>
                </div>
              </Alert>
            </div>
          ) : pendingSearch && hits.length === 0 ? (
            <div className="flex min-h-28 items-center justify-center p-4 text-sm text-foreground-muted" role="status">
              Searching accounts…
            </div>
          ) : hits.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center px-6 py-5 text-center" role="status">
              <UserRound className="h-5 w-5 text-foreground-muted" aria-hidden />
              <p className="mt-2 text-sm font-medium">{debouncedQuery ? "No matching accounts" : "No accounts available"}</p>
              <p className="mt-1 text-xs text-foreground-muted">Only active AKB accounts can be invited.</p>
            </div>
          ) : (
            <table aria-label="Accounts to invite" className="w-full table-fixed border-collapse">
              <thead className="border-b border-border bg-surface text-left text-xs text-foreground-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium sm:px-5">Account</th>
                  <th scope="col" className="w-32 px-4 py-2 text-right font-medium sm:w-36 sm:px-5">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {hits.map((user) => {
                  const active = selected?.id === user.id;
                  return (
                    <tr key={user.id} data-selected={active || undefined} className={cn("transition-token", active ? "bg-surface-selected" : "hover:bg-surface-hover")}>
                      <td className="min-w-0 px-4 py-3 align-middle sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar user={user} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{user.display_name?.trim() || user.username}</span>
                              {active && <><Check className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden /><span className="sr-only">Selected account</span></>}
                              {user.account_kind === "service" && <Badge variant="default">Service account</Badge>}
                            </div>
                            <p className="mt-0.5 break-words text-xs text-foreground-muted [overflow-wrap:anywhere]">
                              @{user.username}{user.email && <> · {user.email}</>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right align-middle sm:px-5">
                        <MemberRolePicker
                          value={active ? role : undefined}
                          onChange={(nextRole) => chooseRole(user, nextRole)}
                          label={`Select role for ${user.username}`}
                          disabled={granting || pendingSearch}
                          className="w-full"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div data-testid="invite-footer" className="shrink-0 border-t border-border bg-surface px-4 py-3 sm:px-5">
          {grantError && <Alert variant="destructive" className="mb-3">{grantError}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <p data-testid="invite-summary" className="min-w-0 break-words text-xs text-foreground-muted [overflow-wrap:anywhere]" role="status" aria-live="polite" aria-atomic="true">
                {selected ? <><span className="font-semibold text-foreground">{selected.display_name?.trim() || selected.username}</span> will join as {ROLE_LABELS[role]}.</> : "Select a role beside an account to continue."}
              </p>
              {selected && <Button type="button" variant="ghost" size="icon" aria-label="Clear selected account" disabled={granting} onClick={() => { setSelected(null); setGrantError(""); }} className="shrink-0"><X className="h-3.5 w-3.5" aria-hidden /></Button>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={granting}>Cancel</Button>
              <Button type="button" variant="accent" onClick={() => void handleGrant()} loading={granting} disabled={!selected}>Invite</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserAvatar({ user }: { user: UserHit }) {
  const label = user.display_name?.trim() || user.username;
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : label.slice(0, 2).toUpperCase();
  return <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-foreground sm:flex">{initials}</span>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
