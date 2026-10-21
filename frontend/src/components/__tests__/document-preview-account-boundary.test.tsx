import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CurrentUserProvider, useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";
import { DocumentPreviewDialog } from "@/components/document-preview-dialog";
import { getMe } from "@/lib/api";

vi.mock("@/lib/api", () => ({ getMe: vi.fn() }));
vi.mock("@/pages/document", () => ({ default: function Probe() {
  const user = useCurrentUser();
  const { checking, revision } = useAccessVerification();
  return <output aria-label="Preview scope">{checking ? "Checking access" : `${user?.user_id}:${revision}`}</output>;
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const user = (id: string) => ({ user_id: id, username: id, email: `${id}@x.test`, display_name: null, is_admin: false, auth_method: "local", key_class: null });

it("propagates the shell's checking/revision and uses its proven identity without another stale read", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string, checking: boolean, revision: number) => <QueryClientProvider client={client}><MemoryRouter><CurrentUserProvider user={user(id)} checking={checking} revision={revision}><DocumentPreviewDialog /></CurrentUserProvider></MemoryRouter></QueryClientProvider>;
  const { rerender } = render(view("a", false, 0));
  expect(screen.getByLabelText("Preview scope")).toHaveTextContent("a:0");
  rerender(view("a", true, 0));
  expect(screen.getByLabelText("Preview scope")).toHaveTextContent("Checking access");
  rerender(view("a", false, 1));
  expect(screen.getByLabelText("Preview scope")).toHaveTextContent("a:1");
  rerender(view("b", false, 2));
  expect(screen.getByLabelText("Preview scope")).toHaveTextContent("b:2");
  expect(getMe).not.toHaveBeenCalled();
});
it("never lets a standalone fallback response overwrite a newer shell identity", async () => {
  let resolve!: (value: ReturnType<typeof user>) => void;
  vi.mocked(getMe).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (identity: ReturnType<typeof user> | null) => <QueryClientProvider client={client}><MemoryRouter><CurrentUserProvider user={identity}><DocumentPreviewDialog /></CurrentUserProvider></MemoryRouter></QueryClientProvider>;
  const { rerender } = render(view(null));
  rerender(view(user("b")));
  await act(async () => resolve(user("a")));
  expect(screen.getByLabelText("Preview scope")).toHaveTextContent("b:0");
});
