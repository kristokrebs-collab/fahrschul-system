/**
 * ScenarioWatcher (decision 23): a toast on a change of the Lage-Ampel — never on the first load, never twice after a
 * reload, red ↔ amber at most every 4 h, off with the Ampel. The former manual-level scenario toast is gone.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal } from "./views.overview.harness";
import type { Lage } from "@/domain/lage";
import type { LageView } from "@/market";

const view = vi.hoisted(() => ({ current: { lage: null, status: { state: "idle", fetchedAt: null, closedAt: null, nextAt: null, source: null, detail: null } } as LageView, set: null as ((v: LageView) => void) | null }));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subs = new Set<() => void>();
  view.set = (v) => {
    view.current = v;
    for (const s of subs) s();
  };
  return {
    ...actual,
    useLage: () =>
      useSyncExternalStore(
        (cb) => {
          subs.add(cb);
          return () => void subs.delete(cb);
        },
        () => view.current,
      ),
  };
});

import { LAGE_LAST_KEY, lageToastDue, ScenarioWatcher } from "@/app/ScenarioWatcher";
import { withLageSettings } from "@/domain/lage";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

const lage = (state: Lage["state"], title: string): LageView => ({ lage: { state, title } as Lage, status: view.current.status });
const titles = () => useUi.getState().toasts.map((t) => `${t.title} | ${t.value}`);

describe("ScenarioWatcher – Lage-Ampel changes", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T15:30:00Z"));
    await bootFixtureJournal();
    localStorage.removeItem(LAGE_LAST_KEY);
    view.current = lage("green", "Aufwärtstrend intakt");
  });
  afterEach(() => vi.useRealTimers());

  it("first load: no toast, the state is remembered; a reload with the same state stays quiet", () => {
    const { unmount } = render(<ScenarioWatcher />);
    expect(useUi.getState().toasts).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(LAGE_LAST_KEY) ?? "{}").state).toBe("green");
    unmount();
    render(<ScenarioWatcher />);
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it("toasts the change of the daily trend once: green → red → green (Umkehr bestätigt)", () => {
    render(<ScenarioWatcher />);
    act(() => view.set!(lage("red", "Fällt noch · abwarten")));
    act(() => view.set!(lage("red", "Fällt noch · abwarten")));
    act(() => view.set!(lage("green", "Umkehr bestätigt")));
    expect(titles()).toEqual(["Lage: Fällt noch · abwarten | Rot", "Lage: Umkehr bestätigt | Grün"]);
    expect(useUi.getState().toasts[0]).toMatchObject({ kind: "signal", valueTone: "loss", detail: "Tagestrend abwärts – Kaufsignale zählen nicht." });
  });

  it("red ↔ amber (live values) at most every 4 h", () => {
    view.current = lage("red", "Fällt noch · abwarten");
    render(<ScenarioWatcher />);
    act(() => view.set!(lage("amber", "Umkehr bildet sich · 1 von 4")));
    expect(useUi.getState().toasts).toHaveLength(0);
    vi.setSystemTime(Date.now() + 4 * 60 * 60_000);
    act(() => view.set!(lage("amber", "Umkehr bildet sich · 2 von 4")));
    expect(titles()).toEqual(["Lage: Umkehr bildet sich · 2 von 4 | Gelb"]);
    expect(lageToastDue({ state: "red", at: 0 }, "green", 1)).toBe(true);
    expect(lageToastDue({ state: "red", at: 0 }, "amber", 1)).toBe(false);
  });

  it("off with the Ampel; no data is no state", () => {
    act(() => {
      useJournal.setState((s) => ({ settings: { ...s.settings, signals: withLageSettings(s.settings.signals, { on: false }) } }));
    });
    render(<ScenarioWatcher />);
    act(() => view.set!(lage("red", "Fällt noch · abwarten")));
    act(() => view.set!({ lage: null, status: view.current.status }));
    expect(useUi.getState().toasts).toHaveLength(0);
    expect(localStorage.getItem(LAGE_LAST_KEY)).toBeNull();
  });
});
