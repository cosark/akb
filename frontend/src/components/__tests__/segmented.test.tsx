import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented } from "@/components/ui/segmented";

afterEach(cleanup);

function Choices({ descriptions = false, disabled = false }: { descriptions?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState("private");
  return <Segmented aria-label="Access policy" value={value} onChange={setValue} disabled={disabled}
    options={[
      { value: "private", label: "Private", description: descriptions ? "Invited members only." : undefined },
      { value: "public", label: "Public read", description: descriptions ? "Signed-in people can read." : undefined },
    ]} />;
}

describe("Segmented choices", () => {
  it("keeps compact choices unchanged when explanations are omitted", async () => {
    const user = userEvent.setup();
    render(<Choices />);
    const first = screen.getByRole("radio", { name: "Private" });
    expect(first).toHaveAttribute("aria-checked", "true");
    expect(first).not.toHaveAttribute("aria-describedby");
    await user.click(screen.getByRole("radio", { name: "Public read" }));
    expect(first).toHaveAttribute("aria-checked", "false");
  });

  it("associates option explanations without changing short names or keyboard selection", async () => {
    const user = userEvent.setup();
    render(<Choices descriptions />);
    const first = screen.getByRole("radio", { name: "Private" });
    const second = screen.getByRole("radio", { name: "Public read" });
    expect(first).toHaveAccessibleDescription("Invited members only.");
    expect(second).toHaveAccessibleDescription("Signed-in people can read.");
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-checked", "true");
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(second.querySelector(".lucide-check")).toHaveAttribute("aria-hidden", "true");
    await user.keyboard("{ArrowRight}");
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-checked", "true");
  });

  it("keeps explained choices read-only when disabled", async () => {
    const user = userEvent.setup();
    render(<Choices descriptions disabled />);
    const second = screen.getByRole("radio", { name: "Public read" });
    expect(second).toBeDisabled();
    await user.click(second);
    expect(second).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Private" })).toHaveAttribute("aria-checked", "true");
  });
});
