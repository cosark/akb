import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { markNotification } from "@/lib/api-notifications";
import { useModalOpen } from "@/lib/modal-visibility";
import { NOTIFICATION_READ_FAILURE, notificationReadFailure, notificationReadOwner, sameNotificationReadOwner,
  type NotificationReadFailure, type NotificationReadOwner } from "@/lib/notification-read-feedback";

export function NotificationReadFeedback(props: { inboxOpen: boolean; onReviewCurrent: () => void }) {
  const user = useCurrentUser();
  const { checking, revision } = useAccessVerification();
  if (!user || checking) return null;
  const owner = notificationReadOwner(user.user_id, revision);
  return <ReadFeedbackState key={JSON.stringify(owner)} owner={owner} {...props} />;
}

function ReadFeedbackState({ owner, inboxOpen, onReviewCurrent }: {
  owner: NotificationReadOwner; inboxOpen: boolean; onReviewCurrent: () => void;
}) {
  const client = useQueryClient();
  const modalOpen = useModalOpen();
  const [failure, setFailure] = useState<NotificationReadFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const receive = (event: Event) => {
      const next = (event as CustomEvent<NotificationReadFailure>).detail;
      if (next && sameNotificationReadOwner(next.owner, owner)
        && sameNotificationReadOwner(owner, notificationReadOwner(owner.userId, owner.revision))) setFailure(next);
    };
    window.addEventListener(NOTIFICATION_READ_FAILURE, receive);
    return () => { active.current = false; window.removeEventListener(NOTIFICATION_READ_FAILURE, receive); };
  }, [owner]);

  async function recover() {
    if (!failure || busy) return;
    const stillOwned = () => active.current && sameNotificationReadOwner(owner, notificationReadOwner(owner.userId, owner.revision));
    if (!stillOwned()) { setFailure(null); return; }
    const observed = failure;
    setBusy(true);
    try {
      if (observed.conflict) {
        // Fetch and visibly review first. Never substitute an unseen newer
        // version into the old acknowledgement request.
        await client.invalidateQueries({ queryKey: ["notifications", owner.userId, "inbox", "all", "all"], refetchType: "all" }, { throwOnError: true });
        if (!stillOwned()) return;
        onReviewCurrent();
      } else {
        await markNotification(observed.item, true);
        if (!stillOwned()) return;
        await client.invalidateQueries({ queryKey: ["notifications", owner.userId] });
      }
      if (!stillOwned()) return;
      setFailure(current => current === observed ? null : current);
    } catch (error) {
      if (!stillOwned()) return;
      setFailure(current => current === observed ? observed.conflict
        ? { ...observed, message: "Could not refresh the current notification. Review it again before marking it read." }
        : notificationReadFailure(owner, observed.item, error) : current);
    } finally { if (active.current) setBusy(false); }
  }

  if (!failure || inboxOpen || modalOpen) return null;
  return <Alert variant="warning" className="fixed bottom-4 right-4 z-[var(--z-toast)] max-w-[min(26rem,calc(100vw-2rem))] shadow-md">
    <p>{failure.message}</p><div className="mt-2 flex gap-2">
      <Button variant="outline" size="sm" loading={busy} onClick={() => void recover()}>{failure.conflict ? "Review current notification" : "Retry marking read"}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFailure(null)}>Dismiss</Button>
    </div>
  </Alert>;
}
