/**
 * Access to the claude.ai runtime (`window.claude.use(name)`), bundle helper `oa`.
 * Deliberately does not augment the global `Window` type to avoid clashes with other modules.
 */
export interface ClaudeRuntime {
  use?: (name: string) => Promise<unknown>;
}

export function getClaude(): ClaudeRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { claude?: ClaudeRuntime }).claude;
}

/** True when the page runs inside claude.ai (Fall B of the start sequence). */
export function hasClaudeRuntime(): boolean {
  return typeof getClaude()?.use === "function";
}

/**
 * Bundle `oa`: resolves with the capability handle or `null`.
 * Without `window.claude.use` this is `Promise.resolve(null)` (Fall A → local mode in the first microtask).
 */
export function requestCapability<T>(name: string): Promise<T | null> {
  const claude = getClaude();
  if (!claude || typeof claude.use !== "function") return Promise.resolve(null);
  try {
    return claude.use(name).then(
      (v) => (v as T | null | undefined) ?? null,
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
}
