import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.describe("document concurrency against the real API", () => {
  test.skip(process.env.AKB_FE_E2E_MODE !== "real", "Requires an isolated real API, not MSW.");

  async function setup(page: Page, request: APIRequestContext) {
    const name = "concurrency-" + randomUUID().slice(0, 12);
    const password = randomUUID() + "Aa!";
    const registered = await request.post("/api/v1/auth/register", { data: { username: name, email: name + "@example.test", password } });
    expect(registered.ok()).toBeTruthy();
    const login = await request.post("/api/v1/auth/login", { data: { username: name, password } });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: "Bearer " + token };
    const vault = await request.post("/api/v1/vaults?name=" + name, { headers });
    expect(vault.ok()).toBeTruthy();
    const created = await request.post("/api/v1/documents", { headers, data: {
      vault: name, collection: "notes", title: "Concurrency note", slug: "shared", content: "Base line\n",
    } });
    expect(created.ok()).toBeTruthy();
    const document = await created.json();
    const path = "/api/v1/documents/" + name + "/" + encodeURIComponent(document.path);
    await page.addInitScript((value: string) => localStorage.setItem("akb_token", value), token);
    await page.goto("/vault/" + name + "/doc/" + encodeURIComponent(document.path) + "?view=edit");
    await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Concurrency note");
    await page.getByRole("button", { name: /^Editor mode:/ }).click();
    await page.getByRole("menuitemradio", { name: "Markdown", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Document body (markdown)" });
    await expect(source).toBeVisible();
    return { headers, name, document, path, source };
  }

  test("polls only the head, preserves the draft and saves a reviewed combined result", async ({ page, request }) => {
    const fixture = await setup(page, request);
    await fixture.source.fill("Base line\nMy addition\n");
    const writes: Record<string, unknown>[] = [];
    page.on("request", (req) => { if (req.method() === "PATCH" && req.url().includes("/api/v1/documents/")) writes.push(req.postDataJSON()); });
    const changed = await request.patch(fixture.path, { headers: fixture.headers, data: {
      content: "Base line\nRemote addition\n", title: "Remote title", expected_commit: fixture.document.current_commit,
    } });
    expect(changed.ok()).toBeTruthy();
    const remote = await changed.json();
    await expect(page.getByText(/A newer version is available/)).toBeVisible({ timeout: 22_000 });
    await expect(fixture.source).toHaveValue("Base line\nMy addition\n");
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Compare changes" }).click();
    const combined = page.getByRole("textbox", { name: "Combined document body" });
    await expect(combined).toHaveValue("Base line\nRemote addition");
    await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    const originalViewport = page.viewportSize();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /dark/ : /^(?!.*\bdark\b)/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      await expect.poll(() => page.getByRole("button", { name: "Keep editing" }).evaluate((button) => {
        const dialog = button.closest('[role="dialog"]')!;
        return getComputedStyle(button).backgroundColor === getComputedStyle(dialog).backgroundColor
          && getComputedStyle(button).color === getComputedStyle(dialog).color;
      })).toBe(true);
      await page.screenshot({ path: test.info().outputPath("comparison-" + colorScheme + "-narrow.png"), animations: "disabled" });
    }
    await page.emulateMedia({ colorScheme: "light" });
    if (originalViewport) await page.setViewportSize(originalViewport);
    await combined.fill("Base line\nRemote addition\nMy addition\n");
    await page.getByRole("button", { name: "Apply combined changes" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].expected_commit).toBe(remote.current_commit);
    const final = await request.get(fixture.path, { headers: fixture.headers });
    const saved = await final.json();
    expect(saved.title).toBe("Remote title");
    expect(saved.content).toContain("Remote addition");
    expect(saved.content).toContain("My addition");
    const head = await request.get("/api/v1/document-head/" + fixture.name + "/" + encodeURIComponent(fixture.document.path), { headers: fixture.headers });
    expect(head.headers()["cache-control"]).toBe("no-store");
    expect((await head.json()).current_commit).toBe(saved.current_commit);
    expect((await head.json()).content).toBeUndefined();
  });

  test("cancels comparison without replacing the draft and detects a second change before saving", async ({ page, request }) => {
    const fixture = await setup(page, request);
    await fixture.source.fill("Base line\nMy addition\n");
    const first = await request.patch(fixture.path, { headers: fixture.headers, data: {
      content: "Base line\nFirst remote\n", expected_commit: fixture.document.current_commit,
    } });
    const revision = await first.json();
    await page.getByRole("button", { name: "Check for changes" }).click();
    await expect(page.getByRole("button", { name: "Compare changes" })).toBeVisible();
    await page.getByRole("button", { name: "Compare changes" }).click();
    await expect(page.getByRole("textbox", { name: "Combined document body" })).toHaveValue("Base line\nFirst remote");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(fixture.source).toHaveValue("Base line\nMy addition\n");
    await page.getByRole("button", { name: "Compare changes" }).click();
    await page.getByRole("textbox", { name: "Combined document body" }).fill("Base line\nFirst remote\nMy addition\n");
    const second = await request.patch(fixture.path, { headers: fixture.headers, data: {
      content: "Base line\nFirst remote\nSecond remote\n", expected_commit: revision.current_commit,
    } });
    expect(second.ok()).toBeTruthy();
    await page.getByRole("button", { name: "Apply combined changes" }).click();
    // Whether polling has observed R2 or not, Save must not overwrite it.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog", { name: "Review document changes" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Combined document body" })).toHaveValue("Base line\nFirst remote\nSecond remote");
    const final = await request.get(fixture.path, { headers: fixture.headers });
    expect((await final.json()).content).toContain("Second remote");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await page.getByRole("button", { name: "Editor mode: Visual" }).click();
    await page.getByRole("menuitemradio", { name: "Markdown", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Document body (markdown)" })).toHaveValue(/My addition/);
  });
});
