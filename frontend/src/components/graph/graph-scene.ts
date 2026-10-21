import type { GraphMeta } from "./use-graph-data";

export function graphCoverage(meta?: GraphMeta): { label: string; detail: string } {
  const partial = meta?.truncated === true || meta?.orphanTruncated === true;
  const connected = meta?.returned != null && meta.nodesTotal != null
    ? `${meta.returned} of ${meta.nodesTotal} connected resources loaded.` : "Connected-resource coverage is not supplied by this server.";
  const isolated = meta?.orphanReturned != null
    ? `${meta.orphanReturned} unconnected resources loaded${meta.orphanTruncated ? " (limited)" : ""}.` : "Unconnected-resource coverage is unknown.";
  return {
    label: partial ? "Partial map" : "Loaded map",
    detail: `${connected} ${isolated} Filters apply to this loaded map. Neighborhoods may omit additional resources and relationships.`,
  };
}

/** What the whole-Vault map leaves out: resources past the loaded set and, when only strong links are drawn, body links. */
export function wholeVaultNote(meta: GraphMeta | undefined, hiddenWeak: number): string {
  const loaded = meta?.returned != null && meta.nodesTotal != null && meta.returned < meta.nodesTotal
    ? `Shows the ${meta.returned} best-connected of ${meta.nodesTotal} connected resources.` : "";
  const weak = hiddenWeak > 0 ? `${hiddenWeak.toLocaleString("en-US")} body links are hidden.` : "";
  const missing = loaded ? "Relationships to resources outside this set are not shown." : "";
  if (!loaded && !weak) return "";
  return [loaded, weak, missing, "Focus a resource to see all of its connections."].filter(Boolean).join(" ");
}
