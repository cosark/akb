import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSection } from "../settings/profile-section";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  authSessionSnapshot: vi.fn(() => ({ generation: 1, token: "owned-session", mode: "local", csrfToken: null })),
  isCurrentAuthSession: vi.fn(() => true),
  beginAccountLifecycle: vi.fn(() => vi.fn()),
  clearCompletedAccountSession: vi.fn(() => false),
  changePassword: vi.fn(), updateProfile: vi.fn(), getMe: vi.fn(),
  uploadProfilePhoto: vi.fn(), removeProfilePhoto: vi.fn(),
}));
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ user }: { user: { avatar?: { url: string | null } } }) => <span data-testid="saved-avatar" data-photo={user.avatar?.url ?? "initials"} />,
}));

const REVISION = "27ce30a6-3d94-437b-8f68-c2a939b63f1e";
const NEW_REVISION = "c28db156-810d-4faf-a5ee-d947536c9bb8";
const AVATAR = { revision: REVISION, url: `/api/v1/auth/me/avatar?v=${REVISION}`, width: 512, height: 512 };
const NEXT_AVATAR = { ...AVATAR, revision: NEW_REVISION, url: `/api/v1/auth/me/avatar?v=${NEW_REVISION}` };
const USER = {
  user_id: "u1", username: "alice", display_name: "Alice", email: "alice@example.com", is_admin: false,
  avatar: AVATAR,
  profile_capabilities: { avatar: {
    supported: true, can_upload: true, can_remove: true, reason: null,
    max_upload_bytes: 10 * 1024 * 1024, allowed_content_types: ["image/jpeg", "image/png", "image/webp"],
  } },
};
const PHOTO = new File(["test image bytes"], "portrait.png", { type: "image/png" });

function choose(file = PHOTO) {
  fireEvent.change(screen.getByLabelText("Choose profile photo"), { target: { files: [file] } });
}
function ready() {
  const image = screen.getByRole("img", { name: "Selected profile photo preview" });
  Object.defineProperties(image, { naturalWidth: { value: 512, configurable: true }, naturalHeight: { value: 512, configurable: true } });
  fireEvent.load(image);
}
function mount(overrides: Partial<React.ComponentProps<typeof ProfileSection>> = {}) {
  return render(<ProfileSection user={USER} localPasswordEnabled localProfileEditingEnabled onUserUpdate={vi.fn()} {...overrides} />);
}

