/**
 * Widget registry of the cockpit (P13): `registerWidget({ id, title, component, defaultSpan })` – the shape the feature
 * packages already export (`ANALYSE_WIDGETS`, `RISIKO_WIDGETS`, `WACHSTUM_WIDGETS`). A widget is a component without
 * props that reads its own stores and renders an existing card unchanged (no duplicated card logic).
 * `defaultSpan` = columns of the 12-column grid on large screens (phones stack everything in one column).
 */
import { useSyncExternalStore, type ComponentType } from "react";

export interface CockpitWidget {
  id: string;
  title: string;
  component: ComponentType;
  /** columns of 12 on large screens */
  defaultSpan: number;
  /** catalog section ("Übersicht", "Analyse", …) */
  group?: string;
  /** one line for the catalog */
  description?: string;
}

/** Widths the cockpit offers (columns of 12). */
export const SPANS = [4, 5, 6, 7, 8, 12] as const;
export type Span = (typeof SPANS)[number];

export function snapSpan(n: number): Span {
  let best: Span = SPANS[0];
  for (const s of SPANS) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

const widgets = new Map<string, CockpitWidget>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** Adds (or replaces) a widget; returns the unregister function. */
export function registerWidget(w: CockpitWidget): () => void {
  if (!w.id || (typeof w.component !== "function" && typeof w.component !== "object")) throw new Error("registerWidget: id and component are required");
  widgets.set(w.id, { ...w, defaultSpan: snapSpan(w.defaultSpan || 6) });
  emit();
  return () => {
    if (widgets.get(w.id)?.component === w.component) {
      widgets.delete(w.id);
      emit();
    }
  };
}

/** Registers a list (`ANALYSE_WIDGETS` …) under one catalog group. */
export function registerWidgets(list: readonly Omit<CockpitWidget, "group">[], group: string): () => void {
  const offs = list.map((w) => registerWidget({ ...w, group }));
  return () => offs.forEach((off) => off());
}

export function getWidget(id: string): CockpitWidget | undefined {
  return widgets.get(id);
}

export function listWidgets(): CockpitWidget[] {
  return [...widgets.values()];
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Re-renders when the registry changes; returns the current version (use with `listWidgets()`). */
export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
