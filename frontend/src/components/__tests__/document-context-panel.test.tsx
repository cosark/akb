import { useRef, useState } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentContextPanel } from "../document-context-panel";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

function ContextHarness() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"info" | "outline" | "relations" | "history">("outline");
  const [actions, setActions] = useState(0);
  const [editing, setEditing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <div data-testid="reader-layout">
    <main id="document-reading-canvas"><h2 id="article-heading">Article heading</h2><button type="button" onClick={() => setActions(n => n + 1)}>Article action</button><output aria-label="Actions performed">{actions}</output></main>
    <button ref={triggerRef} type="button" aria-label="Document details" aria-controls="reader-details" aria-expanded={open} onClick={() => setOpen(!open)}>Details</button>
    <DocumentContextPanel id="reader-details" open={open} onOpenChange={setOpen} view={view} onViewChange={setView} triggerRef={triggerRef}
      outline={<><p>outline content</p><a href="#article-heading">Jump to article heading</a></>}
      info={<><p>info content</p><button type="button" onClick={() => setEditing(true)}>Edit properties</button></>}
      history={<p>history content</p>}
      relations={<p>relations content</p>}
    />
    <Dialog open={editing} onOpenChange={setEditing}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Edit details</DialogTitle>
        <input aria-label="Summary" />
      </DialogContent>
    </Dialog>
  </div>;
}

function disclosure(panel: HTMLElement, name: string) {
  const summary = within(panel).getByText(name, { exact: true }).closest("summary");
  if (!summary) throw new Error(`Missing ${name} disclosure`);
  return summary;
}

