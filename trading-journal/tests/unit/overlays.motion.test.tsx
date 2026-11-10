import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceMv } from "@/market/motionValues";
import { MotionRoot } from "@/motion/MotionRoot";
import { HoldConfirm, useConfirmFocus } from "@/motion/HoldConfirm";
import { rectFullyVisible } from "@/primitives/fieldFx";
import { TradeDetail } from "@/overlays/TradeDetail";
import { EDITOR_MESSAGES, TradeEditor, invalidFieldOf, type TradeRecord } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { SAMPLE, settings } from "./domain.fixtures";
import { registerFlatForm } from "./editorLayout";

// the older specs test every field's data path: all fields stay on screen (the short form has its own specs)
registerFlatForm();

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("invalidFieldOf / rectFullyVisible", () => {
  it("maps every field message to its control", () => {
    expect(invalidFieldOf(EDITOR_MESSAGES.date)).toBe("date");
    expect(invalidFieldOf(EDITOR_MESSAGES.entry)).toBe("entry");
    expect(invalidFieldOf(EDITOR_MESSAGES.exit)).toBe("exit");
    expect(invalidFieldOf(EDITOR_MESSAGES.size)).toBe("size");
    expect(invalidFieldOf(EDITOR_MESSAGES.chart)).toBe("chart");
    expect(invalidFieldOf(EDITOR_MESSAGES.saveFailed)).toBeNull();
  });
  it("visibility band check", () => {
    expect(rectFullyVisible({ top: 80, bottom: 120 }, { top: 72, bottom: 800 })).toBe(true);
    expect(rectFullyVisible({ top: 40, bottom: 80 }, { top: 72, bottom: 800 })).toBe(false);
    expect(rectFullyVisible({ top: 780, bottom: 820 }, { top: 72, bottom: 800 })).toBe(false);
  });
});

describe("<HoldConfirm>", () => {
  function Harness({ onConfirm, duration = 0.08 }: { onConfirm: () => void; duration?: number }) {
    const [asking, setAsking] = useState(false);
    const { trigger, no } = useConfirmFocus(asking);
    return asking ? (
      <span>
        Wirklich löschen?
        <button type="button" ref={no} onClick={() => setAsking(false)}>
          Nein
        </button>
      </span>
    ) : (
      <HoldConfirm ref={trigger} duration={duration} onAsk={() => setAsking(true)} onConfirm={onConfirm}>
        Löschen
      </HoldConfirm>
    );
  }

  it("a click asks first (inline confirm), focus moves to the safe answer and back", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: "Löschen" });
    expect(btn).toHaveAttribute("title", "Tippen fragt nach · Halten bestätigt sofort");
    btn.focus();
    fireEvent.click(btn);
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Nein" }));
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Löschen" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a quick Enter asks; a full pointer hold confirms without asking", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: "Löschen" });
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyUp(btn, { key: "Enter" });
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nein" }));

    const again = screen.getByRole("button", { name: "Löschen" });
    fireEvent.pointerDown(again, { button: 0 });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(again);
    fireEvent.click(again, { detail: 1 });
    expect(screen.queryByText("Wirklich löschen?")).toBeNull();
  });

  it("a full key hold confirms without asking on key-up", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: "Löschen" });
    fireEvent.keyDown(btn, { key: " " });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.keyUp(btn, { key: " " });
    expect(screen.queryByText("Wirklich löschen?")).toBeNull();
  });
});

