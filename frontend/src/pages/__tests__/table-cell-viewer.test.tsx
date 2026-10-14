import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VaultRefreshProvider } from "@/contexts/vault-refresh-context";
import { CurrentUserProvider } from "@/contexts/current-user-context";
import { ResourceLocationProvider } from "@/contexts/resource-location-context";
import { formatCellValue } from "@/lib/table-cell-value";
import TablePage from "@/pages/table";

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  class TableRowConflictError extends Error {}
  return {
    ApiError,
    TableRowConflictError,
    createPublication: vi.fn(),
    createPublicationSnapshot: vi.fn(),
    deletePublication: vi.fn(),
    deleteVaultTable: vi.fn(),
    deleteVaultTableRow: vi.fn(),
    getVaultInfo: vi.fn(),
    getVaultTableRow: vi.fn(),
    insertVaultTableRow: vi.fn(),
    listPublications: vi.fn(),
    listVaultTableRows: vi.fn(),
    listVaultTables: vi.fn(),
    previewTablePublicationQuery: vi.fn(),
    updateVaultTableRow: vi.fn(),
  };
});

import { getVaultInfo, listVaultTableRows, listVaultTables } from "@/lib/api";

const vaultInfoMock = getVaultInfo as unknown as ReturnType<typeof vi.fn>;
const listTablesMock = listVaultTables as unknown as ReturnType<typeof vi.fn>;
const listRowsMock = listVaultTableRows as unknown as ReturnType<typeof vi.fn>;

const rowId = "6ab163e8-6ea4-4d20-8765-bf912716384c";
// Longer than the grid's 120-character display limit.
const notes =
  "Root cause: the gateway retried every failed request until the connection pool was exhausted, " +
  "so new sessions queued behind stale ones and the health check timed out before failover began.";
const steps = "Drain the gateway\nRotate the pool\n\nConfirm recovery";
const metadata = { service: "gateway", regions: ["ap-northeast-2", "us-east-1"] };
const reader = { role: "reader", is_archived: false, is_external_git: false };
const writer = { role: "writer", is_archived: false, is_external_git: false };

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/vault/ops/table/incidents"]}>
        <VaultRefreshProvider refetchVaults={vi.fn()} refetchTree={vi.fn()}>
          <CurrentUserProvider user={null} revision={0} checking={false}>
            <ResourceLocationProvider identity="test-account" revision={0} checking={false}>
              <Routes>
                <Route path="/vault/:name/table/:table" element={<TablePage />} />
              </Routes>
            </ResourceLocationProvider>
          </CurrentUserProvider>
        </VaultRefreshProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fullValue(dialog: HTMLElement) {
  return within(dialog).getByRole("region", { name: "Full value" });
}

/**
 * jsdom has no layout, so every element measures 0×0. Report the element
 * whose text is `text` as wider than its box; everything else keeps 0.
 */
