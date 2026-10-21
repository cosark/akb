import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResourceNavigationProvider, useResourceNavigationGuard } from "@/contexts/resource-navigation-context";
import { VaultOverviewNavigation, VaultOverviewNavigationFocus } from "../vault-overview-navigation";

function renderNavigation(guard?: () => boolean) {
  function Workspace() {
    useResourceNavigationGuard(guard ?? null);
    return <><VaultOverviewNavigationFocus /><main id="main" tabIndex={-1}><Routes>
      <Route path="/vault/team" element={<VaultOverviewNavigation vault="team" />} />
      <Route path="/vault/team/:page" element={<h1>Destination</h1>} />
    </Routes></main></>;
  }
  return render(<MemoryRouter initialEntries={["/vault/team"]}><ResourceNavigationProvider><Workspace /></ResourceNavigationProvider></MemoryRouter>);
}

describe("Overview page navigation", () => {
  it("offers four direct destinations without a redundant Overview or Search link", () => {
    renderNavigation();
    const nav = screen.getByRole("navigation", { name: "Vault pages" });
    const links = within(nav).getAllByRole("link");
    expect(links.map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Graph", "/vault/team/graph"], ["Public links", "/vault/team/publications"],
      ["Members", "/vault/team/members"], ["Settings", "/vault/team/settings"],
    ]);
    expect(within(nav).queryByRole("button")).not.toBeInTheDocument();
    expect(nav.querySelector("[aria-current]")).toBeNull();
    for (const link of links) expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("encodes the Vault boundary in every native link", () => {
    render(<MemoryRouter><VaultOverviewNavigation vault="팀 /#? Vault" /></MemoryRouter>);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toMatch(/^\/vault\/%ED%8C%80%20%2F%23%3F%20Vault\//);
  });

  it("uses normal Tab order and focuses the destination when an accepted link unmounts", async () => {
    const user = userEvent.setup();
    renderNavigation();
    for (const name of ["Graph", "Public links", "Members", "Settings"]) {
      await user.tab();
      expect(screen.getByRole("link", { name })).toHaveFocus();
    }
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Destination" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Vault pages" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });

  it("retains the source and focus when a workspace blocks departure", async () => {
    const user = userEvent.setup();
    const guard = vi.fn(() => false);
    renderNavigation(guard);
    const members = screen.getByRole("link", { name: "Members" });
    members.focus();
    await user.keyboard("{Enter}");
    expect(guard).toHaveBeenCalledExactlyOnceWith("/vault/team/members");
    expect(screen.queryByRole("heading", { name: "Destination" })).not.toBeInTheDocument();
    expect(members).toHaveFocus();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])("leaves modified/native clicks alone: %j", modifiers => {
    const guard = vi.fn(() => false);
    renderNavigation(guard);
    fireEvent.click(screen.getByRole("link", { name: "Members" }), modifiers);
    expect(guard).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Vault pages" })).toBeVisible();
  });
});
