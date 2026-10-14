import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.AKB_FE_E2E_MODE === "mock", "Owns isolated HTTP fixtures; no user Vault requests.");
test.use({ reducedMotion: "reduce" });

const documentPath = "guides/reading.md";
const documentUrl = `/vault/fixture/doc/${encodeURIComponent(documentPath)}`;
const title = "Reading decisions for a shared workspace";
const destinations = [
  ["Overview", "/vault/fixture"],
  ["Graph", "/vault/fixture/graph"],
  ["Public links", "/vault/fixture/publications"],
  ["Members", "/vault/fixture/members"],
  ["Settings", "/vault/fixture/settings"],
] as const;

async function fixture(page: Page, dark = false, treeVisible = "1") {
  await page.addInitScript(({ dark, treeVisible }) => {
    localStorage.setItem("akb_token", "document-header-browser-fixture");
    localStorage.setItem("akb_theme", dark ? "dark" : "light");
    if (!localStorage.getItem("document-header-fixture-ready")) {
      localStorage.setItem("akb.treeVisible", treeVisible);
      localStorage.setItem("akb.treeWidth.v2", "286");
      localStorage.setItem("akb.vaultRailCollapsed", "0");
      localStorage.setItem("document-header-fixture-ready", "1");
    }
  }, { dark, treeVisible });
  await page.route("**/health**", route => route.fulfill({ json: {} }));
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json: object = { items: [], history: [], changes: [], relations: [], subscribed: false, unread_count: 0 };
    if (path.endsWith("/auth/config")) json = { schema_version: 2, auth_mode: "local", local_auth: { enabled: true }, keycloak: { enabled: false, browser_session_ready: false }, providers: [], mcp_oauth: { enabled: false } };
    else if (path.endsWith("/auth/me")) json = { user_id: "document-header-owner", username: "fixture", display_name: "Reading reviewer", email: "reviewer@example.invalid", auth_method: "local", is_admin: false };
    else if (path.endsWith("/vaults")) json = { vaults: [{ id: "document-header-vault", name: "fixture", role: "owner" }] };
    else if (path.endsWith("/info")) json = { name: "fixture", role: "owner", public_access: "none", is_archived: false, is_external_git: false, document_count: 1, collection_count: 1 };
    else if (path.endsWith("/members")) json = { members: [{ user_id: "document-header-owner", username: "fixture", display_name: "Reading reviewer", email: "reviewer@example.invalid", role: "owner", since: "2026-09-01T00:00:00Z" }] };
    else if (path.includes("/browse/")) json = { items: [{ type: "collection", path: "guides", name: "Guides", doc_count: 1 }, { type: "document", path: documentPath, name: title }] };
    else if (path.includes("/publications/")) json = { publications: [] };
    else if (path.endsWith("/graph/overview")) json = { nodes: [], edges: [], nodes_total: 0, edges_total: 0, returned: 0, truncated: false };
    else if (path.includes("/documents/fixture/") && !path.endsWith("/history")) json = { uri: `akb://fixture/coll/guides/doc/reading.md`, path: documentPath, title, content: "# Reading context\n\nKeep decisions close to their source.", status: "active", current_commit: "aaaaaaaaaaaaa", updated_at: "2026-09-01T00:00:00Z" };
    return route.fulfill({ json });
  });
}

