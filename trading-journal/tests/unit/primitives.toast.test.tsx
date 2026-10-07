import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastIsland } from "@/primitives/Toast";
import { toast, toastDuration, useToastStore } from "@/primitives/toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("queues toasts in order and dismisses by id", () => {
    const a = toast.ok("Gespeichert", { value: "+120,50 USDT", valueTone: "win" });
    const b = toast.error("Fehler");
    const list = useToastStore.getState().toasts;
    expect(list.map((t) => t.id)).toEqual([a, b]);
    expect(list[0]).toMatchObject({ kind: "ok", title: "Gespeichert", value: "+120,50 USDT" });
    toast.dismiss(a);
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([b]);
  });

  it("uses 2800 ms for ok/error and 5200 ms for warn", () => {
    expect(toastDuration("ok")).toBe(2800);
    expect(toastDuration("error")).toBe(2800);
    expect(toastDuration("warn")).toBe(5200);
  });

  it("island shows one toast at a time and advances the queue after the timeout", () => {
    toast.ok("Erster");
    toast.warn("Neues Szenario: Test", { value: "4H 61.200" });
    render(<ToastIsland />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Erster")).toBeInTheDocument();
    expect(screen.queryByText("Neues Szenario: Test")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(screen.getByText("Neues Szenario: Test")).toBeInTheDocument();
    expect(screen.getByText("4H 61.200").className).toContain("dot-num text-[15px]");
    act(() => {
      vi.advanceTimersByTime(5200);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("a finger resting on the island holds its countdown; lifting it resumes the rest", () => {
    toast.ok("Halten");
    render(<ToastIsland />);
    const card = screen.getByRole("button");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      fireEvent.pointerDown(card, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100 });
    });
    expect(card.closest("[data-held]")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => {
      fireEvent.pointerUp(card, { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100 });
    });
    expect(card.closest("[data-held]")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("clicking the island dismisses the current toast", () => {
    const id = toast.ok("Klick mich");
    render(<ToastIsland />);
    act(() => {
      screen.getByRole("button").click();
    });
    expect(useToastStore.getState().toasts.find((t) => t.id === id)).toBeUndefined();
  });
});
