/**
 * „Warum handeln oder auslassen?“ in the Einstiegs-Check card (F10): the verdict line is always there, opened it shows
 * the four groups (Pflicht, Optional, Widersprüche, Fehlende Daten) with reasons, a high score never turns a failed
 * required condition into „Handeln“, and the „zu spät“ limit is a setting.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";
import { gradedSnapshot, v2check } from "./views.overview.signalFixtures";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState, listeners: new Set<() => void>() }));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    live.listeners.add(cb);
    return () => void live.listeners.delete(cb);
  };
  return { ...actual, useSignalCheck: () => useSyncExternalStore(subscribe, () => live.state, () => live.state) };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SignalCard } from "@/views/overview/SignalCard";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal } from "./views.overview.harness";

const bottom = (barsAgo = 0) => ({ kind: "bottom" as const, barsAgo });
const MIN = 60_000;

function publish(s: Partial<SignalCheckState>): void {
  live.state = { state: "ok", snapshot: null, updatedAt: 1, message: null, ...s };
  for (const l of [...live.listeners]) l();
}
const wrap = () =>
  render(
    <MotionRoot>
      <MorphDialogProvider>
        <SignalCard />
      </MorphDialogProvider>
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  live.listeners.clear();
  await bootFixtureJournal();
});

const confirmed = () =>
  gradedSnapshot([
    v2check("30m", { long: bottom(1), rsi: 28 }),
    v2check("45m", { long: bottom(1), rsi: 33 }),
    v2check("1h", { long: bottom(0), state: "provisional", closesAt: Date.now() + 40 * MIN, rsi: 36 }),
    v2check("4h", { rsi: 44 }),
  ]);
const provisional = () =>
  gradedSnapshot([
    v2check("30m", { long: bottom(0), state: "provisional", closesAt: Date.now() + 12 * MIN, rsi: 28 }),
    v2check("45m", { long: bottom(1), rsi: 33 }),
    v2check("1h", { long: bottom(1), rsi: 36 }),
    v2check("4h", { rsi: 44 }),
  ]);

describe("WhySection", () => {
  it("is part of the card, collapsed by default, with the verdict in one line and a pill", () => {
    publish({ snapshot: confirmed() });
    wrap();
    const why = screen.getByTestId("why-section");
    expect(why).toBeInTheDocument();
    expect(within(why).getByTestId("why-headline")).toHaveTextContent(/Handeln|Vorsicht|Auslassen|Nicht beurteilbar/);
    expect(screen.queryByTestId("why-required")).toBeNull();
  });

  it("opened: four separate groups with reasons, the late check and its limit", async () => {
    publish({ snapshot: confirmed() });
    wrap();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Details zeigen: Warum handeln oder auslassen?" })));
    for (const id of ["why-required", "why-optional", "why-conflicts", "why-missing"]) expect(await screen.findByTestId(id)).toBeInTheDocument();
    const required = screen.getByTestId("why-required");
    expect(within(required).getByText("Zeiteinheiten bestätigen")).toBeInTheDocument();
    expect(within(required).getByText("RSI an der Extremzone")).toBeInTheDocument();
    expect(within(required).getAllByRole("listitem").every((li) => li.textContent!.includes(" – "))).toBe(true);
    const late = screen.getByTestId("why-late");
    expect(late).toHaveTextContent("Rechtzeitig?");
    // the default limit is 0,5 R and a segment of its own
    expect(within(late).getByRole("radio", { name: "0,5 R" })).toBeChecked();
  });

  it("a signal that still sits on the forming candle is skipped – whatever its score", async () => {
    publish({ snapshot: provisional() });
    wrap();
    const why = screen.getByTestId("why-section");
    expect(why).toHaveAttribute("data-decision", "skip");
    expect(within(why).getByTestId("why-headline")).toHaveTextContent("Auslassen – Pflichtbedingung fehlt");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Details zeigen: Warum handeln oder auslassen?" })));
    const note = await screen.findByTestId("why-score-note");
    expect(note).toHaveTextContent("Score");
    expect(within(screen.getByTestId("why-required")).getByText("Signalkerze geschlossen").closest("li")).toHaveAttribute("data-status", "unmet");
  });

  it("the limit for „zu spät“ is saved in settings.signals (every other key survives)", async () => {
    publish({ snapshot: confirmed() });
    wrap();
    const before = useJournal.getState().settings.signals;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Details zeigen: Warum handeln oder auslassen?" })));
    await act(async () => fireEvent.click(await screen.findByRole("radio", { name: "1,0 R" })));
    const after = useJournal.getState().settings.signals as { lateMaxR?: number } & Record<string, unknown>;
    expect(after.lateMaxR).toBe(1);
    for (const [k, v] of Object.entries((before ?? {}) as Record<string, unknown>)) expect(after[k]).toEqual(v);
  });
});