for (const width of [375, 1440]) for (const dark of [false, true]) {
  test(`document header owns Vault links and reading tools at ${width}px ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, dark);
    await page.goto(documentUrl);
    const trigger = page.getByRole("button", { name: "Vault pages for fixture", exact: true });
    const location = page.getByRole("navigation", { name: "Resource location", exact: true });
    const tools = page.getByRole("group", { name: "Document reading tools", exact: true });
    await expect(page.getByRole("heading", { name: "Reading context", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Vault sections", exact: true })).toHaveCount(0);
    await expect(trigger).toHaveText("Vault");
    await expect(trigger).toBeInViewport({ ratio: 1 });
    await expect(location).toContainText(title);
    await expect(location.getByRole("button", { name: title, exact: true })).toHaveCount(0);
    const triggerBox = (await trigger.boundingBox())!;
    const locationBox = (await location.boundingBox())!;
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(locationBox.x);
    expect(Math.abs(triggerBox.y + triggerBox.height / 2 - locationBox.y - locationBox.height / 2)).toBeLessThanOrEqual(1);
    await expect(tools.getByRole("button", { name: "Publish", exact: true })).toBeInViewport({ ratio: 1 });
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: "Vault pages", exact: true });
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Overview", exact: true })).toBeFocused();
    for (const [name, href] of destinations) await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveAttribute("href", href);
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Graph", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Settings", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await page.screenshot({ path: testInfo.outputPath("document-vault-menu.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    for (const [name, href] of destinations) {
      await trigger.click();
      await menu.getByRole("menuitem", { name, exact: true }).click();
      await expect(page).toHaveURL(url => url.pathname === href);
      if (name === "Overview") await expect(page.getByRole("navigation", { name: "Vault sections", exact: true })).toBeVisible();
      else await expect(page.getByRole("button", { name: `Vault pages, current: ${name}`, exact: true })).toBeVisible();
      await page.goBack();
      await expect(location).toContainText(title);
      await expect(trigger).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Vault sections", exact: true })).toHaveCount(0);
    }
    await tools.getByRole("button", { name: "Publish", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Publish document", exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByRole("button", { name: "Publish", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(tools.getByRole("button", { name: "Publish", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const treeVisible of ["0", "1"]) test(`document header navigation preserves Collections preference ${treeVisible}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page, false, treeVisible);
  await page.goto(documentUrl);
  const collections = page.locator('[data-slot="vault-collections-sidebar"]');
  if (treeVisible === "1") await expect(collections.getByRole("tree", { name: "fixture explorer", exact: true })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Expand collections", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vault pages for fixture", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(collections).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Vault pages for fixture", exact: true })).toBeVisible();
  if (treeVisible === "1") await expect(collections.getByRole("tree", { name: "fixture explorer", exact: true })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Expand collections", exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem("akb.treeVisible"), localStorage.getItem("akb.treeWidth.v2")])).toEqual([treeVisible, "286"]);
});

for (const width of [375, 1440]) test(`modified pointer header links preserve the dirty editor at ${width}px`, async ({ page, context }) => {
  await context.route("**/api/v1/**", route => route.fulfill({ json: {} }));
  await page.setViewportSize({ width, height: 900 });
  await fixture(page);
  await page.goto(`${documentUrl}?view=edit`);
  const editor = page.getByRole("textbox", { name: "Document body (markdown)", exact: true });
  await editor.fill("Keep this draft in the original tab.");
  await expect(page.getByRole("group", { name: "Document publishing", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Vault pages for fixture", exact: true }).click();
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/vault\/fixture\/settings$/);
  await popup.close();
  await expect(page).toHaveURL(/\?view=edit$/);
  await expect(page.getByRole("dialog", { name: "Leave this document?", exact: true })).toHaveCount(0);
  await expect(editor).toContainText("Keep this draft in the original tab.");
});

for (const width of [375, 1440]) test(`header navigation waits for an active image upload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page);
  const assetId = "123e4567-e89b-42d3-a456-426614174000";
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let finishUpload = () => {};
  const pending = new Promise<void>(resolve => { finishUpload = resolve; });
  await page.route("**/api/v1/assets/fixture?*", async route => {
    await pending;
    await route.fulfill({ json: { id: assetId, name: "diagram.png", mime_type: "image/png", size_bytes: bytes.length, target: `/api/assets/${assetId}`, unclaimed_expires_at: "2099-01-01T00:00:00Z" } });
  });
  await page.route(`**/api/assets/${assetId}?*`, route => route.fulfill({ contentType: "image/png", body: bytes }));
  try {
    await page.goto(`${documentUrl}?view=edit`);
    await expect(page.getByRole("textbox", { name: "Document body (markdown)", exact: true })).toBeVisible();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Insert image", exact: true }).click();
    await (await chooserPromise).setFiles({ name: "diagram.png", mimeType: "image/png", buffer: bytes });
    await expect(page.getByText("Uploading image…", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Vault pages for fixture", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Leave this document?", exact: true });
    await expect(confirmation).toContainText("An image is still uploading");
    await expect(confirmation.getByRole("button", { name: "Leave document", exact: true })).toBeDisabled();
    await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page).toHaveURL(/\?view=edit$/);
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    finishUpload();
    await expect(page.getByRole("button", { name: "Remove image: diagram", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Vault pages for fixture", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await confirmation.getByRole("button", { name: "Leave document", exact: true }).click();
    await expect(page.getByRole("button", { name: "Vault pages, current: Settings", exact: true })).toBeVisible();
  } finally {
    finishUpload();
  }
});
