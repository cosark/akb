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

  for (const status of [401, 403, 404]) {
    test("preserves a composed result through head " + status + ", transient failure and verified recovery", async ({ page, request }) => {
      const fixture = await setup(page, request);
      await fixture.source.fill("Base line\nMy addition\n");
      const changed = await request.patch(fixture.path, { headers: fixture.headers, data: {
        content: "Base line\nRemote addition\n", expected_commit: fixture.document.current_commit,
      } });
      expect(changed.ok()).toBeTruthy();
      const remote = await changed.json();
      await page.getByRole("button", { name: "Check for changes" }).click();
      await page.getByRole("button", { name: "Compare changes" }).click();
      const combined = page.getByRole("textbox", { name: "Combined document body" });
      await expect(combined).toHaveValue("Base line\nRemote addition");
      await combined.fill("Base line\nRemote addition\nMy manually composed result\n");
      await expect(combined).toHaveValue("Base line\nRemote addition\nMy manually composed result\n");
      let failure: number | null = status;
      // Inject only Head failures; login, comparison GET and final PATCH use the real API.
      await page.route("**/api/v1/document-head/**", async route => {
        if (failure === null) await route.continue();
        else await route.fulfill({ status: failure, json: { detail: { code: "injected_head_failure", message: "Head unavailable" } } });
      });
      const writes: Record<string, unknown>[] = [];
      page.on("request", req => { if (req.method() === "PATCH" && req.url().includes("/api/v1/documents/")) writes.push(req.postDataJSON()); });
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByText(/Your combined result is preserved/)).toBeVisible();
      await expect(combined).toHaveValue(/My manually composed result/);
      await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save changes", includeHidden: true })).toBeDisabled();
      await expect(page).toHaveURL(/\/vault\//);
      failure = 503;
      await page.getByRole("button", { name: "Check access" }).click();
      await expect(page.getByRole("button", { name: "Check access" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save changes", includeHidden: true })).toBeDisabled();
      expect(writes).toHaveLength(0);
      failure = null;
      await page.getByRole("button", { name: "Check access" }).click();
      await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeEnabled();
      await expect(combined).toHaveValue(/My manually composed result/);
      await page.getByRole("button", { name: "Apply combined changes" }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(writes[0].expected_commit).toBe(remote.current_commit);
      const final = await request.get(fixture.path, { headers: fixture.headers });
      const saved = await final.json();
      expect(saved.content).toContain("Remote addition");
      expect(saved.content).toContain("My manually composed result");
    });
  }

  test("locks combined fields during a delayed, explicitly confirmed comparison reload", async ({ page, request }) => {
    const fixture = await setup(page, request);
    await fixture.source.fill("Base line\nMy addition\n");
    await page.getByRole("textbox", { name: "Document title" }).fill("My title");
    const changed = await request.patch(fixture.path, { headers: fixture.headers, data: {
      content: "Base line\nRemote addition\n", title: "Remote title", expected_commit: fixture.document.current_commit,
    } });
    expect(changed.ok()).toBeTruthy();
    const remote = await changed.json();
    await page.getByRole("button", { name: "Check for changes" }).click();
    await page.getByRole("button", { name: "Compare changes" }).click();
    const combined = page.getByRole("textbox", { name: "Combined document body" });
    await expect(combined).toHaveValue("Base line\nRemote addition");
    await combined.fill("Combined before reload");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    // Delay only the real comparison read, not its response data or the save.
    await page.route("**/api/v1/documents/**", async route => {
      if (route.request().method() === "GET") await pending;
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: "Reload comparison", exact: true }).click();
      await page.getByRole("dialog", { name: "Reload this comparison?" }).getByRole("button", { name: "Reload comparison", exact: true }).click();
      await expect(combined).toBeDisabled();
      await expect(combined).toHaveValue("Combined before reload");
      await expect(page.getByRole("textbox", { name: "Combined title" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Use my title" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Keep latest body" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    } finally {
      release();
    }
    await expect(combined).toBeEnabled();
    await expect(combined).toHaveValue("Base line\nRemote addition");
    await expect(page.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    await combined.fill("Base line\nRemote addition\nMy addition after reload\n");
    await page.getByRole("button", { name: "Use my title" }).click();
    await page.getByRole("button", { name: "Apply combined changes" }).click();
    const savedResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/api/v1/documents/"));
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await savedResponse).request().postDataJSON().expected_commit).toBe(remote.current_commit);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    const final = await request.get(fixture.path, { headers: fixture.headers });
    const saved = await final.json();
    expect(saved.title).toBe("My title");
    expect(saved.content).toContain("My addition after reload");
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
