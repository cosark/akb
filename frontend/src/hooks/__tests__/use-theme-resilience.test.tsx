import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../use-theme";

beforeEach(() => { localStorage.clear(); document.documentElement.classList.remove("dark"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("F28 theme storage resilience", () => {
  it("survives SecurityError reads and QuotaExceededError writes while applying the chosen theme", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const { result } = renderHook(useTheme);
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    act(() => result.current.setTheme("system"));
    expect(result.current.theme).toBe("system");
  });
  it("saves successful choices and synchronizes mounted appearance consumers", () => {
    const first = renderHook(useTheme), second = renderHook(useTheme);
    act(() => first.result.current.setTheme("dark"));
    expect(localStorage.getItem("akb_theme")).toBe("dark");
    expect(second.result.current.theme).toBe("dark");
    act(() => second.result.current.setTheme("system"));
    expect(localStorage.getItem("akb_theme")).toBeNull();
    expect(first.result.current.theme).toBe("system");
  });
  it("retains an unsaved session choice when Appearance is reopened", () => {
    localStorage.setItem("akb_theme", "light");
    const first = renderHook(useTheme);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    act(() => first.result.current.setTheme("dark"));
    first.unmount();
    const reopened = renderHook(useTheme);
    expect(reopened.result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    act(() => reopened.result.current.setTheme("system"));
  });
  it("follows system changes only while System is selected", () => {
    let dark = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(() => ({ get matches() { return dark; }, addEventListener: (_type: string, callback: () => void) => listeners.add(callback), removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback) }) as unknown as MediaQueryList);
    const { result } = renderHook(useTheme);
    act(() => { result.current.setTheme("system"); dark = true; listeners.forEach(listener => listener()); });
    expect(document.documentElement).toHaveClass("dark");
    act(() => result.current.setTheme("light"));
    act(() => { dark = true; listeners.forEach(listener => listener()); });
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
