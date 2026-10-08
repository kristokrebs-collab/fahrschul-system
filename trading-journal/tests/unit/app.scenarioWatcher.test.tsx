import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, type FakeMarket } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ current: null as FakeMarket | null }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  // closed 4h bar at 86.200
  fake.current = fakeMarket(actual);
  return { ...actual, ...fake.current.overrides };
});

import { ScenarioWatcher, TRIGGER_LAST_KEY } from "@/app/ScenarioWatcher";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

/** Moves the stored levels so the closed 4h bar (86.200) sits under the stored short trigger. */
function underShortLevel() {
  const s = useJournal.getState().settings;
  useJournal.setState({ settings: { ...s, market: { ...s.market, longTrigger: 88_000, shortTrigger: 87_000 } } });
}

describe("ScenarioWatcher – long-only scenarios on the overview (decision 13)", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.removeItem(TRIGGER_LAST_KEY);
  });

  it("never toasts `Short-Trigger aktiv`: a close under the short level is the range", () => {
    underShortLevel();
    localStorage.setItem(TRIGGER_LAST_KEY, JSON.stringify({ key: "long", close4hAt: 1 }));
    render(<ScenarioWatcher />);
    const toasts = useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe("Neues Szenario: Range, kein Trigger");
    expect(JSON.parse(localStorage.getItem(TRIGGER_LAST_KEY) ?? "{}").key).toBe("range");
  });

  it("a `short` key persisted before the change compares as the range: no toast for a scenario that is not shown", () => {
    underShortLevel();
    localStorage.setItem(TRIGGER_LAST_KEY, JSON.stringify({ key: "short", close4hAt: 1 }));
    render(<ScenarioWatcher />);
    expect(useUi.getState().toasts).toHaveLength(0);
  });
});
