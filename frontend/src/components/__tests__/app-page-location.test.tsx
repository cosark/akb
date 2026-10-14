import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppPageLocation } from "../app-page-location";

describe("App page location", () => {
  it.each([
    ["/", "Home"], ["/search?q=test", "Search"],
    ["/settings?tab=tokens", "Agent connections"], ["/vault", "Vaults"],
    ["/settings", "Profile"], ["/settings?tab=preferences", "Appearance"],
    ["/settings?tab=notifications", "Watched documents"],
    ["/settings?tab=admin", "Profile"], ["/settings?tab=unknown", "Profile"],
    ["/vault/new", "New vault"], ["/notifications", "Notifications"],
    ["/unknown", "Page not found"],
  ])("identifies %s without an unnecessary hierarchy", (path, label) => {
    render(<MemoryRouter initialEntries={[path]}><AppPageLocation /></MemoryRouter>);
    const location = screen.getByRole("navigation", { name: "Current page" });
    expect(within(location).getByText(label)).toHaveAttribute("aria-current", "page");
    expect(location.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(location).queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    ["", "Overview"], ["/members", "Members"], ["/settings", "Settings"],
    ["/publications", "Public links"], ["/graph", "Graph"], ["/search", "Search"],
    ["/activity", "Activity"], ["/doc/new", "New document"],
    ["/doc/d-12345678", "Document"], ["/table/data", "Table"], ["/file/uuid", "File"],
  ])("keeps named Vault section %s in the top location trail", (tail, label) => {
    render(<MemoryRouter initialEntries={[`/vault/%ED%8C%80%20Vault${tail}`]}><AppPageLocation /></MemoryRouter>);
    const location = screen.getByRole("navigation", { name: "Current page" });
    const vault = within(location).getByRole("link", { name: "팀 Vault" });
    expect(vault).toHaveAttribute("href", "/vault/%ED%8C%80%20Vault");
    expect(vault.querySelector(".lucide-box")).toHaveAttribute("aria-hidden", "true");
    const current = within(location).getByText(label);
    expect(current).toHaveAttribute("aria-current", "page");
    const resourceGlyph = ({ Document: ".lucide-file-text", File: ".lucide-file", Table: ".lucide-table-2" } as Record<string, string>)[label];
    const focused = ["Members", "Settings", "Public links", "Graph"].includes(label);
    expect(location.querySelectorAll("svg")).toHaveLength(resourceGlyph || focused ? 2 : 1);
    if (focused) expect(within(location).getByRole("button", { name: `Vault pages, current: ${label}` })).toBeInTheDocument();
    if (label === "Document") {
      expect(screen.getByRole("button", { name: "Vault pages for 팀 Vault" })).toHaveTextContent("Vault");
      expect(within(location).queryByRole("button", { name: "Vault pages for 팀 Vault" })).not.toBeInTheDocument();
      expect(current.closest("button")).toBeNull();
    }
    if (resourceGlyph) {
      expect(current.compareDocumentPosition(location.querySelector(resourceGlyph)!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(location.querySelector("ol")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
  });

  it("offers real scoped links in a nonmodal page menu and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/vault/engineering/settings"]}><AppPageLocation /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "Vault pages, current: Settings" });
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Vault pages" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("menuitem", { name: "Public links" })).toHaveAttribute("href", "/vault/engineering/publications");
    expect(within(menu).getByRole("menuitem", { name: "Overview" })).toHaveAttribute("href", "/vault/engineering");
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Members" }));
    expect(await screen.findByRole("button", { name: "Vault pages, current: Members" })).toHaveFocus();
  });

  it("gives documents an independent Vault menu without selecting Overview or turning the title into a menu", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/vault/%ED%8C%80%20Vault/doc/notes%2Fhello.md"]}><AppPageLocation /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "Vault pages for 팀 Vault" });
    const trail = screen.getByRole("navigation", { name: "Current page" });
    expect(trail).not.toContainElement(trigger);
    expect(within(trail).getByRole("link", { name: "팀 Vault" })).toHaveAttribute("href", "/vault/%ED%8C%80%20Vault");
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Vault pages" });
    expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Overview", "Graph", "Public links", "Members", "Settings",
    ]);
    expect(menu.querySelector('[aria-current="page"]')).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/vault/%ED%8C%80%20Vault/settings");
    expect(document.body.style.overflow).not.toBe("hidden");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Vault pages, current: Settings" })).toHaveFocus();
  });
});
