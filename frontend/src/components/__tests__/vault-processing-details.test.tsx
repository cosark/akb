import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VaultProcessingDetails } from "../vault-processing-details";
import { normalizeIndexingResponse } from "@/lib/indexing-status";

const alpha = normalizeIndexingResponse({ search_update_status: { version: 1, stages: {
  search_index: { mode: "enabled", unit: "chunks", scope: "stored_chunks", pending: 7 },
} } }, { id: "alpha", name: "alpha" }, Date.now());
const state = { verified: true, observations: [alpha] };
vi.mock("@/hooks/use-search-status", () => ({ useOptionalSearchStatus: () => state }));
afterEach(cleanup);
beforeEach(() => { state.verified = true; });

it("discloses only the current Vault's operational observations and closes with Escape", async () => {
  const user = userEvent.setup();
  const view = render(<VaultProcessingDetails vaultName="alpha" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Indexing details" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("7 chunks pending");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Indexing details" })).toHaveFocus();
  view.rerender(<VaultProcessingDetails vaultName="beta" />);
  await user.click(screen.getByRole("button", { name: "Indexing details" }));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("7 chunks pending");
  expect(screen.getByRole("dialog")).toHaveTextContent("has not been verified");
});

it("never exposes cached private observations before access verification", async () => {
  state.verified = false;
  const user = userEvent.setup();
  render(<VaultProcessingDetails vaultName="alpha" />);
  await user.click(screen.getByRole("button", { name: "Indexing details" }));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("7 chunks pending");
  expect(screen.getByRole("dialog")).toHaveTextContent("has not been verified");
});
