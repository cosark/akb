import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentConflictNotice } from "@/components/document-conflict-notice";
import { documentDetailsFrom } from "@/lib/document-details";
import type { DocumentConflictSnapshot } from "@/lib/document-conflict";

afterEach(cleanup);
const base: DocumentConflictSnapshot = { label: "Original base", commit: "r0", title: "Note", body: "Original body", details: documentDetailsFrom({ summary: "Before" }) };
const local = { ...base, label: "Your draft", body: "My body" };
const latest = { ...base, label: "Latest server version", commit: "r1", body: "Remote body" };
const callbacks = () => ({ onApply: vi.fn(), onCancel: vi.fn(), onRetryLatest: vi.fn() });

describe("document conflict recovery", () => {
  it("requires an explicit body resolution, never relabels the old draft", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<DocumentConflictNotice base={base} local={local} latest={latest} loading={false} {...actions} />);
    expect(screen.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    const body = screen.getByRole("textbox", { name: "Combined document body" });
    expect(body).toHaveValue("Remote body");
    await user.type(body, "\nMy body");
    await user.click(screen.getByRole("button", { name: "Apply combined changes" }));
    expect(actions.onApply).toHaveBeenCalledWith(expect.objectContaining({ body: "Remote body\nMy body" }));
    expect(local.body).toBe("My body");
  });

  it("combines different fields without overriding the latest body", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<DocumentConflictNotice base={base} local={{ ...base, title: "My title" }} latest={latest} loading={false} {...actions} />);
    await user.click(screen.getByRole("button", { name: "Apply combined changes" }));
    expect(actions.onApply).toHaveBeenCalledWith(expect.objectContaining({ title: "My title", body: "Remote body" }));
  });

  it("keeps the chosen result pinned when another version is observed", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    const view = render(<DocumentConflictNotice base={base} local={local} latest={latest} loading={false} {...actions} />);
    await user.type(screen.getByRole("textbox", { name: "Combined document body" }), "\ncombined");
    view.rerender(<DocumentConflictNotice base={base} local={local} latest={latest} newerRevision="r2" loading={false} {...actions} />);
    expect(screen.getByText(/The server changed again/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Combined document body" })).toHaveValue("Remote body\ncombined");
    await user.click(screen.getByRole("button", { name: "Apply combined changes" }));
    expect(actions.onApply).toHaveBeenCalledWith(expect.objectContaining({ body: "Remote body\ncombined" }));
  });

  it("offers retry and cancellation when the latest read fails", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<DocumentConflictNotice base={base} local={local} latest={null} latestError="Latest read failed" loading={false} {...actions} />);
    expect(screen.getByText("Latest read failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Try loading latest" }));
    expect(actions.onRetryLatest).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(actions.onCancel).toHaveBeenCalledOnce();
    expect(actions.onApply).not.toHaveBeenCalled();
  });

  it("asks before replacing an in-progress combined result", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<DocumentConflictNotice base={base} local={local} latest={latest} loading={false} {...actions} />);
    await user.type(screen.getByRole("textbox", { name: "Combined document body" }), " combined");
    await user.click(screen.getByRole("button", { name: "Reload comparison" }));
    expect(actions.onRetryLatest).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Reload this comparison?" })).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Reload comparison" }).at(-1)!);
    expect(actions.onRetryLatest).toHaveBeenCalledOnce();
  });

  it("does not silently choose a conflicting title or metadata field", async () => {
    const user = userEvent.setup();
    const actions = callbacks();
    render(<DocumentConflictNotice base={base} local={{ ...local, title: "Mine", details: documentDetailsFrom({ summary: "Mine" }) }} latest={{ ...latest, title: "Theirs", details: documentDetailsFrom({ summary: "Theirs" }) }} loading={false} {...actions} />);
    await user.click(screen.getByRole("button", { name: "Keep latest body" }));
    await user.click(screen.getByRole("button", { name: "Use my title" }));
    expect(screen.getByRole("button", { name: "Apply combined changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use latest summary" }));
    await user.click(screen.getByRole("button", { name: "Apply combined changes" }));
    expect(actions.onApply).toHaveBeenCalledWith(expect.objectContaining({ title: "Mine", body: "Remote body", details: expect.objectContaining({ summary: "Theirs" }) }));
  });
});
