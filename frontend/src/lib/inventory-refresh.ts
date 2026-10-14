export const INVENTORY_CHANGED_EVENT = "akb:inventory-changed";

/** Successful content writes only; no private payloads or token data. */
export function notifyInventoryChanged(vault?: string) {
  window.dispatchEvent(new CustomEvent(INVENTORY_CHANGED_EVENT, { detail: { vault } }));
}

export function changesInventory(path: string, method = "GET"): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const pathname = path.split("?")[0];
  return /^\/(documents|files|tables|vaults|collections)(\/|$)/.test(pathname)
    && !/\/(sql|assets|search-update-status|write-policy|git|skill|members)(\/|$)/.test(pathname);
}
