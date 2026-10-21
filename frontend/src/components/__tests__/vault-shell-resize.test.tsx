import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { VaultShell, type VaultNavigationControl } from "@/components/vault-shell";

vi.mock("@/components/vault-explorer", () => ({
  VaultExplorer: ({ onCollapse }: { onCollapse: () => void }) => <aside aria-label="Collections">
    <button onClick={onCollapse}>Collapse collections</button>Collection tree
  </aside>,
}));
vi.mock("@/components/vault-rail", () => ({
  VaultRail: ({ width, collapsed, onToggleCollapsed }: { width: number; collapsed: boolean; onToggleCollapsed: () => void }) => (
    <nav aria-label="Vaults" style={{ width: collapsed ? 56 : width }}>
      <button onClick={onToggleCollapsed}>{collapsed ? "Expand vaults" : "Collapse vaults"}</button>
    </nav>
  ),
}));
vi.mock("@/components/title-bar", () => ({ TitleBar: ({ left }: { left: React.ReactNode }) => <header>{left}</header> }));
vi.mock("@/components/app-page-location", () => ({ AppPageLocation: () => null }));
vi.mock("@/components/vault-create-dialog", () => ({ VaultCreateDialog: () => null }));
vi.mock("@/components/document-create-dialog", () => ({ DocumentCreateDialog: () => null }));

let workspaceWidth: number;
let desktop: boolean;
let mediaChange: () => void;
let resizeWorkspace: () => void;
let captured: number | null;
beforeEach(() => {
  localStorage.clear();
  workspaceWidth = 1200;
  desktop = true;
  captured = null;
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({
    get matches() { return desktop; }, media: query, onchange: null,
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => { mediaChange = listener as () => void; },
    removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) {
    return this.hasAttribute("data-navigation-mode") ? workspaceWidth : 0;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resizeWorkspace = callback; }
    observe() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn((id: number) => { captured = id; }) });
  vi.spyOn(HTMLElement.prototype, "hasPointerCapture").mockImplementation(id => captured === id);
  vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(() => { captured = null; });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});
function Layout() {
  const [control, setControl] = useState<VaultNavigationControl | null>(null);
  return <><button id="vault-navigation-trigger" onClick={() => control?.onToggle()}>Open navigator</button>
    <Outlet context={{ setVaultNavigationControl: setControl, minimumVaultWorkspaceWidth: 656 }} /></>;
}
function renderShell(entry = "/vault/demo") {
  return render(<MemoryRouter initialEntries={[entry]}><Routes><Route element={<Layout />}>
    <Route path="/vault/:name?" element={<VaultShell />}><Route index element={<p>Vault content</p>} /></Route>
  </Route></Routes></MemoryRouter>);
}
function mode() { return document.querySelector("[data-navigation-mode]")?.getAttribute("data-navigation-mode"); }
function drag(handle: HTMLElement, delta: number, release = true) {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 + delta });
  if (release) fireEvent.pointerUp(handle, { pointerId: 1 });
}

