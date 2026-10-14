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
// Longer than the 600-character display limit of wrapped cells.
const longNotes = [notes, notes, notes, notes].join(" ");
const steps = "Drain the gateway\nRotate the pool\n\nConfirm recovery";
const metadata = { service: "gateway", regions: ["ap-northeast-2", "us-east-1"] };
const reader = { role: "reader", is_archived: false, is_external_git: false };
const writer = { role: "writer", is_archived: false, is_external_git: false };
const WRAP_TEXT_KEY = "akb.tableWrapText";

function rowsResponse(overrides: Record<string, unknown> = {}) {
  return {
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
      ...overrides,
    }],
    total: 1,
  };
}

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

/** The grid's data cells; the row number and row actions cells have no data-wrap. */
function dataCells() {
  return screen.getAllByRole("cell").filter((cell) => cell.hasAttribute("data-wrap"));
}

/**
 * jsdom has no layout, so every element measures 0×0. Report the element
 * whose text is `text` with the given sizes; everything else keeps 0.
 */
function stubMeasuredText(text: string, sizes: Record<string, number>) {
  const originals = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, size] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent === text ? size : 0;
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

/** Text wider than its box, as a single truncated line leaves it. */
function stubOverflowingText(text: string) {
  return stubMeasuredText(text, { scrollWidth: 320, clientWidth: 120 });
}

/** Text taller than its box, as a line clamp leaves it. */
function stubClampedText(text: string) {
  return stubMeasuredText(text, { scrollHeight: 120, clientHeight: 40 });
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  localStorage.removeItem(WRAP_TEXT_KEY);
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
  listRowsMock.mockResolvedValue(rowsResponse());
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

describe("table wrap text", () => {
  function wrapToggle() {
    return screen.getByRole("button", { name: "Wrap text" });
  }

  function expectCellsWrapped(wrapped: boolean) {
    const cells = dataCells();
    expect(cells).toHaveLength(7);
    for (const cell of cells) expect(cell).toHaveAttribute("data-wrap", String(wrapped));
  }

  it("is off by default, so cells keep a single line", async () => {
    renderTable();
    await screen.findByRole("button", { name: "API outage" });
    expect(wrapToggle()).toHaveAttribute("aria-pressed", "false");
    expectCellsWrapped(false);
  });

  it("wraps the cells when turned on, saves the choice, and restores single lines when off", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByRole("button", { name: "API outage" });

    await user.click(wrapToggle());
    expect(wrapToggle()).toHaveAttribute("aria-pressed", "true");
    expectCellsWrapped(true);
    expect(localStorage.getItem(WRAP_TEXT_KEY)).toBe("true");
    // The 600-character limit applies now, so the whole note is in the cell.
    expect(screen.getByRole("button", { name: notes })).toHaveTextContent(notes);

    await user.click(wrapToggle());
    expect(wrapToggle()).toHaveAttribute("aria-pressed", "false");
    expectCellsWrapped(false);
    expect(localStorage.getItem(WRAP_TEXT_KEY)).toBe("false");
    expect(screen.getByRole("button", { name: /^Root cause:.*\(view full value\)$/ }))
      .toHaveTextContent(`${notes.slice(0, 120)}…`);
  });

  it("restores the saved choice when the page mounts again", async () => {
    const user = userEvent.setup();
    const first = renderTable();
    await user.click(await screen.findByRole("button", { name: "Wrap text" }));
    first.unmount();

    renderTable();
    expect(await screen.findByRole("button", { name: "Wrap text" })).toHaveAttribute("aria-pressed", "true");
    expectCellsWrapped(true);
  });

  it("falls back to single lines without crashing when storage is unavailable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    try {
      const user = userEvent.setup();
      renderTable();
      const toggle = await screen.findByRole("button", { name: "Wrap text" });
      expect(getItem).toHaveBeenCalledWith(WRAP_TEXT_KEY);
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expectCellsWrapped(false);

      // Saving fails quietly; the choice still applies to the open page.
      await user.click(toggle);
      expect(setItem).toHaveBeenCalledWith(WRAP_TEXT_KEY, "true");
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expectCellsWrapped(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("opens the viewer from a wrapped cell with the full value", async () => {
    listRowsMock.mockResolvedValue(rowsResponse({ notes: longNotes }));
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: "Wrap text" }));

    const cell = screen.getByRole("button", { name: /^Root cause:.*\(view full value\)$/ });
    expect(cell.closest("td")).toHaveAttribute("data-wrap", "true");
    await user.click(cell);

    expect(fullValue(screen.getByRole("dialog", { name: "notes" })).textContent).toBe(longNotes);
  });

  it("makes a wrapped cell a tab stop only while part of its value is hidden", async () => {
    listRowsMock.mockResolvedValue(rowsResponse({ notes: longNotes }));
    const restore = stubClampedText("API outage");
    try {
      const user = userEvent.setup();
      renderTable();
      // A single line measures only the width, so the title still fits there.
      expect(await screen.findByRole("button", { name: "API outage" })).toHaveAttribute("tabindex", "-1");

      await user.click(wrapToggle());
      // Cut by the 600-character limit.
      const capped = screen.getByRole("button", { name: /^Root cause:.*\(view full value\)$/ });
      expect(capped).toHaveAttribute("tabindex", "0");
      expect(capped).toHaveTextContent(`${longNotes.slice(0, 600)}…`);
      // Taller than its six-line clamp.
      expect(await screen.findByRole("button", { name: "API outage (view full value)" }))
        .toHaveAttribute("tabindex", "0");
      // Short values show in full, line breaks included.
      expect(screen.getByRole("button", { name: /^Drain the gateway\s+Rotate the pool\s+Confirm recovery$/ }))
        .toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("button", { name: "null" })).toHaveAttribute("tabindex", "-1");
    } finally {
      restore();
    }
  });
});
