import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderHealth } from "@/market/types";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SettingsView } from "@/views/settings";
import { changedKeys, settingsToDraft } from "@/views/settings/draft";
import { DONE_HOLD_MS, useActionPhase } from "@/views/settings/fx";
import { LiveDataCard } from "@/views/settings/LiveDataCard";
import { PageHeader } from "@/views/setups/PageHeader";
import { useFirstInView } from "@/motion/inView";
import { seedV0 } from "./store.fixture";

describe("changedKeys", () => {
  it("compares by saved meaning: numbers by value, text trimmed, rules without empty rows", () => {
    const saved = settingsToDraft(useJournal.getState().settings);
    expect(changedKeys(saved, saved).size).toBe(0);
    expect(changedKeys({ ...saved, makro: "20000,00" }, saved).size).toBe(0); // same number, other spelling
    expect(changedKeys({ ...saved, makro: "20.000,5" }, saved)).toEqual(new Set(["makro"]));
    expect(changedKeys({ ...saved, makro: "abc" }, saved)).toEqual(new Set(["makro"]));
    expect(changedKeys({ ...saved, pair: ` ${saved.pair} ` }, saved).size).toBe(0);
    expect(changedKeys({ ...saved, rules: [...saved.rules, { id: "g_new", text: "  " }] }, saved).size).toBe(0);
    expect(changedKeys({ ...saved, rules: [...saved.rules, { id: "g_new", text: "Neu" }] }, saved)).toEqual(new Set(["rules"]));
    expect(changedKeys({ ...saved, rules: [...saved.rules].reverse() }, saved).has("rules")).toBe(saved.rules.length > 1);
  });
});

describe("useActionPhase", () => {
  it("idle → busy → done → idle; a refused action returns to idle", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useActionPhase());
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.run(async () => true);
      });
      expect(ok).toBe(true);
      expect(result.current.phase).toBe("done");
      act(() => vi.advanceTimersByTime(DONE_HOLD_MS));
      expect(result.current.phase).toBe("idle");
      await act(async () => {
        ok = await result.current.run(() => false);
      });
      expect(ok).toBe(false);
      expect(result.current.phase).toBe("idle");
      await act(async () => {
        ok = await result.current.run(() => {
          throw new Error("x");
        });
      });
      expect(ok).toBe(false);
      expect(result.current.phase).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useFirstInView", () => {
  it("is true at once without an IntersectionObserver (jsdom) or when disabled", () => {
    const { result } = renderHook(() => useFirstInView(useRef<HTMLDivElement>(null)));
    expect(result.current).toBe(true);
    const off = renderHook(() => useFirstInView(useRef<HTMLDivElement>(null), false));
    expect(off.result.current).toBe(true);
  });
});

describe("PageHeader", () => {
  it("keeps the plain title as the heading text and labels the rolling count", () => {
    render(<PageHeader title="Alle meine Grundlagen" lead="Lead" count={3} countUnit={(n) => (n === 1 ? "Grundlage" : "Grundlagen")} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Alle meine Grundlagen");
    expect(screen.getByRole("heading", { level: 1, name: "Alle meine Grundlagen" })).toBeInTheDocument();
    expect(screen.getByText("3 Grundlagen")).toBeInTheDocument();
  });
});

describe("SettingsView motion", () => {
  beforeEach(async () => {
    seedV0();
    resetJournal();
    await bootJournal({ autoBackup: false });
    useUi.setState({ toasts: [] });
  });

  it("marks changed fields, opens the in-flow unsaved bar between header and form, and saves from it", async () => {
    render(<SettingsView />);
    expect(screen.queryByText("Ungespeicherte Änderungen")).toBeNull();
    const label = () => screen.getByText("Startkapital Makro", { selector: "label" });
    expect(label().querySelector('[title="Ungespeichert"]')).toBeNull();

    fireEvent.change(screen.getByLabelText("Startkapital Makro"), { target: { value: "25000" } });
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    expect(label().querySelector('[title="Ungespeichert"]')).not.toBeNull();
    const saves = screen.getAllByRole("button", { name: "Speichern" });
    expect(saves).toHaveLength(3);
    // DOM order = visual order: header, the sticky bar under it (ST-01: in flow, never over other content), the form
    expect(saves[0]!.closest("form")).toBeNull();
    const bar = screen.getByText("Ungespeicherte Änderungen").closest("[data-unsaved-bar]") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.closest("form")).toBeNull();
    expect(within(bar).getByRole("button", { name: "Speichern" })).toBe(saves[1]);
    expect(saves[2]!.closest("form")).not.toBeNull();
    expect(bar.compareDocumentPosition(saves[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getByText("Ungespeichert")).toBeInTheDocument(); // short label below sm

    // typing the saved value back clears the marks
    fireEvent.change(screen.getByLabelText("Startkapital Makro"), { target: { value: "20.000,00" } });
    await waitFor(() => expect(screen.queryByText("Ungespeicherte Änderungen")).toBeNull());

    fireEvent.change(screen.getByLabelText("Startkapital Makro"), { target: { value: "26000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[1]!);
    await waitFor(() => expect(useJournal.getState().settings.capital.makro).toBe(26000));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Gespeichert" }).length).toBeGreaterThan(0));
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Einstellungen gespeichert");
    // after the ✓ hold the page's buttons return to `Speichern` and the bar slides away
    await waitFor(() => expect(screen.queryByText("Ungespeicherte Änderungen")).toBeNull(), { timeout: DONE_HOLD_MS + 6000 });
    expect(screen.getAllByRole("button", { name: "Speichern" })).toHaveLength(2);
  }, 20_000); // waits out the ✓ hold + the bar exit; slow on a loaded box

  it("a refused save marks the offending field invalid until it is edited", async () => {
    render(<SettingsView />);
    const scalp = screen.getByLabelText("Startkapital Scalp");
    fireEvent.change(scalp, { target: { value: "abc" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Speichern" })[0]!);
    await waitFor(() => expect(useUi.getState().toasts.map((t) => t.title)).toContain("Bitte alle Zahlenfelder ausfüllen"));
    expect(scalp).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(scalp);
    fireEvent.change(scalp, { target: { value: "6000" } });
    expect(scalp).not.toHaveAttribute("aria-invalid");
  });
});

describe("LiveDataCard", () => {
  const health = {
    overall: "live",
    online: true,
    ws: { attempt: 0 },
    proxy: { usable: true },
    feeds: { markPrice: { feed: "markPrice", source: "binance", state: "live", lastDataAt: Date.UTC(2026, 0, 1, 12, 0) } },
  } as unknown as ProviderHealth;

  it("the proxy preference is a labelled switch", () => {
    useUi.setState({ useProxy: false });
    render(<LiveDataCard health={health} />);
    const sw = screen.getByRole("switch", { name: "EU-Proxy verwenden" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(useUi.getState().useProxy).toBe(true);
    expect(screen.getByRole("switch", { name: "EU-Proxy verwenden" })).toHaveAttribute("aria-checked", "true");
  });

  it("actions keep their names, run their handler and show the finished state", async () => {
    const onRefresh = vi.fn(async () => {});
    render(<LiveDataCard health={health} onRefresh={onRefresh} />);
    const refresh = screen.getByRole("button", { name: "Jetzt aktualisieren" });
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).not.toHaveAttribute("aria-busy"));
    expect(screen.getByRole("button", { name: "Jetzt aktualisieren" })).toBe(refresh);
    expect(screen.getByRole("button", { name: "Cache leeren" })).toBeDisabled(); // no handler wired
  });
});
