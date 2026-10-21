import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "akb_theme";
const THEME_CHANGED = "akb:theme-changed";
let memoryTheme: Theme | undefined;
let storageWriteFailed = false;

function savedTheme(): Theme {
  if (storageWriteFailed && memoryTheme) return memoryTheme;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "system";
  } catch { return memoryTheme ?? "system"; }
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(savedTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    memoryTheme = next;
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
      storageWriteFailed = false;
    } catch { storageWriteFailed = true; }
    window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: next }));
  }, []);

  useEffect(() => {
    const synchronize = (event: Event) => {
      const next = event instanceof CustomEvent ? event.detail : savedTheme();
      if (next !== "light" && next !== "dark" && next !== "system") return;
      memoryTheme = next; setThemeState(next); applyTheme(next);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) { storageWriteFailed = false; synchronize(event); }
    };
    window.addEventListener(THEME_CHANGED, synchronize);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(THEME_CHANGED, synchronize); window.removeEventListener("storage", storage); };
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme, resolved: resolveTheme(theme) };
}
