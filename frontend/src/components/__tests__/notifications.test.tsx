import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CurrentUserProvider } from "@/contexts/current-user-context";
import { NotificationBell } from "@/components/notification-bell";
import NotificationsPage from "@/pages/notifications";
import { DocumentWatch } from "@/components/document-watch";
import * as api from "@/lib/api-notifications";
import { registerModal } from "@/lib/modal-visibility";

vi.mock("@/lib/api-notifications", async original => ({
  ...await original<typeof import("@/lib/api-notifications")>(),
  notificationCount: vi.fn(), notificationPage: vi.fn(), markNotification: vi.fn(),
  markNotificationSnapshot: vi.fn(), documentSubscription: vi.fn(),
}));
const user = { user_id: "user-a", username: "reader", email: "reader@example.invalid", display_name: "Reader", is_admin: false, auth_method: "local", key_class: null };
const item: api.NotificationItem = { id: "n1", kind: "document.update", title: "Release notes updated", message: "A watched document changed.", created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z", read: false, version: "v1", target: { uri: "akb://demo/doc/notes.md", vault: "demo" } };
const page: api.NotificationPage = { supported: true, items: [item], next_cursor: null, unread_count: 1, snapshot: "snapshot-before-arrival", retention_days: 90 };
function mount(children: React.ReactNode, initialEntry = "/", revision = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CurrentUserProvider user={user} revision={revision}><MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter></CurrentUserProvider></QueryClientProvider>);
}
function Destination() { const location = useLocation(); return <output data-testid="notification-destination">{location.pathname}</output>; }
function InboxRoutes() {
  return <><NotificationBell /><Routes>
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/vault/:name" element={<Destination />} />
    <Route path="/vault/:name/doc/:id" element={<Destination />} />
  </Routes></>;
}
beforeEach(() => {
  vi.mocked(api.notificationCount).mockResolvedValue(page);
  vi.mocked(api.notificationPage).mockResolvedValue(page);
  vi.mocked(api.markNotification).mockResolvedValue({});
  vi.mocked(api.markNotificationSnapshot).mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("personal notifications", () => {
  it("combines category tabs and unread filtering in server requests", async () => {
    vi.mocked(api.notificationPage).mockImplementation(async (state, _cursor, _signal, category) => ({
      ...page, category, items: category === "access" ? [] : [{ ...item, title: state === "unread" ? "Unread document" : item.title }],
    }));
    const actor = userEvent.setup(); mount(<NotificationsPage />);
    await screen.findByText(item.title);
    await actor.click(screen.getByRole("tab", { name: "Documents" }));
    await waitFor(() => expect(api.notificationPage).toHaveBeenCalledWith("all", undefined, expect.any(AbortSignal), "documents"));
    await actor.click(screen.getByRole("checkbox", { name: "Unread only" }));
    await screen.findByText("Unread document");
    expect(api.notificationPage).toHaveBeenCalledWith("unread", undefined, expect.any(AbortSignal), "documents");
    await actor.click(screen.getByRole("tab", { name: "Access" }));
    await screen.findByText("You’re all caught up");
    expect(screen.queryByText("Unread document")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Unread only" })).toBeChecked();
    await actor.click(screen.getByRole("button", { name: "Include read notifications" }));
    await screen.findByText("No invites or access updates yet");
    expect(api.notificationPage).toHaveBeenCalledWith("all", undefined, expect.any(AbortSignal), "access");
  });
  it("preserves the category in compact pagination and full-inbox navigation", async () => {
    vi.mocked(api.notificationPage).mockImplementation(async (_state, cursor, _signal, category) => ({
      ...page, category, next_cursor: cursor ? null : "older", items: [{ ...item, id: cursor ? "n2" : "n1", title: cursor ? "Older document" : item.title }],
    }));
    const actor = userEvent.setup(); mount(<NotificationBell />);
    await actor.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await actor.click(screen.getByRole("tab", { name: "Documents" }));
    await actor.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Older document");
    expect(api.notificationPage).toHaveBeenCalledWith("all", "older", expect.any(AbortSignal), "documents");
    expect(screen.getByRole("link", { name: "View all notifications" })).toHaveAttribute("href", "/notifications?category=documents&state=all");
    await actor.click(screen.getByRole("button", { name: "Notification actions" }));
    expect(screen.getByRole("menuitem", { name: "Mark all notifications read" })).toBeVisible();
  });
  it("offers recovery instead of an empty category on older servers", async () => {
    vi.mocked(api.notificationPage).mockImplementation(async (_state, _cursor, _signal, category) => {
      if (category !== "all") throw new api.NotificationCategoriesUnavailable("Category filters are not available on this server yet.");
      return page;
    });
    const actor = userEvent.setup(); mount(<NotificationsPage />);
    await screen.findByText(item.title);
    await actor.click(screen.getByRole("tab", { name: "Documents" }));
    await screen.findByText("Category filters are not available on this server yet.");
    expect(screen.queryByText("No document updates yet")).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Show all categories" }));
    await screen.findByText(item.title);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });
  it("uses short change labels and keeps read actions separate from the destination", async () => {
    const actor = userEvent.setup();
    mount(<NotificationsPage />);
    const destination = await screen.findByRole("link", { name: item.title });
    expect(screen.getByText("Updated")).toBeVisible();
    expect(screen.queryByText(item.message)).not.toBeInTheDocument();
    expect(destination).toHaveAccessibleDescription("Unread. Updated · demo. View document");
    const mark = screen.getByRole("button", { name: "Mark read" });
    expect(destination).not.toContainElement(mark);
    await actor.click(mark);
    expect(api.markNotification).toHaveBeenCalledWith(item, true);
  });
  it("does not repeat a Vault name for an access notice", async () => {
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, kind: "access.changed", title: "demo", message: "Your vault access changed", target: { uri: "akb://demo", vault: "demo" } }] });
    mount(<NotificationsPage />);
    await screen.findByText("Access changed");
    expect(screen.getAllByText("demo")).toHaveLength(1);
  });
  it.each(["document", "vault"])("F26: opens a valid %s even when marking read fails", async kind => {
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, target: { uri: kind === "vault" ? "akb://demo" : item.target!.uri, vault: "demo" } }] });
    let fail!: (error: Error) => void;
    vi.mocked(api.markNotification).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const actor = userEvent.setup(); mount(<InboxRoutes />, "/notifications", 2);
    await actor.click(await screen.findByRole("link", { name: item.title }));
    expect(screen.getByTestId("notification-destination")).toHaveTextContent(kind === "vault" ? "/vault/demo" : "/vault/demo/doc/notes.md");
    expect(screen.queryByRole("heading", { name: "Notifications" })).not.toBeInTheDocument();
    // Failure arrives after the route really unmounted its Inbox.
    await act(async () => fail(new Error("Read state unavailable")));
    expect(await screen.findByRole("button", { name: "Retry marking read" })).toBeVisible();
    expect(api.markNotification).toHaveBeenCalledTimes(1);
    await actor.click(screen.getByRole("button", { name: "Retry marking read" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument());
    expect(api.markNotification).toHaveBeenCalledTimes(2);
  });
  it.each(["initial", "retry"])("F26: %s 409 requires review, never replaying an unseen newer version", async phase => {
    const original = { ...item, kind: "access.changed", target: { uri: "akb://demo", vault: "demo" } };
    const current = { ...original, version: "v2", title: "Your access was removed", target: null };
    vi.mocked(api.notificationPage).mockResolvedValueOnce({ ...page, items: [original] }).mockResolvedValue({ ...page, items: [current] });
    if (phase === "retry") vi.mocked(api.markNotification).mockRejectedValueOnce(new Error("503"));
    vi.mocked(api.markNotification).mockRejectedValueOnce(new api.NotificationConflict("Changed")).mockResolvedValue({});
    const actor = userEvent.setup(); mount(<InboxRoutes />, "/notifications");
    await actor.click(await screen.findByRole("link", { name: original.title }));
    await screen.findByTestId("notification-destination");
    if (phase === "retry") await actor.click(await screen.findByRole("button", { name: "Retry marking read" }));
    const review = await screen.findByRole("button", { name: "Review current notification" });
    expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument();
    const attempts = phase === "retry" ? 2 : 1;
    expect(api.markNotification).toHaveBeenCalledTimes(attempts);
    expect(vi.mocked(api.markNotification).mock.calls.every(([notification]) => notification.version === "v1")).toBe(true);
    await actor.click(review);
    await screen.findByText(current.title);
    expect(screen.queryByRole("link", { name: current.title })).not.toBeInTheDocument();
    expect(api.markNotification).toHaveBeenCalledTimes(attempts);
    // Reading the new notice and its separate explicit action owns v2.
    await actor.click(screen.getByRole("button", { name: "Mark read" }));
    expect(api.markNotification).toHaveBeenLastCalledWith(current, true);
    expect(api.markNotification).toHaveBeenCalledTimes(attempts + 1);
  });
  it("F26: a failed review refresh retains review-only recovery, not stale version Retry", async () => {
    const original = { ...item, target: { uri: "akb://demo", vault: "demo" } };
    vi.mocked(api.notificationPage).mockResolvedValueOnce({ ...page, items: [original] }).mockRejectedValue(new Error("Offline"));
    vi.mocked(api.markNotification).mockRejectedValue(new api.NotificationConflict("Changed"));
    const actor = userEvent.setup(); mount(<InboxRoutes />, "/notifications");
    await actor.click(await screen.findByRole("link", { name: item.title }));
    await actor.click(await screen.findByRole("button", { name: "Review current notification" }));
    expect(await screen.findByText(/Could not refresh the current notification/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review current notification" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument();
    expect(api.markNotification).toHaveBeenCalledTimes(1);
  });
  it("F26: reports a conflict immediately even if count revalidation is still pending", async () => {
    let finishCount!: (value: api.NotificationSummary) => void;
    vi.mocked(api.notificationCount).mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise(resolve => { finishCount = resolve; }));
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, target: { uri: "akb://demo", vault: "demo" } }] });
    vi.mocked(api.markNotification).mockRejectedValue(new api.NotificationConflict("Changed"));
    const actor = userEvent.setup(); mount(<InboxRoutes />, "/notifications");
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await actor.click(await screen.findByRole("link", { name: item.title }));
    expect(await screen.findByRole("button", { name: "Review current notification" })).toBeVisible();
    await waitFor(() => expect(api.notificationCount).toHaveBeenCalledTimes(2));
    await act(async () => finishCount(page));
  });
  it("F26: ignores a former account's late read failure after route navigation", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(api.markNotification).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (userId: string) => <QueryClientProvider client={client}><CurrentUserProvider user={{ ...user, user_id: userId }}><MemoryRouter initialEntries={["/notifications"]}><InboxRoutes /></MemoryRouter></CurrentUserProvider></QueryClientProvider>;
    const view = render(tree("user-a")); const actor = userEvent.setup();
    await actor.click(await screen.findByRole("link", { name: item.title }));
    await screen.findByTestId("notification-destination");
    view.rerender(tree("user-b"));
    await act(async () => fail(new Error("503")));
    expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review current notification" })).not.toBeInTheDocument();
  });
  it("F26: a late review response cannot reopen the Bell after access ownership changes", async () => {
    let finish!: (value: api.NotificationPage) => void;
    vi.mocked(api.notificationPage).mockResolvedValueOnce({ ...page, items: [{ ...item, target: { uri: "akb://demo", vault: "demo" } }] })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(page);
    vi.mocked(api.markNotification).mockRejectedValue(new api.NotificationConflict("Changed"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (revision: number) => <QueryClientProvider client={client}><CurrentUserProvider user={user} revision={revision}><MemoryRouter initialEntries={["/notifications"]}><InboxRoutes /></MemoryRouter></CurrentUserProvider></QueryClientProvider>;
    const view = render(tree(0)); const actor = userEvent.setup();
    await actor.click(await screen.findByRole("link", { name: item.title }));
    await actor.click(await screen.findByRole("button", { name: "Review current notification" }));
    await waitFor(() => expect(api.notificationPage).toHaveBeenCalledTimes(2));
    view.rerender(tree(1));
    await act(async () => finish({ ...page, items: [{ ...item, title: "Old proof response", version: "v2" }] }));
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Old proof response")).not.toBeInTheDocument();
    expect(api.markNotification).toHaveBeenCalledTimes(1);
  });
  it("F26: keeps compact navigation failure feedback and offers a separate read retry", async () => {
    vi.mocked(api.markNotification).mockRejectedValueOnce(new Error("Read state unavailable")).mockResolvedValueOnce({});
    const actor = userEvent.setup(); mount(<><NotificationBell /><Destination /></>);
    await actor.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await actor.click(await screen.findByRole("link", { name: item.title }));
    await waitFor(() => expect(screen.getByTestId("notification-destination")).toHaveTextContent("/vault/demo/doc/notes.md"));
    await actor.click(await screen.findByRole("button", { name: "Retry marking read" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument());
    expect(api.markNotification).toHaveBeenCalledTimes(2);
  });
  it("F26: collapses repeated activation while read acknowledgement is pending", async () => {
    let finish!: (value: object) => void;
    vi.mocked(api.markNotification).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const actor = userEvent.setup(); mount(<><NotificationsPage /><Destination /></>);
    const link = await screen.findByRole("link", { name: item.title });
    await actor.click(link); await actor.click(link);
    expect(api.markNotification).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("notification-destination")).toHaveTextContent("/vault/demo/doc/notes.md");
    await act(async () => finish({}));
  });
  it("F26: defers the nonmodal retry until the destination reader is closed", async () => {
    vi.mocked(api.markNotification).mockRejectedValue(new Error("Read state unavailable"));
    const actor = userEvent.setup(); mount(<><NotificationBell /><Destination /></>);
    await actor.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await actor.click(await screen.findByRole("link", { name: item.title }));
    await screen.findByRole("button", { name: "Retry marking read" });
    let close!: () => void;
    act(() => { close = registerModal(); });
    expect(screen.queryByRole("button", { name: "Retry marking read" })).not.toBeInTheDocument();
    act(() => close());
    expect(await screen.findByRole("button", { name: "Retry marking read" })).toBeVisible();
  });
  it("F26: notice-only events have no destination and modified clicks retain native links", async () => {
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, id: "notice", title: "Access removed", target: null }, item] });
    mount(<NotificationsPage />);
    await screen.findByText("Access removed");
    expect(screen.queryByRole("link", { name: "Access removed" })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: item.title });
    expect(link).toHaveAttribute("href", "/vault/demo/doc/notes.md");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(api.markNotification).not.toHaveBeenCalled();
  });
  it("retains explanatory text for event kinds from a newer backend", async () => {
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, kind: "future.event", message: "A new kind of update" }] });
    mount(<NotificationsPage />);
    expect(await screen.findByText("A new kind of update")).toBeVisible();
  });
  it("renders a safe notice once when its title and message match", async () => {
    vi.mocked(api.notificationPage).mockResolvedValue({ ...page, items: [{ ...item, title: "Your access was removed", message: "Your access was removed", target: null }] });
    mount(<NotificationsPage />);
    await screen.findByText("Your access was removed");
    expect(screen.getAllByText("Your access was removed")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Your access was removed" })).not.toBeInTheDocument();
    expect(screen.getByText("Notice only", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark read" })).toBeEnabled();
  });
  it("opens without marking read and sends the displayed snapshot for mark all", async () => {
    const actor = userEvent.setup(); mount(<NotificationBell />);
    await actor.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    await screen.findByText("Release notes updated");
    expect(api.markNotification).not.toHaveBeenCalled();
    expect(api.markNotificationSnapshot).not.toHaveBeenCalled();
    await actor.click(screen.getByRole("button", { name: "Notification actions" }));
    await actor.click(screen.getByRole("menuitem", { name: "Mark all notifications read" }));
    await waitFor(() => expect(api.markNotificationSnapshot).toHaveBeenCalledWith("snapshot-before-arrival"));
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toHaveFocus());
  });
  it("acknowledges only the observed version and paginates with the server cursor", async () => {
    vi.mocked(api.notificationPage).mockImplementation(async (_state, cursor) => cursor
      ? { ...page, items: [{ ...item, id: "n2", title: "Older update" }] }
      : { ...page, next_cursor: "cursor-two" });
    const actor = userEvent.setup(); mount(<NotificationsPage />);
    await actor.click(await screen.findByRole("button", { name: "Mark read" }));
    expect(api.markNotification).toHaveBeenCalledWith(item, true);
    await actor.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Older update");
    expect(api.notificationPage).toHaveBeenCalledWith("all", "cursor-two", expect.any(AbortSignal), "all");
  });
  it("distinguishes unsupported from an empty inbox and keeps unknown count honest", async () => {
    vi.mocked(api.notificationCount).mockRejectedValue(new api.NotificationsUnavailable("Notifications unavailable"));
    vi.mocked(api.notificationPage).mockRejectedValue(new api.NotificationsUnavailable("Notifications unavailable"));
    const actor = userEvent.setup(); mount(<NotificationBell />);
    await actor.click(screen.getByRole("button", { name: "Notifications, unread count unavailable" }));
    await screen.findByText("Notifications unavailable");
    expect(screen.queryByText("No notifications yet")).not.toBeInTheDocument();
  });
  it("shows mutation failure inline and leaves state unchanged", async () => {
    vi.mocked(api.markNotification).mockRejectedValue(new api.NotificationConflict("This notification changed. Review its current update before marking it read."));
    const actor = userEvent.setup(); mount(<NotificationsPage />);
    await actor.click(await screen.findByRole("button", { name: "Mark read" }));
    await screen.findByText("This notification changed. Review its current update before marking it read.");
    await waitFor(() => expect(api.notificationPage).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Mark read" })).toBeEnabled();
  });
  it("watches explicitly and keeps the URI in the subscription request", async () => {
    vi.mocked(api.documentSubscription).mockImplementation(async (_uri, method) => ({ resource_id: "doc-uuid", subscribed: method === "PUT" }));
    const actor = userEvent.setup(); mount(<DocumentWatch uri="akb://demo/doc/notes.md" />);
    const watch = await screen.findByRole("button", { name: "Watch" });
    await waitFor(() => expect(watch).toBeEnabled());
    await actor.click(watch);
    await screen.findByRole("button", { name: "Unwatch" });
    expect(api.documentSubscription).toHaveBeenCalledWith("akb://demo/doc/notes.md", "PUT");
  });
  it("cancels the former user's request and ignores its late count", async () => {
    let finishFirst!: (value: api.NotificationSummary) => void;
    let firstSignal: AbortSignal | undefined;
    vi.mocked(api.notificationCount)
      .mockImplementationOnce(signal => { firstSignal = signal; return new Promise(resolve => { finishFirst = resolve; }); })
      .mockResolvedValue({ ...page, unread_count: 2 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (userId: string) => <QueryClientProvider client={client}><CurrentUserProvider user={{ ...user, user_id: userId }}><MemoryRouter><NotificationBell /></MemoryRouter></CurrentUserProvider></QueryClientProvider>;
    const view = render(tree("user-a"));
    await waitFor(() => expect(api.notificationCount).toHaveBeenCalledTimes(1));
    view.rerender(tree("user-b"));
    await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(firstSignal?.aborted).toBe(true);
    finishFirst({ ...page, unread_count: 99 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Notifications, 99 unread" })).not.toBeInTheDocument());
  });
});
