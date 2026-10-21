import { authSessionSnapshot } from "@/lib/api";
import { NotificationConflict, type NotificationItem } from "@/lib/api-notifications";

export const NOTIFICATION_READ_FAILURE = "akb:notification-read-failure";
export interface NotificationReadOwner { userId: string; revision: number; sessionGeneration: number }
export interface NotificationReadFailure {
  owner: NotificationReadOwner;
  item: NotificationItem;
  conflict: boolean;
  message: string;
}

export function notificationReadOwner(userId: string, revision: number): NotificationReadOwner {
  // Only the generation travels in this event, never credentials.
  return { userId, revision, sessionGeneration: authSessionSnapshot().generation };
}

export function notificationReadFailure(owner: NotificationReadOwner, item: NotificationItem, error: unknown): NotificationReadFailure {
  const conflict = error instanceof NotificationConflict;
  return { owner, item, conflict, message: conflict
    ? "This notification changed. Review its current update before marking it read."
    : "The notification could not be marked read. Retry without reopening the resource." };
}

/** The authenticated header owns feedback after either Inbox surface unmounts. */
export function reportNotificationReadFailure(owner: NotificationReadOwner, item: NotificationItem, error: unknown) {
  window.dispatchEvent(new CustomEvent<NotificationReadFailure>(NOTIFICATION_READ_FAILURE, {
    detail: notificationReadFailure(owner, item, error),
  }));
}

export function sameNotificationReadOwner(first: NotificationReadOwner, second: NotificationReadOwner): boolean {
  return first.userId === second.userId && first.revision === second.revision && first.sessionGeneration === second.sessionGeneration;
}
