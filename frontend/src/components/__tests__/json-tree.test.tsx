import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonTree } from "@/components/json-tree";

afterEach(cleanup);

describe("JSON progressive disclosure", () => {
  it.each(["array", "object"])("reveals a large %s in 100-item batches", async (kind) => {
    const values = Array.from({ length: 1000 }, (_, index) => `entry-${index}`);
    const data = kind === "array" ? values : Object.fromEntries(values.map((value) => [value, value]));
    const user = userEvent.setup();
    render(<JsonTree data={data} />);
    expect(screen.queryByText('"entry-100"')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show 100 more (900 remaining)" }));
    expect(screen.getByText('"entry-199"')).toBeInTheDocument();
    expect(screen.queryByText('"entry-200"')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show 100 more (800 remaining)" }));
    expect(screen.getByText('"entry-299"')).toBeInTheDocument();
    expect(screen.queryByText('"entry-300"')).toBeNull();
    expect(screen.queryByText('"entry-999"')).toBeNull();
  });
});
