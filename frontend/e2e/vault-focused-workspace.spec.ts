import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.AKB_FE_E2E_MODE === "mock", "Uses isolated HTTP fixtures, never a user's data.");
test.use({ reducedMotion: "reduce", launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

async function fixture(page: Page, dark = false, treeVisible = "1") {
  await page.addInitScript(({ dark, treeVisible }) => {
    localStorage.setItem("akb_token", "focused-vault-fixture");
    localStorage.setItem("akb_theme", dark ? "dark" : "light");
    if (!localStorage.getItem("focused-fixture-ready")) {
      localStorage.setItem("akb.treeVisible", treeVisible);
      localStorage.setItem("akb.treeWidth.v2", "286");
      localStorage.setItem("akb.vaultRailWidth.v2", "218");
      localStorage.setItem("akb.vaultRailCollapsed", "0");
      localStorage.setItem("focused-fixture-ready", "1");
    }
  }, { dark, treeVisible });
  await page.route("**/health**", route => route.fulfill({ json: {} }));
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json: object = { items: [], history: [], changes: [], relations: [], templates: [], unread_count: 0 };
    if (path.endsWith("/auth/config")) json = { schema_version: 2, auth_mode: "local", local_auth: { enabled: true }, keycloak: { enabled: false, browser_session_ready: false }, providers: [], mcp_oauth: { enabled: false } };
    else if (path.endsWith("/auth/me")) json = { user_id: "focus-owner", username: "owner", display_name: "Review owner", email: "owner@example.invalid", auth_method: "local", is_admin: false };
    else if (path.endsWith("/vaults")) json = { vaults: [{ id: "focus-vault", name: "fixture", role: "owner" }] };
    else if (path.endsWith("/info")) json = { name: "fixture", role: "owner", public_access: "none", description: "A place for operating knowledge.", owner_display_name: "Review owner", created_at: "2026-09-01T09:00:00Z", member_count: 1, document_count: 2, collection_count: 1, table_count: 0, file_count: 0 };
    else if (path.endsWith("/members")) json = { members: [{ user_id: "focus-owner", username: "owner", display_name: "Review owner", email: "owner@example.invalid", role: "owner", since: "2026-09-01T09:00:00Z" }] };
    else if (path.includes("/browse/")) json = { items: [{ type: "collection", path: "guides", name: "guides", doc_count: 2 }] };
    else if (path.includes("/publications/")) json = { publications: [] };
    else if (path.endsWith("/graph/overview")) json = { nodes: [
      { uri: "akb://fixture/coll/guides/doc/start.md", name: "Getting started", resource_type: "document", degree: 1 },
      { uri: "akb://fixture/coll/guides/doc/runbook.md", name: "Operations", resource_type: "document", degree: 1 },
    ], edges: [{ source: "akb://fixture/coll/guides/doc/start.md", target: "akb://fixture/coll/guides/doc/runbook.md", relation: "references", kind: "explicit" }], nodes_total: 2, returned: 2, edges_total: 1, truncated: false, orphans_returned: 0, orphans_truncated: false };
    else if (path.includes("/documents/fixture/")) json = { id: "guide", path: "overview/vault-skill.md", title: "Vault guide", content: "# Working together\n\nKeep decisions with their context.", current_commit: "guide-head", metadata: {}, status: "active" };
    return route.fulfill({ json });
  });
}

const routes = { settings: "Settings", members: "Members", publications: "Public links", graph: "Graph" } as const;
for (const width of [375, 1920]) for (const dark of [false, true]) for (const [route, label] of Object.entries(routes)) {
  test(`${label} focuses on its task at ${width}px ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page, dark);
    await page.goto(`/vault/fixture/${route}`);
    const switcher = page.getByRole("button", { name: "Vault menu for fixture", exact: true });
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveText("Vault menu");
    const trail = page.getByRole("navigation", { name: "Current page", exact: true });
    await expect(trail.locator('[aria-current="page"]')).toHaveText(label);
    await expect(trail.getByRole("button")).toHaveCount(0);
    await expect(trail.getByRole("link", { name: "fixture", exact: true })).toHaveAttribute("href", "/vault/fixture");
    const triggerBox = (await switcher.boundingBox())!;
    const trailBox = (await trail.boundingBox())!;
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(trailBox.x);
    await expect(page.locator('[data-workspace-mode="focused"]')).toBeVisible();
    await expect(page.locator('[data-slot="vault-collections-sidebar"]')).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Collections (collapsed)" })).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "Resize tree panel" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Vault sections" })).toHaveCount(0);
    if (route === "settings") {
      await expect(page.getByRole("tablist", { name: "Vault settings sections" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Vault details" })).toHaveCount(0);
    } else if (route === "members") await expect(page.getByRole("table", { name: "Vault members" })).toBeVisible();
    else if (route === "publications") await expect(page.getByText("No public links yet", { exact: true })).toBeVisible();
    else await expect(page.getByRole("region", { name: "Graph exploration workspace" })).toBeVisible();
    if (width < 1024) {
      await page.getByRole("button", { name: "Open vault navigation", exact: true }).click();
      await expect(page.getByRole("navigation", { name: "Vaults", exact: true })).toBeVisible();
      await expect(page.locator('[data-slot="vault-collections-sidebar"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
    } else {
      const navigation = (await page.locator("#vault-workspace-navigation").boundingBox())!;
      expect(navigation.width).toBeLessThan(225);
      const header = (await page.locator(".app-header").boundingBox())!;
      expect(header.x).toBeCloseTo(navigation.x + navigation.width, 0);
    }
    await switcher.click();
    const menu = page.getByRole("menu", { name: "Vault pages", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(switcher).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("akb.treeVisible"))).toBe("1");
    await page.screenshot({ path: testInfo.outputPath(`${route}.png`), animations: "disabled" });
  });
}

for (const treeVisible of ["0", "1"]) test(`page switching and history preserve tree preference ${treeVisible}`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await fixture(page, false, treeVisible);
  await page.goto("/vault/fixture/settings");
  const switcher = page.getByRole("button", { name: "Vault menu for fixture", exact: true });
  const trail = page.getByRole("navigation", { name: "Current page", exact: true });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Members", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Members");
  await expect(switcher).toBeFocused();
  await switcher.click();
  await page.getByRole("menuitem", { name: "Overview", exact: true }).click();
  await expect(switcher).toBeFocused();
  const collections = page.locator('[data-slot="vault-collections-sidebar"]');
  await expect(page.getByRole("navigation", { name: "Vault sections" })).toHaveCount(0);
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Overview");
  if (treeVisible === "1") await expect(collections).toBeVisible();
  else await expect(page.getByRole("button", { name: "Expand collections" })).toBeVisible();
  await page.goBack();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Members");
  await expect(collections).toHaveCount(0);
  await page.goBack();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Settings");
  await page.goForward();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Members");
  await page.reload();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Members");
  expect(await page.evaluate(() => localStorage.getItem("akb.treeVisible"))).toBe(treeVisible);
  expect(await page.evaluate(() => localStorage.getItem("akb.treeWidth.v2"))).toBe("286");
});
