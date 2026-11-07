import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveBadge, saveSentence, SaveSurface, useSaveMorph } from "@/motion/SaveMorph";
import { persisted, NotPersistedError } from "@/store/persisted";
import { useJournal } from "@/store/journalStore";

const fx = vi.hoisted(() => ({ reduced: true }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  useJournal.setState({ storage: "ok" });
});

/** A promise settled by hand: what a store / server answers, when it answers. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useSaveMorph: success only after the promise resolved", () => {
  it("a click alone never shows ✓ – saving while the promise is pending, saved only after it resolves", async () => {
    const d = deferred();
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    expect(result.current.phase).toBe("idle");
    let done!: Promise<boolean>;
    act(() => {
      done = result.current.run(() => d.promise);
    });
    expect(result.current.phase).toBe("saving");
    // a long wait: still saving, never saved
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.phase).toBe("saving");
    await act(async () => {
      d.resolve();
      await done;
    });
    expect(result.current.phase).toBe("saved");
    expect(await done).toBe(true);
  });

  it("a rejection ends in failed with the reason; nothing is reported as saved", async () => {
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(() => Promise.reject(new Error("Speicher voll")));
    });
    expect(ok).toBe(false);
    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toBe("Speicher voll");
  });

  it("resolving false is a failure as well (a write that reports it did not happen)", async () => {
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    await act(async () => {
      expect(await result.current.run(() => false)).toBe(false);
    });
    expect(result.current.phase).toBe("failed");
  });

  it("retry runs the factory again, built fresh, and can end in saved", async () => {
    let n = 0;
    const factory = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("offline");
    });
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    await act(async () => {
      await result.current.run(factory);
    });
    expect(result.current.phase).toBe("failed");
    await act(async () => {
      expect(await result.current.retry()).toBe(true);
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("saved");
    expect(result.current.error).toBeNull();
  });

  it("the answer goes to the caller at once, the picture waits the minimum (a fast write does not flash)", async () => {
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 280 }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.run(() => undefined);
    });
    expect(ok).toBe(true); // resolved immediately
    expect(result.current.phase).toBe("saving"); // …but still condensed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.phase).toBe("saved");
  });

  it("saved returns to idle after the hold; hold 0 keeps it", async () => {
    const { result } = renderHook(() => useSaveMorph({ hold: 1200, min: 0 }));
    await act(async () => {
      await result.current.run(() => undefined);
    });
    expect(result.current.phase).toBe("saved");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(result.current.phase).toBe("idle");
    const keep = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    await act(async () => {
      await keep.result.current.run(() => undefined);
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(keep.result.current.phase).toBe("saved");
  });

  it("a newer save owns the state: a slow older failure does not overwrite a newer success", async () => {
    const slow = deferred();
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(() => slow.promise);
    });
    await act(async () => {
      await result.current.run(() => undefined);
    });
    expect(result.current.phase).toBe("saved");
    await act(async () => {
      slow.reject(new Error("zu spät"));
      await first;
    });
    expect(result.current.phase).toBe("saved");
  });

  it("markDirty is quiet while a save runs", () => {
    const d = deferred();
    const { result } = renderHook(() => useSaveMorph({ hold: 0, min: 0 }));
    act(() => result.current.markDirty());
    expect(result.current.phase).toBe("dirty");
    act(() => {
      void result.current.run(() => d.promise);
    });
    act(() => result.current.markDirty());
    expect(result.current.phase).toBe("saving");
  });
});

describe("persisted(): a store that keeps nothing is not a save", () => {
  it("resolves what the write returned when the journal persists", async () => {
    useJournal.setState({ storage: "ok" });
    await expect(persisted(async () => 42)).resolves.toBe(42);
  });
  it("throws when the journal runs in memory only (storage unavailable), even though the write itself resolved", async () => {
    useJournal.setState({ storage: "unavailable" });
    await expect(persisted(async () => 1)).rejects.toBeInstanceOf(NotPersistedError);
  });
  it("passes a rejection of the write through", async () => {
    await expect(persisted(() => Promise.reject(new Error("kaputt")))).rejects.toThrow("kaputt");
  });
});

describe("SaveBadge", () => {
  it("shows nothing at rest, the condensed state while saving, ✓ + words when saved", () => {
    const { container, rerender } = render(<SaveBadge phase="idle" testId="x" />);
    expect(container.querySelector("[data-save-pill]")).toBeNull();
    rerender(<SaveBadge phase="saving" testId="x" />);
    expect(container.querySelector("[data-save-pill='saving']")).not.toBeNull();
    expect(screen.getByText("Speichert …")).toBeInTheDocument();
    rerender(<SaveBadge phase="saved" testId="x" />);
    expect(screen.getByTestId("x")).toHaveAttribute("data-save-pill", "saved");
    expect(screen.getByText("Gespeichert")).toBeInTheDocument();
  });

  it("failed: honest words, the reason for the screen reader, a retry button that calls onRetry", () => {
    const onRetry = vi.fn();
    render(<SaveBadge phase="failed" error="Speicher voll" onRetry={onRetry} testId="x" />);
    expect(screen.getByTestId("x-failed")).toBeInTheDocument();
    expect(screen.getByText("Nicht gespeichert")).toBeInTheDocument();
    expect(screen.getByTestId("x-live")).toHaveTextContent("Speichern fehlgeschlagen: Speicher voll. Erneut versuchen mit der Schaltfläche.");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("dirty is quiet unless asked for; the live region never repeats the visible words", () => {
    const { container, rerender } = render(<SaveBadge phase="dirty" testId="x" />);
    expect(container.querySelector("[data-save-pill]")).toBeNull();
    rerender(<SaveBadge phase="dirty" showDirty testId="x" />);
    expect(screen.getByText("Ungespeichert …")).toBeInTheDocument();
    expect(saveSentence("saved", null)).toBe("Speichern abgeschlossen.");
    expect(saveSentence("saving", null)).not.toMatch(/Speichert/);
  });

  it("custom words (the drawings of a trade) replace the defaults", () => {
    render(<SaveBadge phase="saved" saved="Zeichnung gespeichert" />);
    expect(screen.getByText("Zeichnung gespeichert")).toBeInTheDocument();
  });
});

describe("SaveSurface", () => {
  it("marks the card busy while saving and nothing otherwise", () => {
    const { container, rerender } = render(<SaveSurface phase="idle">x</SaveSurface>);
    const el = container.firstElementChild as HTMLElement;
    expect(el).not.toHaveAttribute("aria-busy");
    rerender(<SaveSurface phase="saving">x</SaveSurface>);
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).toHaveAttribute("data-save-surface", "saving");
    rerender(<SaveSurface phase="saved">x</SaveSurface>);
    expect(el).not.toHaveAttribute("aria-busy");
  });
});
