import { describe, expect, it } from "vitest";
import { focusedVaultPageForPath, vaultMenuPageForComponent } from "../vault-workspace";

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

describe("Vault menu current destination", () => {
  it.each([
    ["VaultPage", "overview"], ["GraphPage", "graph"],
    ["PublicationsPage", "publish"], ["VaultMembersPage", "members"], ["VaultSettingsPage", "settings"],
    ["DocumentPage", null], ["DocumentNewPage", null], ["FilePage", null], ["TablePage", null],
    ["SearchPage", null], ["VaultActivityPage", null], ["NotFoundPage", null],
  ])("resolves %s as %s without selecting an unrelated page", (component, expected) => {
    expect(vaultMenuPageForComponent(component)).toBe(expected);
  });
});
