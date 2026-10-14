import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipText } from "@/components/ui/tooltip-text";

const originals = ["scrollWidth", "clientWidth"].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
);

/** jsdom has no layout: report the element whose text is `text` as clipped. */
function stubOverflowingText(text: string) {
  const widths = { scrollWidth: 320, clientWidth: 120 };
  for (const [name, width] of Object.entries(widths)) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent === text ? width : 0;
      },
    });
  }
}

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe("TooltipText overflow reporting", () => {
  it("reports when the measured text overflows its box", async () => {
    stubOverflowingText("A label wider than its column");
    const onOverflowChange = vi.fn();
    render(
      <TooltipText className="truncate" onOverflowChange={onOverflowChange}>
        A label wider than its column
      </TooltipText>,
    );
    await waitFor(() => expect(onOverflowChange).toHaveBeenLastCalledWith(true));
  });

  it.each([
    [false, "beside its trigger"],
    [true, "on document.body"],
  ])("with portal=%s renders the open tooltip %s", async (portal, _where) => {
    stubOverflowingText("A label wider than its column");
    const user = userEvent.setup();
    render(
      <div data-testid="host">
        <TooltipText className="truncate" portal={portal}>
          A label wider than its column
        </TooltipText>
      </div>,
    );
    await user.hover(screen.getByText("A label wider than its column"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("A label wider than its column");
    if (portal) expect(screen.getByTestId("host")).not.toContainElement(tooltip);
    else expect(screen.getByTestId("host")).toContainElement(tooltip);
  });

  it("reports false for text that fits and keeps the callback off the DOM", () => {
    const onOverflowChange = vi.fn();
    render(
      <TooltipText className="truncate" onOverflowChange={onOverflowChange}>
        Fits
      </TooltipText>,
    );
    expect(onOverflowChange).toHaveBeenLastCalledWith(false);
    expect(onOverflowChange).not.toHaveBeenCalledWith(true);
    expect(screen.getByText("Fits").getAttributeNames().sort()).toEqual(["class", "data-state"]);
  });
});
