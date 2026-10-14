import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SettingsDialogProvider, useSettingsDialog } from "@/contexts/settings-dialog-context";

type ReadyProps = { onClose: () => void; onRestoreFocus: () => void };
const lazyModule = vi.hoisted(() => {
  let finish!: (module: { default: (props: ReadyProps) => React.ReactNode }) => void;
  const pending = new Promise<{ default: (props: ReadyProps) => React.ReactNode }>(resolve => { finish = resolve; });
  return { pending, finish };
});
vi.mock("@/pages/settings/settings-dialog", () => lazyModule.pending);
afterEach(cleanup);

function Launcher() {
  const settings = useSettingsDialog();
  return <button onClick={event => settings?.openSettings("profile", event.currentTarget)}>Open settings</button>;
}
function Ready({ onClose, onRestoreFocus }: ReadyProps) {
  const input = useRef<HTMLInputElement>(null);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <DialogTitle>Settings</DialogTitle><DialogDescription>Loaded settings</DialogDescription>
      <input ref={input} aria-label="Ready field" />
    </DialogContent>
  </Dialog>;
}

it("hands focus from loading to ready settings without revisiting the launcher", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><SettingsDialogProvider identity="account-a"><Launcher /></SettingsDialogProvider></MemoryRouter>);
  const launcher = screen.getByRole("button", { name: "Open settings" });
  await user.click(launcher);
  expect(await screen.findByText("Loading settings")).toBeVisible();
  const restore = vi.spyOn(launcher, "focus");
  await act(async () => { lazyModule.finish({ default: Ready }); });
  await waitFor(() => expect(screen.getByLabelText("Ready field")).toHaveFocus());
  // Flush the fallback FocusScope's delayed unmount callback.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(restore).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(launcher).toHaveFocus());
});
