import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createPath, UNSAFE_NavigationContext, type NavigateOptions } from "react-router-dom";

type ResourceNavigationGuard = (href: string, options?: NavigateOptions) => boolean;

interface ResourceNavigationContextValue {
  /** False means the resource is handling confirmation; prevent the Link's default navigation. */
  requestNavigation: (href: string, options?: NavigateOptions) => boolean;
  registerGuard: (owner: symbol, guard: ResourceNavigationGuard) => () => void;
  continueNavigation: (owner: symbol, navigate: () => void) => void;
  /** Only after a verified account/session-ending receipt. */
  completeSessionNavigation: (navigate: () => void) => void;
}

const fallback: ResourceNavigationContextValue = {
  requestNavigation: () => true,
  registerGuard: () => () => {},
  continueNavigation: (_owner, navigate) => navigate(),
  completeSessionNavigation: navigate => navigate(),
};
const ResourceNavigationContext = createContext<ResourceNavigationContextValue | null>(null);

/** All internal router writes consult the active workspace guards. Nested
 * previews share the controller, so the topmost editor is asked first. Native
 * indexed Back/Forward remains protected by useDocumentHistoryGuard. */
export function ResourceNavigationProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(ResourceNavigationContext);
  const navigation = useContext(UNSAFE_NavigationContext);
  const guards = useRef(new Map<symbol, ResourceNavigationGuard>());
  const bypass = useRef(new Set<symbol>());
  const requestNavigation = useCallback((href: string, options?: NavigateOptions) => {
    for (const [owner, guard] of [...guards.current].reverse()) {
      if (!bypass.current.has(owner) && !(options ? guard(href, options) : guard(href))) return false;
    }
    return true;
  }, []);
  const registerGuard = useCallback((owner: symbol, guard: ResourceNavigationGuard) => {
    guards.current.set(owner, guard);
    return () => { guards.current.delete(owner); };
  }, []);
  const continueNavigation = useCallback((owner: symbol, navigate: () => void) => {
    bypass.current.add(owner);
    try { navigate(); } finally { bypass.current.delete(owner); }
  }, []);
  const completeSessionNavigation = useCallback((navigate: () => void) => {
    const owners = [...guards.current.keys()];
    owners.forEach(owner => bypass.current.add(owner));
    try { navigate(); } finally { owners.forEach(owner => bypass.current.delete(owner)); }
  }, []);
  const value = useMemo(() => inherited ?? ({ requestNavigation, registerGuard, continueNavigation, completeSessionNavigation }), [inherited, requestNavigation, registerGuard, continueNavigation, completeSessionNavigation]);
  const guardedNavigation = useMemo(() => {
    if (!navigation || inherited) return null;
    const navigator = navigation.navigator;
    return { ...navigation, navigator: {
      ...navigator,
      push: (to: Parameters<typeof navigator.push>[0], state?: unknown, options?: Parameters<typeof navigator.push>[2]) => {
        if (requestNavigation(typeof to === "string" ? to : createPath(to), { ...options, state })) navigator.push(to, state, options);
      },
      replace: (to: Parameters<typeof navigator.replace>[0], state?: unknown, options?: Parameters<typeof navigator.replace>[2]) => {
        if (requestNavigation(typeof to === "string" ? to : createPath(to), { ...options, state, replace: true })) navigator.replace(to, state, options);
      },
    } };
  }, [navigation, inherited, requestNavigation]);
  const contents = <ResourceNavigationContext.Provider value={value}>{children}</ResourceNavigationContext.Provider>;
  return guardedNavigation ? <UNSAFE_NavigationContext.Provider value={guardedNavigation}>{contents}</UNSAFE_NavigationContext.Provider> : contents;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useResourceNavigation() {
  return useContext(ResourceNavigationContext) ?? fallback;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useResourceNavigationGuard(guard: ResourceNavigationGuard | null) {
  const { registerGuard, continueNavigation } = useResourceNavigation();
  const owner = useRef(Symbol("resource-navigation"));
  const latest = useRef(guard);
  useLayoutEffect(() => { latest.current = guard; });
  const enabled = guard !== null;
  useLayoutEffect(() => {
    if (enabled) return registerGuard(owner.current, (href, options) => (options ? latest.current?.(href, options) : latest.current?.(href)) ?? true);
  }, [enabled, registerGuard]);
  // Only the confirming owner is bypassed; an underlying dirty editor still
  // gets its own chance to protect work after a settings/preview closes.
  return useCallback((navigate: () => void) => continueNavigation(owner.current, navigate), [continueNavigation]);
}
