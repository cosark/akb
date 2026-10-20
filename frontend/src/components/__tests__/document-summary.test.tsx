import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DocumentSummary } from "../document-summary";

describe("DocumentSummary", () => {
  it("opens the full summary from the keyboard and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const summary = "A long summary that stays readable in full.\nIt also preserves paragraph breaks.";
    render(<DocumentSummary summary={summary} />);
    await user.tab();
    const trigger = screen.getByRole("button", { name: "Read document summary" });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    const popup = screen.getByRole("dialog", { name: "Document summary" });
    expect(popup).toHaveAccessibleDescription(summary);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("dismisses on outside click and does not retain an old document's open summary", async () => {
    const user = userEvent.setup();
    const view = render(<><DocumentSummary summary="First document summary" /><button>Outside</button></>);
    await user.click(screen.getByRole("button", { name: "Read document summary" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read document summary" }));
    view.rerender(<DocumentSummary summary="Next document summary" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read document summary" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Next document summary");
    view.rerender(<DocumentSummary summary="  " />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