describe("TradeEditor motion", () => {
  const saveTrade = vi.fn<(t: TradeRecord) => Promise<void>>(async () => {});

  beforeEach(() => {
    saveTrade.mockClear();
    useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", saveTrade });
    useUi.setState({ acc: "all", editor: { open: true, fromFab: false }, setupEditor: { open: false, fromTrade: false }, toasts: [], celebrations: [] });
  });
  afterEach(() => {
    priceMv.jump(0);
  });

  const mount = (livePrice?: number) =>
    render(
      <MotionRoot>
        <TradeEditor livePrice={livePrice} />
      </MotionRoot>,
    );
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

  it("a refused save marks the offending field until it is edited", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(EDITOR_MESSAGES.entry);
    expect(input("Einstieg")).toHaveAttribute("aria-invalid", "true");
    expect(input("Einstieg")).toHaveAttribute("aria-describedby", alert.id);
    expect(document.activeElement).toBe(input("Einstieg"));
    type("Einstieg", "80000");
    expect(input("Einstieg")).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    // the old message leaves first, then the new one comes in (never two messages drawn over each other)
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(EDITOR_MESSAGES.exit));
    expect(input("Ausstieg")).toHaveAttribute("aria-invalid", "true");
  });

  it("saving a trade never starts a burst of dots – not for a win, not for a big win, not for a loss (decision 2026-11-10: kein Konfetti)", async () => {
    mount();
    type("Einstieg", "80000");
    type("Stop-Loss", "79000");
    type("Ausstieg", "84000");
    type("Größe (USDT)", "8000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(1));
    // R ≈ 4, a new equity high: exactly the save that used to celebrate
    await pause(260);
    expect(useUi.getState().celebrations).toEqual([]);
    // the result is still said – by the toast, in its sign and tone
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: "success", title: "Trade gespeichert", valueTone: "win" });

    act(() => useUi.setState({ editor: { open: true, fromFab: false }, celebrations: [] }));
    type("Einstieg", "80000");
    type("Ausstieg", "79000");
    type("Größe (USDT)", "8000");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saveTrade).toHaveBeenCalledTimes(2));
    await pause(60);
    expect(useUi.getState().celebrations).toEqual([]);
  });

  it("the live-price buttons ride a hidden mini odometer once a live price exists; their names stay exact", async () => {
    mount(85900.55);
    const buttons = screen.getAllByRole("button", { name: "Live-Preis übernehmen" });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.querySelector("[data-rolling-digits]")).toBeNull();
    act(() => priceMv.set(84199));
    const live = screen.getAllByRole("button", { name: "Live-Preis übernehmen" });
    expect(live).toHaveLength(2);
    const digits = live[0]!.querySelector("[data-rolling-digits]");
    expect(digits).not.toBeNull();
    expect(digits?.closest('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(live[0]!);
    // the freshest trade (priceMv, full precision) wins over the host's once-a-second rounded prop
    expect(input("Einstieg").value).toBe("84199");
    expect(await screen.findByText(/^✓ 84\.199/)).toBeInTheDocument();
  });

  it("emotion chips: one selection at a time, re-click clears", () => {
    mount();
    const group = screen.getByRole("group", { name: "Gefühl beim Einstieg" });
    const [first, second] = Array.from(group.querySelectorAll("button"));
    fireEvent.click(first!);
    expect(first).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(second!);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(second!);
    expect(second).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TradeDetail hold-to-delete", () => {
  it("holding `Löschen` deletes without the inline question; a click still asks", async () => {
    const deleteTrade = vi.fn(async () => {});
    useJournal.setState({ trades: SAMPLE, settings: settings(), loaded: true, mode: "local", deleteTrade });
    useUi.setState({ detail: { id: "A", source: "table" }, editor: { open: false, fromFab: false }, toasts: [], transitioning: false });
    render(
      <MotionRoot>
        <TradeDetail />
      </MotionRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    // the actions leave first, then the confirmation pops in (sequenced swap, TR-06); focus lands on `Nein`
    const no = await screen.findByRole("button", { name: "Nein" });
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(no));
    fireEvent.click(no);

    const del = await screen.findByRole("button", { name: "Löschen" });
    await waitFor(() => expect(document.activeElement).toBe(del));
    expect(del).toHaveAttribute("data-state", "idle");
    fireEvent.pointerDown(del, { button: 0 });
    expect(del).toHaveAttribute("data-state", "holding");
    await waitFor(() => expect(deleteTrade).toHaveBeenCalledWith("A"), { timeout: 3000 });
    expect(screen.queryByText("Wirklich löschen?")).toBeNull();
    await waitFor(() => expect(useUi.getState().detail.id).toBeNull());
    expect(useUi.getState().toasts.map((t) => t.title)).toContain("Trade gelöscht");
  });
});
