import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResourceNavigationProvider, useResourceNavigationGuard } from "@/contexts/resource-navigation-context";
import { VaultPageSwitcher } from "../vault-page-switcher";

function renderMenu(route: string, vault = "team") {
  return render(<MemoryRouter initialEntries={[route]}><VaultPageSwitcher vault={vault} /></MemoryRouter>);
}

describe("Vault page menu", () => {
  it.each([
    ["", "Overview"], ["/", "Overview"], ["/graph", "Graph"],
    ["/publications", "Public links"], ["/members", "Members"], ["/settings/", "Settings"],
  ])("keeps a stable trigger and marks only the actual destination on %s", async (suffix, label) => {
    const user = userEvent.setup();
    renderMenu(`/vault/team${suffix}?filter=anything`);
    const trigger = screen.getByRole("button", { name: "Navigate in team" });
    expect(trigger).toHaveTextContent("Navigate");
    expect(trigger.querySelector("[aria-current]")).toBeNull();
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Vault pages" });
    expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Overview", "Graph", "Public links", "Members", "Settings",
    ]);
    expect(within(menu).getByRole("menuitem", { name: label })).toHaveAttribute("aria-current", "page");
    expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(menu).queryByRole("menuitem", { name: "Search" })).not.toBeInTheDocument();
    for (const link of within(menu).getAllByRole("menuitem")) expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it.each(["activity", "search", "file/settings", "table/members", "doc/graph", "doc/new", "skill"])(
    "never implies Overview or another section is current on %s", async suffix => {
      const user = userEvent.setup();
      renderMenu(`/vault/team/${suffix}`);
      await user.click(screen.getByRole("button", { name: "Navigate in team" }));
      expect(screen.getByRole("menu", { name: "Vault pages" }).querySelector("[aria-current]")).toBeNull();
    },
  );

  it.each(["/vault", "/search", "/vault/other/members", "/vault/team/unknown", "/vault/new"])(
    "does not render a stale or unselected Vault menu on %s", route => {
      renderMenu(route);
      expect(screen.queryByRole("button", { name: /Navigate/ })).not.toBeInTheDocument();
    },
  );

  it("encodes real destination links and supports ordered keyboard selection", async () => {
    const user = userEvent.setup();
    renderMenu("/vault/%ED%8C%80%20Vault", "팀 Vault");
    await user.tab();
    const trigger = screen.getByRole("button", { name: "Navigate in 팀 Vault" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    const overview = screen.getByRole("menuitem", { name: "Overview" });
    expect(overview).toHaveFocus();
    expect(overview).toHaveAttribute("href", "/vault/%ED%8C%80%20Vault");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Graph" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/vault/%ED%8C%80%20Vault/settings");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it.each(["/vault/team/doc/note", "/vault/team/settings"])("consults the same leave guard from %s", async route => {
    const user = userEvent.setup();
    const guard = vi.fn(() => false);
    function GuardedMenu() {
      useResourceNavigationGuard(guard);
      return <VaultPageSwitcher vault="team" />;
    }
    render(<MemoryRouter initialEntries={[route]}><ResourceNavigationProvider><GuardedMenu /></ResourceNavigationProvider></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Navigate in team" }));
    await user.click(screen.getByRole("menuitem", { name: "Members" }));
    expect(guard).toHaveBeenCalledExactlyOnceWith("/vault/team/members");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
