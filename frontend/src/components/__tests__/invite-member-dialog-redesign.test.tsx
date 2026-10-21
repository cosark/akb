import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InviteMemberDialog } from "@/components/invite-member-dialog";

vi.mock("@/lib/api", () => ({
  searchUsers: vi.fn(),
  grantAccess: vi.fn(),
}));

vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

import { grantAccess, searchUsers } from "@/lib/api";

const searchUsersMock = searchUsers as unknown as ReturnType<typeof vi.fn>;
const grantAccessMock = grantAccess as unknown as ReturnType<typeof vi.fn>;

const USERS = [
  { id: "user-mina", username: "mina", display_name: "Mina Park", email: "mina@example.com", account_kind: "human", account_status: "active" },
  { id: "user-dana", username: "dana", display_name: "Dana Lee", email: "dana@example.com", account_kind: "human", account_status: "active" },
  {
    id: "user-existing",
    username: "already-here",
    display_name: "Already Member",
    email: "member@example.com",
    account_kind: "human",
    account_status: "active",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  searchUsersMock.mockResolvedValue({ users: USERS });
  grantAccessMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("InviteMemberDialog redesign", () => {
  it("connects account selection, role review, and the final invite action", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onInvited = vi.fn();

    render(
      <InviteMemberDialog
        open
        onOpenChange={onOpenChange}
        vault="platform-docs"
        existingUserIds={new Set(["user-existing"])}
        onInvited={onInvited}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Invite member" })).toBeInTheDocument();
    expect(within(dialog).getByText("platform-docs")).toBeInTheDocument();

    const mina = await within(dialog).findByRole("row", { name: /Mina Park/i });
    expect(within(dialog).queryByRole("row", { name: /Already Member/i })).toBeNull();
    expect(within(dialog).queryByRole("heading", { name: "Access level" })).toBeNull();
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Invite" })).toBeDisabled();

    await user.click(within(mina).getByRole("button", { name: "Select role for mina" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Reader" }));
    expect(mina).toHaveAttribute("data-selected", "true");
    expect(within(dialog).getByTestId("invite-summary")).toHaveTextContent(
      "Mina Park will join as Reader.",
    );

    await user.click(within(mina).getByRole("button", { name: "Select role for mina" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Writer" }));
    expect(within(dialog).getByTestId("invite-summary")).toHaveTextContent(
      "Mina Park will join as Writer.",
    );

    expect(grantAccessMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    await waitFor(() => {
      expect(grantAccessMock).toHaveBeenCalledWith(
        "platform-docs",
        { id: "user-mina", username: "mina" },
        "writer",
      );
    });
    expect(onInvited).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open while an invite is being granted", async () => {
    const user = userEvent.setup();
    let resolveGrant: (() => void) | undefined;
    grantAccessMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveGrant = resolve;
        }),
    );
    const onOpenChange = vi.fn();

    render(
      <InviteMemberDialog
        open
        onOpenChange={onOpenChange}
        vault="platform-docs"
        existingUserIds={new Set()}
        onInvited={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Select role for dana" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Reader" }));
    await user.click(within(dialog).getByRole("button", { name: "Invite" }));
    expect(within(dialog).getByRole("button", { name: "Invite" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Select role for mina" })).toBeDisabled();
    expect(within(dialog).getByRole("searchbox")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Clear selected account" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    resolveGrant?.();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("switches the selected account without carrying the previous role to another row", async () => {
    const user = userEvent.setup();
    render(<InviteMemberDialog open onOpenChange={vi.fn()} vault="platform-docs" existingUserIds={new Set()} onInvited={vi.fn()} />);
    const mina = await screen.findByRole("button", { name: "Select role for mina" });
    await user.click(mina);
    await user.click(screen.getByRole("menuitemradio", { name: "Admin" }));
    const dana = screen.getByRole("button", { name: "Select role for dana" });
    expect(dana).toHaveTextContent("Select role");
    await user.click(dana);
    await user.click(screen.getByRole("menuitemradio", { name: "Writer" }));
    expect(mina).toHaveTextContent("Select role");
    expect(screen.getByTestId("invite-summary")).toHaveTextContent("Dana Lee will join as Writer.");
    await user.click(screen.getByRole("button", { name: "Clear selected account" }));
    expect(dana).toHaveTextContent("Select role");
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
  });

  it("retains the chosen account and role when granting fails", async () => {
    grantAccessMock.mockRejectedValueOnce(new Error("You cannot grant this role."));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<InviteMemberDialog open onOpenChange={onOpenChange} vault="platform-docs" existingUserIds={new Set()} onInvited={vi.fn()} />);
    const mina = await screen.findByRole("button", { name: "Select role for mina" });
    await user.click(mina);
    await user.click(screen.getByRole("menuitemradio", { name: "Writer" }));
    await user.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot grant this role.");
    expect(mina).toHaveTextContent("Writer");
    expect(onOpenChange).not.toHaveBeenCalled();
    grantAccessMock.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("distinguishes search failure from an empty directory and retries locally", async () => {
    searchUsersMock.mockRejectedValueOnce(new Error("Directory unavailable"));
    const user = userEvent.setup();
    render(<InviteMemberDialog open onOpenChange={vi.fn()} vault="platform-docs" existingUserIds={new Set()} onInvited={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Directory unavailable");
    expect(screen.queryByText("No accounts available")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Select role for mina" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Escape closes the role menu first and restores focus within the invite dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<InviteMemberDialog open onOpenChange={onOpenChange} vault="platform-docs" existingUserIds={new Set()} onInvited={vi.fn()} />);
    const picker = await screen.findByRole("button", { name: "Select role for mina" });
    await user.click(picker);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(picker).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Invite member" })).toBeInTheDocument();
  });
});
