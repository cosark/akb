import { describe, expect, it } from "vitest";
import { publicationAvailability } from "@/lib/publication-state";

const NOW = Date.parse("2026-10-14T00:00:00Z");
const UNLIMITED = { expires_at: null, max_views: null, view_count: 12 };

describe("publication availability", () => {
  it("requires observed unrestricted or unreached limits for Active", () => {
    expect(publicationAvailability(UNLIMITED, NOW)).toBe("active");
    expect(publicationAvailability({ ...UNLIMITED, expires_at: "2026-10-15T00:00:00Z", max_views: 13 }, NOW)).toBe("active");
  });

  it("expires at the exact deadline, including when the view cap is reached", () => {
    expect(publicationAvailability({ ...UNLIMITED, expires_at: "2026-10-14T00:00:00Z", max_views: 12 }, NOW)).toBe("expired");
    expect(publicationAvailability({ ...UNLIMITED, expires_at: "2026-08-01T00:00:00Z" }, NOW)).toBe("expired");
  });

  it("marks a reached or exceeded view cap even if expiry is unknown", () => {
    expect(publicationAvailability({ ...UNLIMITED, max_views: 12 }, NOW)).toBe("view-limit-reached");
    expect(publicationAvailability({ max_views: 10, view_count: 12 }, NOW)).toBe("view-limit-reached");
  });

  it.each([
    { max_views: null, view_count: 12 },
    { ...UNLIMITED, expires_at: undefined },
    { ...UNLIMITED, expires_at: "invalid" },
    { expires_at: null, view_count: 12 },
    { expires_at: null, max_views: 13 },
    { ...UNLIMITED, max_views: NaN },
  ])("does not invent availability from incomplete limits: %j", (publication) => {
    expect(publicationAvailability(publication, NOW)).toBe("unknown");
  });
});
