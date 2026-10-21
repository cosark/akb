import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { VaultDirectory } from "@/components/vault-directory";
import { CurrentUserProvider } from "@/contexts/current-user-context";
import type { VaultSummary } from "@/hooks/use-vaults";

const KEY = "akb-vault-favorites:v2:directory-focus-test";
const vaults = [
  { id: "v-alpha", name: "alpha", role: "owner" },
  { id: "v-beta", name: "beta", role: "reader" },
  { id: "v-gamma", name: "gamma", role: "writer" },
];

function renderDirectory(favorites: string[], rows: VaultSummary[] = vaults) {
  localStorage.setItem(KEY, JSON.stringify(favorites));
  return render(<MemoryRouter><CurrentUserProvider user={{
    user_id: "directory-focus-test", username: "fixture", email: "fixture@example.test",
    display_name: null, is_admin: false, auth_method: "local", key_class: null,
  }}><VaultDirectory vaults={rows} /></CurrentUserProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
});
afterEach(cleanup);

describe("VaultDirectory favorite removal focus", () => {
  it.each(["{Enter}", " "])("focuses the next favorite after keyboard removal with %s", async key => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-gamma", "v-beta"]);
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    screen.getByRole("button", { name: "Remove alpha from favorites" }).focus();

    await user.keyboard(key);

    expect(screen.queryByRole("link", { name: "alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove gamma from favorites" })).toHaveFocus();
  });

  it("focuses the preceding favorite after removing the final row", async () => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-beta"]);
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    screen.getByRole("button", { name: "Remove beta from favorites" }).focus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Remove alpha from favorites" })).toHaveFocus();
  });

  it("focuses the stable Favorites filter when the last matching favorite disappears", async () => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-beta"]);
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    await user.type(screen.getByRole("textbox", { name: "Find a vault" }), "alpha");
    screen.getByRole("button", { name: "Remove alpha from favorites" }).focus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Favorites" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("No vaults match these filters");
  });

  it("focuses the newly revealed favorite at the progressive display boundary", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 31 }, (_, index) => ({ id: `v-${index}`, name: `vault-${index}` }));
    renderDirectory(rows.map(row => row.id), rows);
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.queryByRole("button", { name: "Remove vault-30 from favorites" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Remove vault-29 from favorites" }).focus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Remove vault-30 from favorites" })).toHaveFocus();
  });

  it("does not move focus to another control after a mouse removal", async () => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-beta"]);
    await user.click(screen.getByRole("button", { name: "Favorites" }));

    await user.click(screen.getByRole("button", { name: "Remove alpha from favorites" }));

    expect(screen.queryByRole("link", { name: "alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove beta from favorites" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Favorites" })).not.toHaveFocus();
  });

  it("preserves input focus when favorites change in another tab", async () => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-beta"]);
    await user.click(screen.getByRole("button", { name: "Favorites" }));
    const input = screen.getByRole("textbox", { name: "Find a vault" });
    await user.click(input);

    act(() => {
      localStorage.setItem(KEY, JSON.stringify(["v-beta"]));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(screen.queryByRole("link", { name: "alpha" })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("retains the same control when keyboard removal keeps its row in All", async () => {
    const user = userEvent.setup();
    renderDirectory(["v-alpha", "v-beta"]);
    screen.getByRole("button", { name: "Remove alpha from favorites" }).focus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Add alpha to favorites" })).toHaveFocus();
  });
});
