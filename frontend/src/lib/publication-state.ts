import type { Publication } from "@/lib/api";

export type PublicationAvailability = "active" | "expired" | "view-limit-reached" | "unknown";

// Availability describes the observed expiry/view limits, independently of
// Live/Snapshot delivery and any password challenge. Missing limits are not
// proof that a legacy response is unrestricted.
export function publicationAvailability(
  publication: Partial<Pick<Publication, "expires_at" | "max_views" | "view_count">>,
  now = Date.now(),
): PublicationAvailability {
  const expiry = typeof publication.expires_at === "string"
    ? Date.parse(publication.expires_at)
    : NaN;
  if (Number.isFinite(expiry) && expiry <= now) return "expired";

  const max = publication.max_views;
  const views = publication.view_count;
  const knownCap = typeof max === "number" && Number.isSafeInteger(max) && max >= 0;
  const knownViews = typeof views === "number" && Number.isSafeInteger(views) && views >= 0;
  if (knownCap && knownViews && views >= max) return "view-limit-reached";

  const knownExpiry = publication.expires_at === null || Number.isFinite(expiry);
  const knownViewLimit = max === null || (knownCap && knownViews);
  return knownExpiry && knownViewLimit ? "active" : "unknown";
}
