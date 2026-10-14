import { useEffect, useRef, useState } from "react";
import { Check, Copy, Key } from "lucide-react";
import { adminResetPassword, authSessionSnapshot, isCurrentAuthSession, type AuthSessionSnapshot } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  userId: string;
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  ownsOperation?: () => boolean;
  visible?: boolean;
}

export function AdminResetPasswordDialog({ userId, username, open, onOpenChange, onBusyChange, ownsOperation, visible = true }: Props) {
  const [working, setWorking] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState(false);
  const owner = useRef({ userId, open, generation: 0 });
  if (owner.current.userId !== userId || owner.current.open !== open) owner.current = { userId, open, generation: owner.current.generation + 1 };
  const receiptSession = useRef<AuthSessionSnapshot | null>(null);
  if (tempPassword && receiptSession.current && !isCurrentAuthSession(receiptSession.current)) {
    setTempPassword(null); setCopied(false); setCopyError(false); receiptSession.current = null;
  }
  useEffect(() => { onBusyChange?.(working); }, [working, onBusyChange]);
  useEffect(() => () => { if (ownsOperation?.() !== true) onBusyChange?.(false); }, [onBusyChange, ownsOperation]);
  useEffect(() => {
    const check = () => {
      if (receiptSession.current && !isCurrentAuthSession(receiptSession.current)) {
        setTempPassword(null); setCopied(false); setCopyError(false); receiptSession.current = null;
      }
    };
    window.addEventListener("storage", check); window.addEventListener("focus", check);
    return () => { window.removeEventListener("storage", check); window.removeEventListener("focus", check); };
  }, []);

  useEffect(() => {
    if (!open) {
      setTempPassword(null);
      setCopied(false);
      setError("");
      setCopyError(false);
      setWorking(false);
    }
  }, [open, userId]);
  const resetIdentity = useRef(userId);
  useEffect(() => {
    // Activity effect restoration is not a new reset target. Keep the one-time
    // receipt until an actual target change or explicit close.
    if (resetIdentity.current === userId) return;
    resetIdentity.current = userId;
    setTempPassword(null); setCopied(false); setCopyError(false); setError(""); setWorking(false); receiptSession.current = null;
  }, [userId]);

  async function handleGenerate() {
    if (!visible || !open || working || ownsOperation?.() === false) return;
    const generation = owner.current.generation;
    const snapshot = authSessionSnapshot();
    setError("");
    setWorking(true);
    try {
      const r = await adminResetPassword(userId);
      if (ownsOperation?.() === false || owner.current.generation !== generation || !owner.current.open || !isCurrentAuthSession(snapshot)) return;
      receiptSession.current = snapshot;
      setTempPassword(r.temporary_password);
    } catch (e: any) {
      if (ownsOperation?.() !== false && owner.current.generation === generation && isCurrentAuthSession(snapshot)) setError(e?.message || "Failed to reset password");
    } finally {
      if (owner.current.generation === generation) setWorking(false);
    }
  }

  async function handleCopy() {
    if (!tempPassword) return;
    setCopied(false); setCopyError(false);
    try {
      // clipboard is undefined on insecure (plain-HTTP) origins — guard with
      // an explicit capability check keeps success feedback truthful.
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Dialog open={open && visible} onOpenChange={(o) => !working && onOpenChange(o)}>
      <DialogContent onCloseAutoFocus={event => { if (owner.current.open) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" aria-hidden /> Reset password
          </DialogTitle>
          <DialogDescription>
            Generate a temporary password for <strong>{username}</strong>.
          </DialogDescription>
        </DialogHeader>

        {tempPassword === null ? (
          <div className="space-y-3 text-sm">
            <p>
              The user's current password will be replaced immediately. They
              will be able to log in with the generated password and then change
              it from Settings.
            </p>
            {error && <Alert variant="destructive">{error}</Alert>}
          </div>
        ) : (
          <div className="space-y-3" role="status" aria-live="polite">
            <Alert variant="warning">
              Share this with the user out-of-band (Slack, in person, etc.).
              It cannot be retrieved again.
            </Alert>
            <div className="relative">
              <pre
                data-testid="temp-password"
                tabIndex={0}
                aria-label="Temporary password — select and copy manually"
                className="font-mono text-base bg-surface-muted border border-border p-3 select-all break-all"
              >
                {tempPassword}
              </pre>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "Temporary password copied" : "Copy temporary password"}
                className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-foreground-muted hover:text-primary border border-border bg-surface rounded-[var(--radius-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {copied ? <><Check className="h-3 w-3" aria-hidden /> COPIED</> : <><Copy className="h-3 w-3" aria-hidden /> COPY</>}
              </button>
            </div>
            {copyError && <p role="status" className="text-sm text-foreground-muted">Copy was blocked. Select the password above and copy it manually before closing.</p>}
          </div>
        )}

        <DialogFooter>
          {tempPassword === null ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} loading={working}>
                Generate
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