describe("VaultShell independent column resizing", () => {
  it.each([1200, 800])("resizes the Vault list with Collections collapsed at workspace width %i", width => {
    workspaceWidth = width;
    localStorage.setItem("akb.treeVisible", "0");
    renderShell();
    if (mode() === "overlay") fireEvent.click(screen.getByRole("button", { name: "Open navigator" }));
    const handle = screen.getByRole("separator", { name: "Resize vault list" });
    expect(handle).toHaveAttribute("aria-controls", "vault-list-sidebar");
    expect(handle).toHaveAttribute("aria-valuemin", "192");
    expect(handle).toHaveAttribute("aria-valuemax", "320");
    expect(document.getElementById("vault-list-sidebar")).toContainElement(screen.getByRole("navigation", { name: "Vaults" }));
    drag(handle, 40);
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "258px" });
    expect(handle).toHaveAttribute("aria-valuenow", "258");
    expect(localStorage.getItem("akb.vaultRailWidth.v2")).toBe("258");
    expect(localStorage.getItem("akb.treeVisible")).toBe("0");
    expect(screen.queryByRole("separator", { name: "Resize tree panel" })).not.toBeInTheDocument();
  });
  it("keeps the captured handle mounted until release when resizing crosses the inline boundary", () => {
    workspaceWidth = 920;
    localStorage.setItem("akb.treeVisible", "0");
    renderShell();
    expect(mode()).toBe("inline");
    const handle = screen.getByRole("separator", { name: "Resize vault list" });
    drag(handle, 80, false);
    expect(mode()).toBe("inline");
    expect(handle.isConnected).toBe(true);
    expect(captured).toBe(1);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 290 });
    expect(handle).toHaveAttribute("aria-valuenow", "308");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(mode()).toBe("overlay");
    expect(screen.getByRole("separator", { name: "Resize vault list" })).toBe(handle);
    expect(handle).toHaveFocus();
    expect(document.body.style.cursor).toBe("");
    expect(captured).toBeNull();
  });
  it("can narrow an overlay back into inline mode without changing widths or collapse preferences", () => {
    workspaceWidth = 920;
    localStorage.setItem("akb.treeVisible", "0");
    localStorage.setItem("akb.vaultRailWidth.v2", "300");
    renderShell();
    expect(mode()).toBe("overlay");
    fireEvent.click(screen.getByRole("button", { name: "Open navigator" }));
    const handle = screen.getByRole("separator", { name: "Resize vault list" });
    drag(handle, -80, false);
    expect(mode()).toBe("overlay");
    expect(handle).toHaveAttribute("aria-valuenow", "220");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(mode()).toBe("inline");
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "220px" });
    expect(localStorage.getItem("akb.treeVisible")).toBe("0");
  });
  it("preserves desktop width and collapse preferences across temporary overlay and mobile modes", () => {
    localStorage.setItem("akb.vaultRailWidth.v2", "280");
    localStorage.setItem("akb.treeWidth.v2", "300");
    localStorage.setItem("akb.vaultRailCollapsed", "1");
    renderShell();
    expect(screen.queryByRole("separator", { name: "Resize vault list" })).not.toBeInTheDocument();
    act(() => { workspaceWidth = 800; resizeWorkspace(); });
    fireEvent.click(screen.getByRole("button", { name: "Open navigator" }));
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "56px" });
    fireEvent.click(screen.getByRole("button", { name: "Expand vaults" }));
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "280px" });
    expect(screen.getByRole("separator", { name: "Resize vault list" })).toBeInTheDocument();
    act(() => { desktop = false; mediaChange(); });
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "160px" });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse vaults" }));
    act(() => { desktop = true; workspaceWidth = 1400; mediaChange(); resizeWorkspace(); });
    expect(mode()).toBe("inline");
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "280px" });
    expect(localStorage.getItem("akb.vaultRailCollapsed")).toBe("0");
    expect(localStorage.getItem("akb.vaultRailWidth.v2")).toBe("280");
    expect(localStorage.getItem("akb.treeWidth.v2")).toBe("300");
  });
  it("keeps the tree handle until its drag ends and exposes keyboard bounds for both columns", () => {
    workspaceWidth = 1200;
    renderShell();
    const handle = screen.getByRole("separator", { name: "Resize tree panel" });
    expect(handle).toHaveAttribute("aria-controls", "vault-collections-sidebar");
    expect(handle).toHaveAttribute("aria-valuemin", "220");
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    drag(handle, 100, false);
    expect(mode()).toBe("inline");
    expect(handle.isConnected).toBe(true);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(mode()).toBe("overlay");
    expect(document.body.style.userSelect).toBe("");
    const rail = screen.getByRole("separator", { name: "Resize vault list" });
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail).toHaveAttribute("aria-valuenow", "226");
  });
  it("cleans up an active drag when changing to the mobile drawer removes its handle", () => {
    localStorage.setItem("akb.treeVisible", "0");
    renderShell();
    const handle = screen.getByRole("separator", { name: "Resize vault list" });
    drag(handle, 20, false);
    expect(document.body.style.cursor).toBe("col-resize");
    act(() => { desktop = false; mediaChange(); });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(captured).toBeNull();
    expect(localStorage.getItem("akb.vaultRailWidth.v2")).toBe("238");
  });
  it("offers a resizable Vault list before a Vault is selected", () => {
    renderShell("/vault");
    const handle = screen.getByRole("separator", { name: "Resize vault list" });
    drag(handle, 50);
    expect(screen.getByRole("navigation", { name: "Vaults" })).toHaveStyle({ width: "268px" });
    expect(screen.queryByRole("complementary", { name: "Collections" })).not.toBeInTheDocument();
  });
});
