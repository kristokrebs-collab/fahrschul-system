import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * `React.lazy` that forgets a failed download. A lazy component caches its rejection for good, so "Erneut versuchen"
 * of the page's error boundary would only ever show the same error; this one hands out a fresh lazy component (a new
 * download attempt) once the previous one failed, and the same stable identity as long as nothing went wrong.
 */
export function retryableLazy(loader: () => Promise<{ default: ComponentType }>): () => LazyExoticComponent<ComponentType> {
  let current: LazyExoticComponent<ComponentType> | null = null;
  return () => {
    if (!current) {
      const next = lazy(() =>
        loader().catch((err: unknown) => {
          if (current === next) current = null;
          throw err;
        }),
      );
      current = next;
    }
    return current;
  };
}
