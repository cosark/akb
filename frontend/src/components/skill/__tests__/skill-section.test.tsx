import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SkillSection } from "../skill-section";
import { ResourceNavigationProvider, useResourceNavigation } from "@/contexts/resource-navigation-context";
import { CurrentUserProvider } from "@/contexts/current-user-context";
import { VAULT_SKILL_PATH } from "@/lib/skill";

const getSkillTemplate = vi.fn();
const getVaultSkillPreview = vi.fn();
const updateDocument = vi.fn();

vi.mock("@/lib/api", async original => ({
  ...await original<typeof import("@/lib/api")>(),
  getSkillTemplate: (...a: any[]) => getSkillTemplate(...a),
  getVaultSkillPreview: (...a: any[]) => getVaultSkillPreview(...a),
  updateDocument: (...a: any[]) => updateDocument(...a),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const DOC = {
  content: "# my-v Guide\n\nStored body",
  updated_at: "2026-05-18T10:00:00Z",
  current_commit: "abc123def456", // pragma: allowlist secret — synthetic Git commit
};

beforeEach(() => {
  vi.clearAllMocks();
  getVaultSkillPreview.mockResolvedValue("composed agent text");
});

describe("SkillSection", () => {
  it.each(["success", "failure"])("accepts the same-account save %s across access proof revisions", async result => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const account = { user_id: "a", username: "a", email: "a@x.test", display_name: null, is_admin: false, auth_method: "local", key_class: null };
    const view = (checking = false, revision = 0) => <QueryClientProvider client={qc}><MemoryRouter><CurrentUserProvider user={account} checking={checking} revision={revision}><SkillSection vault="my-v" doc={DOC} canManage={!checking} /></CurrentUserProvider></MemoryRouter></QueryClientProvider>;
    let finish!: (saved: { current_commit: string }) => void;
    let fail!: (error: Error) => void;
    updateDocument.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const { rerender } = render(view());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await user.type(screen.getByLabelText("Vault guide body"), " local draft");
    await user.click(screen.getByRole("button", { name: /save guide/i }));
    rerender(view(true));
    await act(async () => result === "success" ? finish({ current_commit: "saved" }) : fail(new Error("Guide save unavailable")));
    rerender(view(false, 1));
    if (result === "success") {
      expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("data-state", "active");
      expect(qc.getQueryData(["document", "my-v", VAULT_SKILL_PATH])).toMatchObject({ current_commit: "saved", content: `${DOC.content} local draft` });
    } else {
      expect(await screen.findByText("Guide save unavailable")).toBeVisible();
      expect(screen.getByLabelText("Vault guide body")).toHaveValue(`${DOC.content} local draft`);
      expect(screen.getByRole("button", { name: /save guide/i })).toBeEnabled();
    }
  });

  it("keeps dirty content and its revision pin across Preview and Agent view", async () => {
    const user = userEvent.setup();
    updateDocument.mockResolvedValue({ current_commit: "saved-revision" });
    const rendered = render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await user.type(screen.getByLabelText("Vault guide body"), " local draft");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    rendered.rerender(wrap(<SkillSection vault="my-v" doc={{ ...DOC, content: "New remote guide", current_commit: "new-remote-revision" }} canManage />));
    await user.click(screen.getByRole("tab", { name: "Agent view" }));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByLabelText("Vault guide body")).toHaveValue(`${DOC.content} local draft`);
    expect(screen.getByText("Guide changed elsewhere")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save guide" }));
    expect(updateDocument).toHaveBeenCalledWith("my-v", "overview/vault-skill.md", {
      content: `${DOC.content} local draft`, expected_commit: DOC.current_commit,
    });
  });

  it("asks before Cancel discards a dirty draft and lets the user keep editing", async () => {
    const user = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await user.type(screen.getByLabelText("Vault guide body"), " local draft");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog", { name: "Discard unsaved guide changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Vault guide body")).toHaveValue(`${DOC.content} local draft`);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByLabelText("Vault guide body")).toHaveValue(DOC.content);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("guards participating workspace navigation even from a read tab", async () => {
    const user = userEvent.setup();
    function DestinationLink() {
      const { requestNavigation } = useResourceNavigation();
      return <Link to="/elsewhere" onClick={(event) => { if (!requestNavigation("/elsewhere")) event.preventDefault(); }}>Leave guide</Link>;
    }
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><MemoryRouter><ResourceNavigationProvider>
      <DestinationLink />
      <Routes><Route path="/" element={<SkillSection vault="my-v" doc={DOC} canManage />} /><Route path="/elsewhere" element={<h1>Other workspace</h1>} /></Routes>
    </ResourceNavigationProvider></MemoryRouter></QueryClientProvider>);
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await user.type(screen.getByLabelText("Vault guide body"), " draft");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("link", { name: "Leave guide" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("heading", { name: "Other workspace" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "Leave guide" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { name: "Other workspace" })).toBeVisible();
  });

  it("keeps a saving buffer across tab switches and disables Cancel", async () => {
    let finishSave!: (saved: { current_commit: string }) => void;
    updateDocument.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const user = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await user.type(screen.getByLabelText("Vault guide body"), " draft");
    await user.click(screen.getByRole("button", { name: "Save guide" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByLabelText("Vault guide body")).toHaveValue(`${DOC.content} draft`);
    finishSave({ current_commit: "saved-revision" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Preview", selected: true })).toBeVisible());
  });

  it("shows a recoverable load error without calling the guide missing", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" error="503 Service unavailable" onRetry={retry} canManage />));
    expect(screen.getByText("Couldn't load the vault guide")).toBeVisible();
    expect(screen.queryByText(/restored automatically/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("renders the editor surface for a normal vault with a guide", async () => {
    const u = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));

    // Anchor for the #skill redirect target.
    expect(document.getElementById("skill")).toBeTruthy();
    const sectionHeader = screen
      .getByRole("heading", { name: "Vault guide" })
      .closest('[data-slot="workspace-section-header"]');
    expect(sectionHeader).toHaveClass("border-border", "pb-3");
    expect(sectionHeader).not.toHaveClass("bg-surface-2/55");
    expect(sectionHeader?.nextElementSibling).toHaveClass(
      "border-border-strong",
    );
    expect(screen.getByText(/Stored body/)).toBeTruthy();

    // History points at the canonical doc pinned to its commit — the one URL
    // the viewer does NOT bounce back to settings.
    const history = screen.getByRole("link", { name: /history/i });
    expect(history.getAttribute("href")).toBe(
      "/vault/my-v/doc/overview%2Fvault-skill.md?commit=abc123def456",
    );

    // Edit tab seeds from the doc body.
    await u.click(screen.getByRole("tab", { name: /^edit$/i }));
    expect(
      (screen.getByLabelText(/vault guide body/i) as HTMLTextAreaElement).value,
    ).toBe(DOC.content);
  });

  it("saves the edited body with an optimistic-concurrency pin", async () => {
    updateDocument.mockResolvedValue({ ok: true });
    const u = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));

    await u.click(screen.getByRole("tab", { name: /^edit$/i }));
    await u.type(screen.getByLabelText(/vault guide body/i), " more");
    await u.click(screen.getByRole("button", { name: /save guide/i }));

    await waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith(
        "my-v",
        "overview/vault-skill.md",
        {
          content: `${DOC.content} more`,
          expected_commit: DOC.current_commit,
        },
      ),
    );
  });

  it("keeps the draft when a concurrent update rejects the commit pin", async () => {
    updateDocument.mockRejectedValue(
      new Error("current_commit moved: expected abc123, actual def456"),
    );
    const u = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));

    await u.click(screen.getByRole("tab", { name: /^edit$/i }));
    const editor = screen.getByLabelText(
      /vault guide body/i,
    ) as HTMLTextAreaElement;
    await u.type(editor, " local draft");
    await u.click(screen.getByRole("button", { name: /save guide/i }));

    expect(await screen.findByText(/guide changed elsewhere/i)).toBeTruthy();
    expect(screen.getByText(/your draft is still here/i)).toBeTruthy();
    expect(screen.queryByText(/current_commit moved/i)).toBeNull();
    expect(screen.queryByText(/abc123|def456/i)).toBeNull();
    expect(editor.value).toBe(`${DOC.content} local draft`);
    expect(
      screen.getByRole("tab", { name: /^edit$/i }).getAttribute("data-state"),
    ).toBe("active");
  });

  it("Reset opens the ConfirmDialog and writes the substituted template", async () => {
    getSkillTemplate.mockResolvedValue("# {vault} Vault Skill\n\nBody");
    updateDocument.mockResolvedValue({ ok: true });
    const u = userEvent.setup();
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage />));

    await u.click(screen.getByRole("button", { name: /reset to template/i }));
    expect(await screen.findByText(/replace current content/i)).toBeTruthy();
    await u.click(screen.getByRole("button", { name: /^reset$/i }));

    await waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith(
        "my-v",
        "overview/vault-skill.md",
        {
          content: "# my-v Vault Skill\n\nBody",
          expected_commit: DOC.current_commit,
        },
      ),
    );
  });

  it("hides Edit and Reset for a reader but keeps the read surfaces", () => {
    render(wrap(<SkillSection vault="my-v" doc={DOC} canManage={false} />));

    expect(screen.queryByRole("tab", { name: /^edit$/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset to template/i }),
    ).toBeNull();
    // Preview, Agent view and History are reads — a reader keeps them.
    expect(screen.getByText(/Stored body/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /agent view/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /history/i })).toBeTruthy();
  });

  it("renders the mirror note instead of the editor for an external-git vault", () => {
    render(
      wrap(<SkillSection vault="mirror-v" doc={null} isMirror canManage />),
    );
    expect(
      screen.getByText(/mirror vaults don't carry a vault guide/i),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /^edit$/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset to template/i }),
    ).toBeNull();
  });

  it("renders the backfill note (and no create button) when the guide is missing", () => {
    render(wrap(<SkillSection vault="my-v" doc={null} canManage />));
    expect(
      screen.getByText(/restored automatically by the system backfill/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^edit$/i })).toBeNull();
  });
});