describe("Settings profile photo", () => {
  let nextUrl = 0;
  const revoke = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.isCurrentAuthSession).mockReturnValue(true);
    vi.mocked(api.uploadProfilePhoto).mockResolvedValue({ avatar: NEXT_AVATAR });
    vi.mocked(api.removeProfilePhoto).mockResolvedValue({ avatar: { revision: NEW_REVISION, url: null } });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:photo-${++nextUrl}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  });
  afterEach(cleanup);

  it("keeps legacy servers usable without exposing a nonworking upload control", () => {
    mount({ user: { ...USER, avatar: undefined, profile_capabilities: undefined } });
    expect(screen.getByText("Profile photos are not supported by this server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload photo" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeEnabled();
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it("distinguishes missing storage from a legacy server", () => {
    mount({ user: { ...USER, profile_capabilities: { avatar: { ...USER.profile_capabilities.avatar, supported: false, can_upload: false, can_remove: false, reason: "storage_not_configured" } } } });
    expect(screen.getByText(/administrator configures file storage/)).toBeInTheDocument();
  });

  it("previews without uploading, saves explicitly and leaves the name draft alone", async () => {
    const patch = vi.fn(); const dirty = vi.fn();
    mount({ onUserUpdate: patch, onDirtyChange: dirty });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Name draft" } });
    choose();
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    expect(dirty).toHaveBeenLastCalledWith(true);
    ready(); fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await screen.findByText("Photo saved");
    expect(api.uploadProfilePhoto).toHaveBeenCalledWith(PHOTO, REVISION);
    expect(patch).toHaveBeenCalledWith({ avatar: NEXT_AVATAR });
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Display name")).toHaveValue("Name draft");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(expect.stringMatching(/^blob:photo-/)));
  });

  it("allows SSO photo editing without enabling managed profile fields", async () => {
    mount({ localPasswordEnabled: false, localProfileEditingEnabled: false });
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    choose(); ready(); fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await screen.findByText("Photo saved");
  });

  it("retains a failed candidate, supports dismiss/retry and does not replace the saved photo", async () => {
    vi.mocked(api.uploadProfilePhoto).mockRejectedValueOnce(new Error("Storage is temporarily unavailable"));
    mount(); choose(); ready();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("img", { name: "Selected profile photo preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss photo error" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    await screen.findByText("Photo saved");
    expect(api.uploadProfilePhoto).toHaveBeenCalledTimes(2);
  });

  it("cancel clears only the photo draft, and a cancelled file picker is inert", () => {
    const dirty = vi.fn(); mount({ onDirtyChange: dirty });
    fireEvent.change(screen.getByLabelText("Choose profile photo"), { target: { files: [] } });
    expect(dirty).toHaveBeenLastCalledWith(false);
    choose(); ready(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("saved-avatar")).toHaveAttribute("data-photo", AVATAR.url);
    expect(screen.getByRole("button", { name: "Change photo" })).toHaveFocus();
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled();
    choose(); expect(screen.getByRole("img", { name: "Selected profile photo preview" })).toBeInTheDocument();
  });

  it("rejects unsupported, empty, oversized and undecodable candidates without a write", () => {
    mount();
    choose(new File(["svg"], "photo.svg", { type: "image/svg+xml" }));
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG or WebP");
    choose(new File([], "photo.png", { type: "image/png" }));
    expect(screen.getByRole("alert")).toHaveTextContent("non-empty");
    const large = new File(["png"], "photo.png", { type: "image/png" });
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 }); choose(large);
    expect(screen.getByRole("alert")).toHaveTextContent("10 MB");
    choose(); fireEvent.error(screen.getByRole("img", { name: "Selected profile photo preview" }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be opened");
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it("explains resolution limits separately from file size", () => {
    mount(); choose();
    const image = screen.getByRole("img", { name: "Selected profile photo preview" });
    Object.defineProperties(image, { naturalWidth: { value: 4000 }, naturalHeight: { value: 4000 } }); fireEvent.load(image);
    expect(screen.getByRole("alert")).toHaveTextContent("resolution is too high");
    expect(api.uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it("reviews removal inline and retains the tombstone revision returned by the server", async () => {
    const patch = vi.fn(); const dirty = vi.fn(); mount({ onUserUpdate: patch, onDirtyChange: dirty });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(api.removeProfilePhoto).not.toHaveBeenCalled();
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(screen.getByRole("group", { name: "Remove profile photo?" })).getByRole("button", { name: "Remove photo" }));
    await screen.findByText("Photo removed");
    expect(patch).toHaveBeenCalledWith({ avatar: { revision: NEW_REVISION, url: null } });
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps the saved photo and offers retry/cancel after a failed removal", async () => {
    vi.mocked(api.removeProfilePhoto).mockRejectedValueOnce(new Error("Try again later"));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Remove profile photo?" })).getByRole("button", { name: "Remove photo" }));
    await screen.findByText("Try again later");
    expect(screen.getByTestId("saved-avatar")).toHaveAttribute("data-photo", AVATAR.url);
    fireEvent.click(screen.getByRole("button", { name: "Keep photo" }));
    expect(screen.queryByRole("group", { name: "Remove profile photo?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change photo" })).toHaveFocus();
  });

  it("blocks repeated requests and other saves while a photo is pending", async () => {
    let settle!: (result: { avatar: typeof NEXT_AVATAR }) => void;
    vi.mocked(api.uploadProfilePhoto).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    const busy = vi.fn(); mount({ onBusyChange: busy }); choose(); ready();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    expect(busy).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    expect(api.uploadProfilePhoto).toHaveBeenCalledOnce();
    await act(async () => settle({ avatar: NEXT_AVATAR }));
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it("accepts an operation receipt while proof hides the view, without releasing the guard early", async () => {
    let settle!: (result: { avatar: typeof NEXT_AVATAR }) => void;
    vi.mocked(api.uploadProfilePhoto).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    const busy = vi.fn(); const patch = vi.fn();
    const view = (visible: boolean) => <ProfileSection user={USER} visible={visible} localPasswordEnabled localProfileEditingEnabled onUserUpdate={patch} onBusyChange={busy} />;
    const { rerender } = render(view(true)); choose(); ready();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" })); rerender(view(false));
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => settle({ avatar: NEXT_AVATAR }));
    expect(patch).toHaveBeenCalledWith({ avatar: NEXT_AVATAR });
    expect(busy).toHaveBeenLastCalledWith(false);
    rerender(view(true)); await screen.findByText("Photo saved");
  });

  it("ignores a late receipt after session replacement", async () => {
    let settle!: (result: { avatar: typeof NEXT_AVATAR }) => void;
    vi.mocked(api.uploadProfilePhoto).mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    const patch = vi.fn(); mount({ onUserUpdate: patch }); choose(); ready();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
    vi.mocked(api.isCurrentAuthSession).mockReturnValue(false);
    await act(async () => settle({ avatar: NEXT_AVATAR }));
    expect(patch).not.toHaveBeenCalled(); expect(screen.queryByText("Photo saved")).not.toBeInTheDocument();
  });

  it("requires an explicit reload and new selection after a revision conflict", async () => {
    vi.mocked(api.uploadProfilePhoto).mockRejectedValueOnce(Object.assign(new Error("Your photo changed elsewhere"), { detail: { code: "avatar_changed" } }));
    vi.mocked(api.getMe).mockResolvedValue({ ...USER, avatar: NEXT_AVATAR, auth_method: "jwt", key_class: null });
    const patch = vi.fn(); mount({ onUserUpdate: patch }); choose(); ready();
    fireEvent.click(screen.getByRole("button", { name: "Save photo" })); await screen.findByText("Your photo changed elsewhere");
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss photo error" }));
    expect(screen.getByRole("button", { name: "Reload photo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    vi.mocked(api.getMe).mockRejectedValueOnce(new Error("Account lookup unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Reload photo" }));
    await screen.findByText("Account lookup unavailable");
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload photo" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ avatar: NEXT_AVATAR, profile_capabilities: USER.profile_capabilities }));
    expect(screen.queryByRole("button", { name: "Save photo" })).not.toBeInTheDocument();
    expect(api.uploadProfilePhoto).toHaveBeenCalledOnce();
  });
});