function stubOverflowingText(text: string) {
  const originals = ["scrollWidth", "clientWidth"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  const widths = { scrollWidth: 320, clientWidth: 120 };
  for (const [name, width] of Object.entries(widths)) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent === text ? width : 0;
      },
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  vaultInfoMock.mockReset();
  listTablesMock.mockReset();
  listRowsMock.mockReset();
  vaultInfoMock.mockResolvedValue(reader);
  listTablesMock.mockResolvedValue({
    items: [{
      name: "incidents",
      collection: "operations",
      description: "Operational incidents",
      row_count: 1,
      columns: [
        { name: "title", type: "text", required: true },
        { name: "notes", type: "text" },
        { name: "steps", type: "text" },
        { name: "metadata", type: "jsonb" },
        { name: "owner", type: "text" },
      ],
    }],
  });
  listRowsMock.mockResolvedValue({
    kind: "table_query",
    columns: ["id", "title", "notes", "steps", "metadata", "owner", "created_at"],
    items: [{
      id: rowId,
      title: "API outage",
      notes,
      steps,
      metadata,
      owner: null,
      created_at: "2026-08-31T04:45:00Z",
      updated_at: "2026-09-01T04:45:00Z",
    }],
    total: 1,
  });
});

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("table cell viewer", () => {
  it("opens the full value of a cell cut by the display limit", async () => {
    const user = userEvent.setup();
    renderTable();
    const cell = await screen.findByRole("button", { name: /^Root cause:/ });
    expect(cell).toHaveTextContent(`${notes.slice(0, 120)}…`);

    await user.click(cell);

    const dialog = screen.getByRole("dialog", { name: "notes" });
    expect(dialog).toHaveAccessibleDescription("text · row 1");
    expect(fullValue(dialog).textContent).toBe(notes);
  });

  it("pretty-prints an object value with two-space indentation", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: JSON.stringify(metadata) }));

    const body = fullValue(screen.getByRole("dialog", { name: "metadata" }));
    expect(body.querySelector("pre")?.textContent).toBe(
      [
        "{",
        '  "service": "gateway",',
        '  "regions": [',
        '    "ap-northeast-2",',
        '    "us-east-1"',
        "  ]",
        "}",
      ].join("\n"),
    );
    expect(body.textContent).toBe(formatCellValue(metadata).text);
  });

  it("keeps a string's line breaks and marks a null value", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: /^Drain the gateway/ }));

    const text = fullValue(screen.getByRole("dialog", { name: "steps" })).firstElementChild;
    expect(text?.textContent).toBe(steps);
    expect(text).toHaveClass("whitespace-pre-wrap");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "null" }));

    const marker = within(fullValue(screen.getByRole("dialog", { name: "owner" }))).getByText("null");
    expect(marker).toHaveClass("italic", "text-foreground-muted");
  });

  it("copies exactly the text the viewer shows", async () => {
    const user = userEvent.setup();
    // After setup(): user-event installs its own clipboard stub there.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderTable();

    await user.click(await screen.findByRole("button", { name: JSON.stringify(metadata) }));
    let dialog = screen.getByRole("dialog", { name: "metadata" });
    await user.click(within(dialog).getByRole("button", { name: "Copy value" }));
    expect(writeText).toHaveBeenLastCalledWith(JSON.stringify(metadata, null, 2));
    expect(await within(dialog).findByRole("button", { name: "Copy value: copied" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Drain the gateway/ }));
    dialog = screen.getByRole("dialog", { name: "steps" });
    await user.click(within(dialog).getByRole("button", { name: "Copy value" }));
    expect(writeText).toHaveBeenLastCalledWith(steps);
  });

  it("lets a reader without row permissions open a cell", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: "API outage" }));

    expect(screen.queryByRole("button", { name: "Actions for row 1" })).not.toBeInTheDocument();
    expect(fullValue(screen.getByRole("dialog", { name: "title" }))).toHaveTextContent("API outage");
  });

  it("makes only partly hidden cells tab stops and returns focus on Escape", async () => {
    const user = userEvent.setup();
    renderTable();
    const capped = await screen.findByRole("button", { name: /^Root cause:.*\(view full value\)$/ });
    const visible = screen.getByRole("button", { name: "API outage" });
    expect(capped).toHaveAttribute("tabindex", "0");
    expect(visible).toHaveAttribute("tabindex", "-1");
    expect(visible).toHaveAttribute("aria-haspopup", "dialog");

    // From the last column header, Tab skips the fully visible id and title cells.
    screen.getByRole("button", { name: /^Sort by created_at/ }).focus();
    await user.tab();
    expect(capped).toHaveFocus();

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "notes" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(capped).toHaveFocus());

    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "notes" })).toBeInTheDocument();
  });

  it("makes a cell a tab stop when its text overflows the column", async () => {
    const restore = stubOverflowingText("API outage");
    try {
      const user = userEvent.setup();
      renderTable();
      const title = await screen.findByRole("button", { name: "API outage (view full value)" });
      expect(title).toHaveAttribute("tabindex", "0");
      expect(screen.getByRole("button", { name: JSON.stringify(metadata) })).toHaveAttribute("tabindex", "-1");

      // The hover tooltip still appears, outside the button, so the button's
      // content and accessible name stay the cell's own text.
      await user.hover(screen.getByText("API outage"));
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent("API outage");
      expect(title).not.toContainElement(tooltip);
      expect(title).toHaveAccessibleName("API outage (view full value)");
    } finally {
      restore();
    }
  });

  it("makes a short multi-line string a tab stop, since one line hides its breaks", async () => {
    renderTable();
    const multiLine = await screen.findByRole("button", {
      name: /^Drain the gateway\s+Rotate the pool\s+Confirm recovery \(view full value\)$/,
    });
    expect(steps.length).toBeLessThan(120);
    expect(multiLine).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "API outage" })).toHaveAttribute("tabindex", "-1");
  });

  it("names an empty cell and marks it in the viewer", async () => {
    listRowsMock.mockResolvedValue({
      kind: "table_query",
      columns: ["id", "title"],
      items: [{ id: rowId, title: "", updated_at: "2026-09-01T04:45:00Z" }],
      total: 1,
    });
    const user = userEvent.setup();
    renderTable();
    const empty = await screen.findByRole("button", { name: "Empty" });
    expect(empty).toHaveAttribute("tabindex", "-1");

    await user.click(empty);
    const body = fullValue(screen.getByRole("dialog", { name: "title" }));
    expect(within(body).getByText("Empty string")).toHaveClass("italic");
  });

  it("does not open the viewer from the row number column", async () => {
    vaultInfoMock.mockResolvedValue(writer);
    const user = userEvent.setup();
    renderTable();
    await screen.findByRole("button", { name: "Actions for row 1" });
    const [rowNumber] = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(rowNumber).toHaveTextContent("1");
    expect(within(rowNumber).queryByRole("button")).not.toBeInTheDocument();

    await user.click(rowNumber);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
