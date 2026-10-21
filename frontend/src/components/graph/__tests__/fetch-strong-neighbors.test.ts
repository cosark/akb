import { describe, it, expect, vi, beforeEach } from "vitest";

// A plain function rather than vi.fn: a mock records each returned promise, and a recorded rejection is reported as
// unhandled even though the code under test settles it.
let impl: (...args: unknown[]) => Promise<unknown> = () => Promise.reject(new Error("unset"));
const getGraph = { mockImplementation: (fn: typeof impl) => { impl = fn; }, mockReset: () => { impl = () => Promise.reject(new Error("unset")); } };
vi.mock("@/lib/api", () => ({ getGraph: (...args: unknown[]) => impl(...args), getGraphOverview: vi.fn() }));

import { fetchStrongNeighbors } from "../use-graph-data";

const ring = (truncated: boolean) => ({
  nodes: [{ uri: "focus", resource_type: "document", depth: 0 }, { uri: "hub", resource_type: "document", depth: 1 }],
  edges: [{ source: "focus", target: "hub", relation: "links_to", kind: "implicit" }],
  truncated,
});

describe("fetchStrongNeighbors", () => {
  beforeEach(() => getGraph.mockReset());

  it("keeps a complete strong walk complete when a weak ring was capped, and says so separately", async () => {
    getGraph.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[4] === "strong"
        ? { nodes: [{ uri: "focus", resource_type: "document", depth: 0 }], edges: [], truncated: false }
        : ring(true)));
    const out = await fetchStrongNeighbors("v", "focus", 3);
    expect(out.meta?.truncated).toBeFalsy();
    expect(out.meta?.weakTruncated).toBe(true);
  });

  it("marks the map partial when the strong walk itself was capped", async () => {
    getGraph.mockImplementation((...args: unknown[]) =>
      Promise.resolve(args[4] === "strong"
        ? { nodes: [{ uri: "focus", resource_type: "document", depth: 0 }], edges: [], truncated: true }
        : ring(false)));
    const out = await fetchStrongNeighbors("v", "focus", 1);
    expect(out.meta?.truncated).toBe(true);
    expect(out.meta?.weakTruncated).toBeUndefined();
  });

  it("counts a failed weak ring as missing weak links only", async () => {
    getGraph.mockImplementation((...args: unknown[]) =>
      args[4] === "strong"
        ? Promise.resolve({ nodes: [{ uri: "focus", resource_type: "document", depth: 0 }], edges: [], truncated: false })
        : Promise.reject(new Error("boom")));
    const out = await fetchStrongNeighbors("v", "focus", 1);
    expect(out.meta?.truncated).toBeFalsy();
    expect(out.meta?.weakTruncated).toBe(true);
  });
});
