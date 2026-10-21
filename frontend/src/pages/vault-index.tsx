import { useEffect, useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { listVaults } from "@/lib/api";
import type { VaultSummary } from "@/hooks/use-vaults";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Skeleton } from "@/components/ui/skeleton";
import { VaultDirectory } from "@/components/vault-directory";
import { useOpenVaultCreateDialog } from "@/contexts/vault-create-dialog-context";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";

export default function VaultIndexPage() {
  const user = useCurrentUser();
  const { checking, revision } = useAccessVerification();
  return <VaultIndexWorkspace key={JSON.stringify([user?.user_id, revision, checking])} checking={checking} />;
}

function VaultIndexWorkspace({ checking }: { checking: boolean }) {
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (checking) return;
    let cancelled = false;
    setVaults(null);
    setLoadError(false);
    listVaults()
      .then((data) => {
        if (!cancelled) setVaults((data.vaults as VaultSummary[]) || []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, checking]);

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-6">
        <Alert variant="destructive" title="Vaults could not be loaded" className="w-full">
          The workspace is still available, but the vault directory did not respond.
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  if (vaults === null) return <VaultIndexLoading />;
  if (vaults.length === 0) return <FirstVaultState />;
  return <VaultSelectionState vaults={vaults} />;
}

function VaultIndexLoading() {
  return <div className="mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-6">
    <LoadingState label="Loading available vaults">
      <Skeleton className="h-12 w-56" />
      <Skeleton className="mt-4 h-10 w-full" />
      <div className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-none" />)}
      </div>
    </LoadingState>
  </div>;
}

function VaultSelectionState({ vaults }: { vaults: VaultSummary[] }) {
  return <VaultDirectory vaults={vaults} />;
}

function FirstVaultState() {
  const create = useOpenVaultCreateDialog();
  return <section aria-labelledby="first-vault-heading" className="mx-auto w-full max-w-4xl p-6 sm:p-8">
    <FolderPlus className="mb-4 h-6 w-6 text-link" aria-hidden />
    <h1 id="first-vault-heading" className="text-xl font-semibold">Create your first vault.</h1>
    <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-muted">A vault keeps related documents, tables, and files together. Add collections as your knowledge grows.</p>
    <Button variant="accent" className="mt-5" onClick={create}><Plus className="h-4 w-4" aria-hidden />Create first vault</Button>
    <p className="mt-4 text-sm text-foreground-muted">Joining an existing team? Ask a vault owner to invite you.</p>
  </section>;
}
