import { describe, expect, it } from "vitest";
import { focusedVaultPageForPath, isDocumentWorkspacePath } from "../vault-workspace";

describe("focused Vault route ownership", () => {
  it.each([
    ["/vault/team/settings", "settings"], ["/vault/team/settings/", "settings"],
    ["/vault/team/members", "members"], ["/vault/team/graph", "graph"],
    ["/vault/team/publications", "publish"], ["/vault/team", null],
    ["/vault/team/doc/graph", null], ["/vault/team/file/settings", null],
    ["/vault/team/table/members", null], ["/vault/team/search", null],
    ["/vault/team/activity", null], ["/settings", null], ["/vault/new", null],
    ["/something/settings", null],
  ])("resolves %s as %s", (path, page) => {
    expect(focusedVaultPageForPath(path)).toBe(page);
  });
});

describe("document reader route ownership", () => {
  it.each([
    ["/vault/team/doc/note", true], ["/vault/team/doc/note/", true],
    ["/vault/team/doc/notes%2Fhello.md", true], ["/vault/team/doc/new", false],
    ["/vault/team/file/doc", false], ["/vault/team/table/doc", false],
    ["/vault/doc/settings", false], ["/vault/team", false], ["/search", false],
  ])("resolves %s as a document reader: %s", (path, expected) => {
    expect(isDocumentWorkspacePath(path)).toBe(expected);
  });
});
