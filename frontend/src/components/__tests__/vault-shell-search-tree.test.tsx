import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResourceLocationProvider, usePublishResourceLocation } from "@/contexts/resource-location-context";

import { VaultShell } from "@/components/vault-shell";

vi.mock("@/components/vault-explorer", () => ({
  VaultExplorer: ({ onCollapse }: { onCollapse?: () => void }) => <aside aria-label="Collections">
    <button type="button" onClick={onCollapse}>Collapse collections</button>
    Collection tree content
  </aside>,
}));

vi.mock("@/components/vault-rail", () => ({
  VaultRail: () => <nav aria-label="Vaults">Vault rail</nav>,
}));

vi.mock("@/components/title-bar", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/title-bar")>(),
  TitleBar: ({ left, right, breadcrumb }: { left?: React.ReactNode; right?: React.ReactNode; breadcrumb?: React.ReactNode }) => (
    <header data-testid="title-bar">
      {left}
      {breadcrumb}
      {right}
    </header>
  ),
  VaultActions: () => null,
}));

vi.mock("@/components/vault-create-dialog", () => ({
  VaultCreateDialog: () => null,
}));

vi.mock("@/components/document-create-dialog", () => ({
  DocumentCreateDialog: () => null,
}));

vi.mock("@/hooks/use-column-resize", () => ({
  useColumnResize: ({ default: width }: { default: number }) => ({
    width,
    setWidth: vi.fn(),
    reset: vi.fn(),
    handlers: {},
  }),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("akb.treeVisible", "1");
});

function renderShell(entry = "/vault/demo/search") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/vault/:name" element={<VaultShell />}>
          <Route
            index
            element={
              <div>
                Overview page
                <Link to="/vault/demo/search">Open search</Link>
              </div>
            }
          />
          <Route
            path="search"
            element={
              <div>
                Search page
                <Link to="/vault/demo">Open overview</Link>
              </div>
            }
          />
          {["members", "publications", "settings", "graph"].map(route => <Route key={route} path={route}
            element={<div>{route} page<Link to="/vault/demo">Open overview</Link></div>} />)}
          <Route path="activity" element={<div>Activity page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("VaultShell search collection tree", () => {
  it("does not interpret the Search collection filter as a shortcut reveal", () => {
    localStorage.setItem("akb.treeVisible", "0");
    renderShell("/vault/demo/search?collection=guides");
    expect(screen.queryByText("Collection tree content")).toBeNull();
  });
  it("reveals a pinned collection without changing the saved preference", async () => {
    localStorage.setItem("akb.treeVisible", "0");
    renderShell("/vault/demo?collection=guides");
    expect(screen.getByText("Collection tree content")).toBeTruthy();
    expect(localStorage.getItem("akb.treeVisible")).toBe("0");
  });
  it("keeps the chosen navigation density across Search and Overview", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText("Collection tree content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse collections" })).toBeTruthy();
    expect(window.localStorage.getItem("akb.treeVisible")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Collapse collections" }));
    expect(screen.queryByText("Collection tree content")).toBeNull();
    expect(window.localStorage.getItem("akb.treeVisible")).toBe("0");

    await user.click(screen.getByRole("link", { name: "Open overview" }));
    expect(screen.queryByText("Collection tree content")).toBeNull();

    await user.click(screen.getByRole("link", { name: "Open search" }));
    expect(screen.queryByText("Collection tree content")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand collections" }));
    expect(screen.getByText("Collection tree content")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Collections" })).queryByRole("navigation")).not.toBeInTheDocument();
  });

  it.each(["activity"])(
    "retains Collections without a second navigation row on the %s tool view",
    async (route) => {
      render(
        <MemoryRouter initialEntries={[`/vault/demo/${route}`]}>
          <Routes>
            <Route path="/vault/:name" element={<VaultShell />}>
              <Route path={route} element={<div>{route} page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText("Collection tree content")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Collapse collections" })).toBeTruthy();
      expect(window.localStorage.getItem("akb.treeVisible")).toBe("1");

      const routeViewport = document.querySelector('[data-slot="vault-route-viewport"]');
      expect(routeViewport).not.toBeNull();
      expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
      expect(within(screen.getByRole("complementary", { name: "Collections" })).queryByRole("link")).not.toBeInTheDocument();
      if (route === "settings") {
        expect(routeViewport).toHaveClass("xl:overflow-hidden");
      } else {
        expect(routeViewport).not.toHaveClass("xl:overflow-hidden");
      }

      if (route === "activity" || route === "publications" || route === "members") {
        expect(routeViewport?.firstElementChild).toHaveClass("px-3", "xl:px-5");
      }
    },
  );
});

describe("VaultShell focused task presentation", () => {
  it.each(["members", "publications", "settings", "graph", "settings/"])(
    "omits both the tree and section row on %s without changing preferences",
    async route => {
      const user = userEvent.setup();
      localStorage.setItem("akb.treeWidth.v2", "300");
      renderShell(`/vault/demo/${route}`);
      expect(screen.queryByText("Collection tree content")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /collections/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
      expect(screen.queryByRole("separator", { name: "Resize tree panel" })).not.toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Vaults" })).toBeInTheDocument();
      expect(localStorage.getItem("akb.treeVisible")).toBe("1");
      expect(localStorage.getItem("akb.treeWidth.v2")).toBe("300");
      await user.click(screen.getByRole("link", { name: "Open overview" }));
      expect(screen.getByText("Collection tree content")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
    },
  );

  it("retains a collapsed tree preference when returning to content", async () => {
    const user = userEvent.setup();
    localStorage.setItem("akb.treeVisible", "0");
    renderShell("/vault/demo/settings");
    expect(screen.queryByRole("button", { name: "Expand collections" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open overview" }));
    expect(screen.getByRole("button", { name: "Expand collections" })).toBeInTheDocument();
    expect(screen.queryByText("Collection tree content")).not.toBeInTheDocument();
    expect(localStorage.getItem("akb.treeVisible")).toBe("0");
  });

  it("does not mount Collections inside the mobile task navigator", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    renderShell("/vault/demo/members");
    await user.click(screen.getByRole("button", { name: "Open vault navigation" }));
    expect(screen.getByRole("navigation", { name: "Vaults" })).toBeInTheDocument();
    expect(screen.queryByText("Collection tree content")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand collections" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Navigate in demo" })).toBeInTheDocument();
    expect(localStorage.getItem("akb.treeVisible")).toBe("1");
  });
});

function ResolvedResource() {
  usePublishResourceLocation({ vault: "demo", title: "Resolved resource title", kind: "Document" });
  return <div>Resource content</div>;
}

describe("VaultShell resource navigation", () => {
  it.each([true, false])("keeps the document tree but replaces the section row with a mobile-only header menu (desktop=%s)", desktop => {
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: desktop && query === "(min-width: 1024px)", media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/vault/demo/doc/a-private-url-ref"]}>
      <ResourceLocationProvider identity="reader"><Routes><Route path="/vault/:name" element={<VaultShell />}>
        <Route path="doc/:ref" element={<ResolvedResource />} />
      </Route></Routes></ResourceLocationProvider>
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("Resource content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Vault sections" })).not.toBeInTheDocument();
    expect(localStorage.getItem("akb.treeVisible")).toBe("1");
    expect(screen.queryByText("In this vault")).not.toBeInTheDocument();
    if (desktop) {
      expect(screen.queryByTestId("title-bar")).not.toBeInTheDocument();
      expect(screen.getByText("Collection tree content")).toBeInTheDocument();
    } else {
      expect(screen.getByRole("navigation", { name: "Resource location" })).toHaveTextContent("Resolved resource title");
      expect(screen.getByRole("button", { name: "Navigate in demo" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open vault navigation" })).toBeInTheDocument();
      expect(screen.queryByText("a-private-url-ref")).not.toBeInTheDocument();
    }
  });
});
