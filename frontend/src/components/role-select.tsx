import { useId, useState } from "react";
import { grantAccess } from "@/lib/api";
import { MemberRolePicker, type AssignableMemberRole } from "@/components/member-role-picker";

export interface MemberLike {
  id?: string;
  username: string;
  role: "reader" | "writer" | "admin" | "owner";
}

interface Props {
  vault: string;
  member: MemberLike;
  onChanged: (prev: string, next: string) => void;
  className?: string;
}

export function RoleSelect({ vault, member, onChanged, className }: Props) {
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(next: AssignableMemberRole) {
    const prev = member.role;
    if (busy || next === prev) return;
    setBusy(true);
    setError(null);
    try {
      await grantAccess(
        vault,
        member.id ? { id: member.id, username: member.username } : member.username,
        next,
      );
      onChanged(prev, next);
    } catch (caught: unknown) {
      setError(caught instanceof Error && caught.message ? caught.message : "Failed to change role");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex max-w-full flex-col items-end gap-1">
      <MemberRolePicker
        value={member.role}
        onChange={(next) => void changeRole(next)}
        label={`Change role for ${member.username}`}
        busy={busy}
        describedBy={error ? errorId : undefined}
        className={className}
      />
      {busy && <span role="status" className="sr-only">Updating role for {member.username}.</span>}
      {error && (
        <p id={errorId} role="alert" className="break-words text-xs text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
    </div>
  );
}
