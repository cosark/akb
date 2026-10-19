import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.AKB_FE_E2E_MODE === "mock", "Owns its isolated HTTP contract responses.");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const WEBP = Buffer.from("UklGRkIAAABXRUJQVlA4IDYAAAAQAwCdASogACAAPm00lkekIyIhKAgAgA2JZQB2AACKtrAA/vaVl/+SO89mIX//gN18Wy+AAAA=", "base64");

async function setup(page: Page, { sso = false, legacy = false, dark = false } = {}) {
  const fixture = { revision: null as string | null, photo: false, writes: 0, failNext: false, conflictNext: false };
  await page.addInitScript(({ dark, sso }) => {
    localStorage.setItem("akb_theme", dark ? "dark" : "light");
    if (!sso) localStorage.setItem("akb_token", "owned-photo-browser-fixture");
    else document.cookie = "akb_dev_sso_csrf=owned-photo-csrf; Path=/; SameSite=Lax";
  }, { dark, sso });
  const avatar = () => ({ revision: fixture.revision, url: fixture.photo ? `/api/v1/auth/me/avatar?v=${fixture.revision}` : null, ...(fixture.photo ? { width: 512, height: 512 } : {}) });
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (url.pathname.endsWith("/auth/config")) return route.fulfill({ json: {
      schema_version: 2, auth_mode: sso ? "sso" : "local", local_auth: { enabled: !sso },
      keycloak: { enabled: sso, browser_session_ready: sso }, providers: [], mcp_oauth: { enabled: false },
    } });
    if (url.pathname.endsWith("/auth/me")) return route.fulfill({ json: {
      user_id: "b07b44b6-8569-4938-9bd0-d9d49a76971c", username: "photo-reviewer", email: "photo@example.invalid",
      display_name: "Photo reviewer", is_admin: false, auth_method: sso ? "browser_session" : "jwt", key_class: null,
      ...(!legacy ? { avatar: avatar(), profile_capabilities: { avatar: {
        supported: true, can_upload: true, can_remove: true, reason: null,
        max_upload_bytes: 10485760, allowed_content_types: ["image/jpeg", "image/png", "image/webp"],
      } } } : {}),
    } });
    if (url.pathname.endsWith("/auth/me/avatar")) {
      if (sso) {
        expect(request.headers().authorization).toBeUndefined();
        if (method !== "GET") expect(request.headers()["x-akb-csrf"]).toBe("owned-photo-csrf");
      } else expect(request.headers().authorization).toBe("Bearer owned-photo-browser-fixture");
      if (method === "GET") {
        if (!fixture.photo || url.searchParams.get("v") !== fixture.revision) return route.fulfill({ status: 404, json: { detail: { code: "avatar_not_found", message: "Photo unavailable" } } });
        return route.fulfill({ contentType: "image/webp", body: WEBP, headers: { "Cache-Control": "private, no-store" } });
      }
      if (fixture.conflictNext) {
        fixture.conflictNext = false;
        fixture.revision = "00000000-0000-4000-8000-000000000099"; fixture.photo = true;
        return route.fulfill({ status: 409, json: { detail: { code: "avatar_changed", message: "Your profile photo changed. Reload it before saving again." } } });
      }
      expect(url.searchParams.get("expected_revision")).toBe(fixture.revision ?? "none");
      if (fixture.failNext) {
        fixture.failNext = false;
        return route.fulfill({ status: 503, json: { detail: { code: "avatar_storage_unavailable", message: "Photo storage is temporarily unavailable. Try again." } } });
      }
      if (method === "PUT") { expect(request.headers()["content-type"]).toBe("image/png"); expect(request.postDataBuffer()?.length).toBe(PNG.length); }
      fixture.revision = `00000000-0000-4000-8000-${String(++fixture.writes).padStart(12, "0")}`;
      fixture.photo = method === "PUT";
      return route.fulfill({ json: { avatar: avatar() } });
    }
    if (url.pathname.endsWith("/my/vaults")) return route.fulfill({ json: { vaults: [] } });
    return route.fulfill({ json: { items: [], users: [], vaults: [], tokens: [], unread_count: 0 } });
  });
  return fixture;
}

async function choose(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /^(Upload photo|Change photo|Choose another)$/ }).click();
  const picker = await chooser;
  // Reproduce native picker focus churn without turning it into a close gesture.
  await page.evaluate(() => document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  await expect(dialog).toBeVisible();
  await picker.setFiles({ name: "portrait.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("img", { name: "Selected profile photo preview" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save photo" })).toBeEnabled();
}

for (const width of [375, 1440]) for (const dark of [false, true]) test(`profile photo lifecycle fits ${width}px ${dark ? "dark" : "light"}`, async ({ page }, info) => {
  const fixture = await setup(page, { dark }); await page.setViewportSize({ width, height: 900 });
  await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await choose(page);
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog.getByText("Photo saved", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-slot="user-avatar"] img')).toHaveCount(1);
  expect(fixture.writes).toBe(1);
  await page.screenshot({ path: info.outputPath("profile-photo-saved.png") });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.locator('#account-menu-trigger [data-slot="user-avatar"] img')).toHaveCount(1);
  await page.reload();
  await page.locator("#account-menu-trigger").click();
  await expect(page.getByRole("menu").locator('[data-slot="user-avatar"] img')).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Change photo" })).toBeVisible();
  await choose(page); await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect.poll(() => fixture.writes).toBe(2);
  await expect(dialog.getByRole("button", { name: "Remove photo", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Remove photo", exact: true }).click();
  await dialog.getByRole("group", { name: "Remove profile photo?" }).getByRole("button", { name: "Remove photo", exact: true }).click();
  await expect(dialog.getByText("Photo removed", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-slot="user-avatar"] img')).toHaveCount(0);
  expect(fixture.revision).not.toBeNull();
  // A replacement after removal must use its retained revision, not first-write none.
  await choose(page); await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect.poll(() => fixture.writes).toBe(4);
});

test("SSO can edit photos while identity fields stay managed", async ({ page }) => {
  await setup(page, { sso: true }); await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByLabel("Display name")).toBeDisabled();
  await expect(dialog.getByLabel("Email address")).toBeDisabled();
  await choose(page); await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog.getByText("Photo saved", { exact: true })).toBeVisible();
});

test("photo failures preserve drafts, and conflicts require explicit reload", async ({ page }) => {
  const fixture = await setup(page); await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByLabel("Display name").fill("Unrelated name draft");
  await choose(page); fixture.failNext = true; await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(dialog.getByRole("img", { name: "Selected profile photo preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Dismiss photo error" }).click();
  fixture.conflictNext = true; await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog.getByRole("button", { name: "Save photo" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Reload photo" }).click();
  await expect(dialog.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Unrelated name draft");
  await choose(page); await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog.getByText("Photo saved", { exact: true })).toBeVisible();
});

test("legacy photo support is explicit and does not disable profile edits", async ({ page }) => {
  await setup(page, { legacy: true }); await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByText("Profile photos are not supported by this server yet.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Upload photo" })).toHaveCount(0);
  await expect(dialog.getByLabel("Display name")).toBeEnabled();
});