function measureReader(initialWidth: number, initialHeight = 800) {
  let width = initialWidth;
  let height = initialHeight;
  let resize = () => {};
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid !== "reader-layout") return originalBounds.call(this);
    return { width, height, x: 0, y: 0, top: 0, bottom: height, left: 0, right: width, toJSON: () => ({}) };
  });
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe(element: HTMLElement) { if (element.dataset.testid === "reader-layout") resize = this.callback; }
    unobserve() {}
    disconnect() {}
  });
  return (nextWidth: number, nextHeight = height) => act(() => { width = nextWidth; height = nextHeight; resize(); });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentContextPanel", () => {
  it("uses one toolbar trigger and mutually exclusive native disclosures beside the persistent outline", async () => {
    const user = userEvent.setup();
    measureReader(1088);
    render(<ContextHarness />);
    const trigger = screen.getByRole("button", { name: "Document details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Document context" })).not.toBeInTheDocument();
    await user.click(trigger);
    const panel = screen.getByRole("complementary", { name: "Document details" });
    expect(panel).toHaveAttribute("data-mode", "docked");
    expect(panel.parentElement).toBe(screen.getByTestId("reader-layout"));
    expect(trigger).toHaveAttribute("aria-controls", panel.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Close document panel" })).toHaveFocus();
    expect(within(panel).getByText("outline content")).toBeVisible();
    expect(within(panel).queryByText("info content")).not.toBeInTheDocument();
    expect(within(panel).queryByText("relations content")).not.toBeInTheDocument();

    const properties = disclosure(panel, "Properties");
    const relations = disclosure(panel, "Related documents");
    await user.click(properties);
    expect(properties.parentElement).toHaveAttribute("open");
    expect(within(panel).getByText("info content")).toBeVisible();
    await user.click(relations);
    expect(relations.parentElement).toHaveAttribute("open");
    expect(properties.parentElement).not.toHaveAttribute("open");
    expect(within(panel).queryByText("info content")).not.toBeInTheDocument();
    expect(within(panel).getByText("relations content")).toBeVisible();
    expect(within(panel).getByText("outline content")).toBeVisible();
    await user.click(relations);
    expect(relations.parentElement).not.toHaveAttribute("open");
    expect(within(panel).queryByText("relations content")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Close document panel" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it.each([600, 1200])("keeps the outline and its focus available for repeated navigation at %ipx", async width => {
    const user = userEvent.setup();
    measureReader(width);
    render(<ContextHarness />);
    const originalUrl = window.location.href;
    const originalHistory = window.history.state;
    const trigger = screen.getByRole("button", { name: "Document details" });
    await user.click(trigger);
    const panel = screen.getByRole(width >= 768 ? "complementary" : "dialog", { name: "Document details" });
    const link = within(panel).getByRole("link", { name: "Jump to article heading" });
    await user.click(link);
    expect(panel).toBeInTheDocument();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(panel).toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.state).toEqual(originalHistory);
    await user.keyboard("{Escape}");
    expect(panel).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the docked panel open on an article click without swallowing the action or its focus", async () => {
    const user = userEvent.setup();
    measureReader(1200);
    render(<ContextHarness />);
    const trigger = screen.getByRole("button", { name: "Document details" });
    await user.click(trigger);
    const panel = screen.getByRole("complementary", { name: "Document details" });
    await user.click(screen.getByRole("button", { name: "Article action" }));
    expect(panel).toBeVisible();
    expect(screen.getByLabelText("Actions performed")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Article action" })).toHaveFocus();
    await user.click(within(panel).getByRole("button", { name: "Close document panel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("allows keyboard focus to leave the docked panel for the article without closing or trapping", async () => {
    const user = userEvent.setup();
    measureReader(1200);
    render(<ContextHarness />);
    await user.click(screen.getByRole("button", { name: "Document details" }));
    const panel = screen.getByRole("complementary", { name: "Document details" });
    expect(within(panel).getByRole("button", { name: "Close document panel" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Document details" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Article action" })).toHaveFocus();
    expect(panel).toBeVisible();
  });

  it.each([1200, 600])("preserves a sibling dialog draft and opener through presentation changes from %ipx", async width => {
    const user = userEvent.setup();
    const resizeReader = measureReader(width);
    render(<ContextHarness />);
    await user.click(screen.getByRole("button", { name: "Document details" }));
    const panel = screen.getByRole(width >= 768 ? "complementary" : "dialog", { name: "Document details" });
    await user.click(disclosure(panel, "Properties"));
    await user.click(within(panel).getByRole("button", { name: "Edit properties" }));
    const input = screen.getByRole("textbox", { name: "Summary" });
    await user.type(input, "Unsaved summary");
    resizeReader(width >= 768 ? 600 : 1200);
    expect(panel).toBeInTheDocument();
    expect(input).toHaveValue("Unsaved summary");
    expect(input).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Edit details" })).not.toBeInTheDocument();
    const resizedPanel = await screen.findByRole(width >= 768 ? "dialog" : "complementary", { name: "Document details" });
    expect(resizedPanel).toHaveAttribute("data-mode", width >= 768 ? "overlay" : "docked");
    const restoredOpener = within(resizedPanel).getByRole("button", { name: "Edit properties" });
    expect(restoredOpener).toBeVisible();
    await waitFor(() => expect(restoredOpener).toHaveFocus());
  });

  it("traps focus in a narrow overlay and returns it to the toolbar trigger on dismissal", async () => {
    const user = userEvent.setup();
    measureReader(600);
    render(<ContextHarness />);
    const trigger = screen.getByRole("button", { name: "Document details" });
    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Document details" });
    expect(panel).toHaveAttribute("data-mode", "overlay");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("reader-layout")).not.toContainElement(panel);
    expect(screen.queryByRole("button", { name: "Article action" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Close document panel" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(disclosure(panel, "Related documents")).toHaveFocus();
    await user.tab();
    expect(within(panel).getByRole("button", { name: "Close document panel" })).toHaveFocus();
    await user.click(disclosure(panel, "Version history"));
    expect(within(panel).getByText("history content")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close document panel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("chooses presentation from the measured reader dimensions instead of the viewport", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("innerWidth", 2560);
    const resizeReader = measureReader(600);
    render(<ContextHarness />);
    await user.click(screen.getByRole("button", { name: "Document details" }));
    expect(screen.getByRole("dialog", { name: "Document details" })).toHaveAttribute("data-mode", "overlay");
    resizeReader(1200);
    expect(await screen.findByRole("complementary", { name: "Document details" })).toHaveAttribute("data-mode", "docked");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Article action" })).toBeVisible();
    resizeReader(1200, 300);
    expect(await screen.findByRole("dialog", { name: "Document details" })).toHaveAttribute("data-mode", "overlay");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    resizeReader(1200, 800);
    expect(await screen.findByRole("complementary", { name: "Document details" })).toHaveAttribute("data-mode", "docked");
    resizeReader(600);
    expect(await screen.findByRole("dialog", { name: "Document details" })).toHaveAttribute("data-mode", "overlay");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
