import { expect, test } from "@playwright/test";

test.skip(process.env.AKB_FE_E2E_MODE === "mock", "Owns isolated HTTP responses; never writes user data.");

for (const width of [375, 1440]) for (const dark of [false, true]) {
  test(`bounded navigation preserves rows and scope guidance at ${width}px ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ dark }) => {
      localStorage.setItem("akb_token", "bounded-navigation-fixture");
      localStorage.setItem("akb_theme", dark ? "dark" : "light");
      localStorage.setItem("akb.treeVisible", "1");
      localStorage.setItem("akb-explorer-expanded:alpha", JSON.stringify(["guides"]));
    }, { dark });
    const browseRequests: URL[] = [];
    let nextAttempts = 0;
    let grepRequests = 0;
    await page.route("**/health/**", route => route.fulfill({ json: {} }));
    await page.route("**/api/v1/**", route => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.endsWith("/auth/config")) return route.fulfill({ json: { schema_version: 2, auth_mode: "local", local_auth: { enabled: true }, keycloak: { enabled: false, browser_session_ready: false }, providers: [], mcp_oauth: { enabled: false } } });
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { user_id: "paging-reader", username: "reader", display_name: "Reader", email: "reader@example.invalid", auth_method: "local", is_admin: false } });
      if (path.endsWith("/vaults")) return route.fulfill({ json: { vaults: [{ id: "alpha", name: "alpha", role: "reader" }] } });
      if (path.endsWith("/info")) return route.fulfill({ json: { name: "alpha", role: "reader", document_count: 101, collection_count: 1, is_archived: false, is_external_git: false } });
      if (path.includes("/browse/")) {
        browseRequests.push(url);
        if (url.searchParams.get("cursor")) {
          nextAttempts++;
          if (nextAttempts === 1) return route.fulfill({ status: 503, json: { error: "Read temporarily unavailable", code: "service_unavailable" } });
          return route.fulfill({ json: { vault: "alpha", path: "", archive_scope: "unarchived", scanned: 1, complete: true, next_cursor: null, items: [
            { type: "document", name: "Second loaded document", path: "guides/second.md", uri: "akb://alpha/coll/guides/doc/second.md" },
          ] } });
        }
        return route.fulfill({ json: { vault: "alpha", path: "", archive_scope: "unarchived", scanned: 100, complete: false, next_cursor: "next-position", items: [
          { type: "collection", name: "Guides", path: "guides", uri: "akb://alpha/coll/guides" },
          { type: "document", name: "First loaded document", path: "guides/first.md", uri: "akb://alpha/coll/guides/doc/first.md" },
        ] } });
      }
      if (path.endsWith("/grep")) {
        grepRequests++;
        return route.fulfill({ status: 422, json: { error: "Candidate resources exceed 10000. Narrow the Collection scope; result limit does not reduce scanning.", code: "grep_scope_too_large", hint: "Use collection." } });
      }
      return route.fulfill({ json: { items: [], history: [], relations: [], subscribed: false, unread_count: 0 } });
    });
    await page.goto("/vault/alpha");
    if (width < 1024) await page.getByRole("button", { name: "Open vault navigation", exact: true }).click();
    const first = page.getByRole("link", { name: "Document: First loaded document", exact: true });
    await expect(first).toBeVisible();
    await expect(page.getByText(/Only part of this scope is loaded/)).toBeVisible();
    expect(browseRequests).toHaveLength(1);
    expect(browseRequests[0].searchParams.get("page_size")).toBe("100");
    await page.screenshot({ path: testInfo.outputPath("partial-tree.png") });
    const next = page.getByRole("button", { name: "Load next page", exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Read temporarily unavailable", { exact: true })).toBeVisible();
    await expect(first).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry loading more items", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Document: Second loaded document", exact: true })).toBeVisible();
    await expect(first).toBeVisible();
    await expect(page.getByText(/Only part of this scope is loaded/)).toHaveCount(0);
    expect(browseRequests.slice(1).map(url => url.searchParams.get("cursor"))).toEqual(["next-position", "next-position"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("bounded-tree.png") });

    await page.goto("/search?q=needle&mode=literal&v=alpha");
    await expect(page.getByText("Narrow the search scope", { exact: true })).toBeVisible();
    await expect(page.getByText("Search unavailable", { exact: true })).toHaveCount(0);
    // Development StrictMode can issue the initial effect twice. Recovery
    // must not issue another unchanged-scope request in either build mode.
    const beforeRecovery = grepRequests;
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose a Collection in Filters" }).click();
    await expect(page.getByRole("textbox", { name: "Collection path (including children)" })).toBeFocused();
    expect(grepRequests).toBe(beforeRecovery);
    await page.screenshot({ path: testInfo.outputPath("grep-scope-guidance.png") });
  });
}
