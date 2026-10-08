/**
 * Einstellungen → Lage-Ampel (views/settings/LageCard.tsx): an / aus and Wirkung (Sperre | nur Warnung) write
 * `settings.signals.lage` at once, additively (every other signals key, unknown keys inside `lage`, the rest of the
 * settings untouched); the page's draft save keeps the key (round trip), a JSON backup keeps it.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (orig) => ({
  ...(await orig<typeof import("@/market")>()),
  useLage: () => ({ lage: null, status: { state: "idle", fetchedAt: null, closedAt: null, nextAt: null, source: null, detail: null } }),
}));

import { lageSettingsOf } from "@/domain/lage";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { draftToSettings, settingsToDraft } from "@/views/settings/draft";
import { LageCard } from "@/views/settings/LageCard";

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

function renderCard() {
  return render(
    <MotionRoot>
      <LageCard />
    </MotionRoot>,
  );
}

describe("LageCard", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("defaults: on, Sperre — without a stored key nothing is written", () => {
    const before = useJournal.getState().settings;
    renderCard();
    const card = screen.getByTestId("settings-lage");
    expect(card).toHaveAttribute("data-on", "on");
    expect(within(card).getByRole("switch", { name: "Lage-Ampel verwenden" })).toBeChecked();
    expect(within(within(card).getByRole("radiogroup", { name: "Wirkung" })).getByRole("radio", { name: "Sperre", checked: true })).toBeInTheDocument();
    expect(within(card).getByTestId("settings-lage-help")).toHaveTextContent(/^Sperre \(Signale zählen nur bei Grün\): Bei Gelb und Rot zählt ein Kaufsignal nicht/);
    expect(useJournal.getState().settings).toBe(before);
  });

  it("switch and Wirkung write settings.signals.lage at once, additively", async () => {
    const s0 = useJournal.getState().settings;
    const signals0 = { ladder: ["30m", "45m", "1h", "4h"], whale: { on: true, weight: 10 }, fremd: { a: 1 }, lage: { notiz: "bleibt" } };
    await act(async () => {
      await useJournal.getState().saveSettings({ ...s0, signals: signals0 });
    });
    const base = useJournal.getState().settings;
    renderCard();
    fireEvent.click(screen.getByRole("switch", { name: "Lage-Ampel verwenden" }));
    await flush();
    let s = useJournal.getState().settings;
    expect(s.signals).toEqual({ ...signals0, lage: { notiz: "bleibt", on: false, mode: "block" } });
    expect(screen.getByTestId("settings-lage")).toHaveAttribute("data-on", "off");
    expect(screen.getByTestId("settings-lage-help")).toHaveTextContent(/^Aus: Kaufsignale zählen ohne Tagestrend/);
    // everything else of the settings untouched
    expect({ ...s, signals: undefined }).toEqual({ ...base, signals: undefined });
    fireEvent.click(screen.getByRole("switch", { name: "Lage-Ampel verwenden" }));
    await flush();
    fireEvent.click(screen.getByRole("radio", { name: "Nur Warnung" }));
    await flush();
    s = useJournal.getState().settings;
    expect(lageSettingsOf(s.signals)).toEqual({ on: true, mode: "warn" });
    expect((s.signals as { lage: { notiz: string } }).lage.notiz).toBe("bleibt");
    expect(screen.getByTestId("settings-lage")).toHaveAttribute("data-mode", "warn");
    // persisted (local adapter → tj2-settings) and back from storage
    const raw = JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { signals?: unknown };
    expect(lageSettingsOf(raw.signals)).toEqual({ on: true, mode: "warn" });
  });

  it("round trip: the settings page's draft save keeps the Lage key (with and without signal edits)", async () => {
    const s0 = useJournal.getState().settings;
    await act(async () => {
      await useJournal.getState().saveSettings({ ...s0, signals: { ladder: ["30m", "1h"], lage: { on: false, mode: "warn", x: 1 } } });
    });
    const stored = useJournal.getState().settings;
    // untouched signal part: the stored object as it is
    const same = draftToSettings(settingsToDraft(stored), stored);
    expect(same.ok && same.settings.signals).toBe(stored.signals);
    // a signal edit is merged over the stored object: lage survives
    const edited = draftToSettings({ ...settingsToDraft(stored), sgReq: "1" }, stored);
    expect(edited.ok).toBe(true);
    const sig = edited.ok ? (edited.settings.signals as Record<string, unknown>) : {};
    expect(sig.required).toBe(1);
    expect(sig.lage).toEqual({ on: false, mode: "warn", x: 1 });
    // JSON backup round trip
    expect(lageSettingsOf(JSON.parse(JSON.stringify(stored)).signals)).toEqual({ on: false, mode: "warn" });
  });
});
