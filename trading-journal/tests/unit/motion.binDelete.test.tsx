/**
 * Runde 13 – the delete pill of the reference „The Bin Eats The Label“ (`motion/BinDelete`): the safety rule (the bin eats only AFTER the
 * confirmation), the spinner = the real deletion (never before the eating is over, never a fake success), a failure brings the pill back.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BIN_STRINGS, BinDelete, useBinDelete, useKept } from "@/motion/BinDelete";
import { binEat, binFullAt } from "@/motion/vorbild2";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

/** jsdom has no Web Animations: a stub that records every step (the pill plays its real timeline with it). */
const steps: { el: Element; keys: Keyframe[]; o: KeyframeAnimationOptions }[] = [];
const real = Element.prototype.animate;
beforeEach(() => {
  steps.length = 0;
  Element.prototype.animate = function (keys: Keyframe[] | PropertyIndexedKeyframes | null, o?: number | KeyframeAnimationOptions) {
    steps.push({ el: this, keys: (keys ?? []) as Keyframe[], o: (typeof o === "number" ? { duration: o } : (o ?? {})) as KeyframeAnimationOptions });
    return { cancel() {}, pause() {}, finished: Promise.resolve() } as unknown as Animation;
  };
});
afterEach(() => {
  Element.prototype.animate = real;
  fx.reduced = false;
});

function Harness({ remove, onDone }: { remove: () => Promise<unknown>; onDone?: () => void }) {
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState("");
  const bin = useBinDelete(remove, { done: onDone, failed: () => setMsg("Löschen fehlgeschlagen.") });
  return (
    <div>
      {asking ? (
        <span>
          Wirklich löschen?
          <button
            type="button"
            onClick={() => {
              setAsking(false);
              bin.start();
            }}
          >
            Ja, löschen
          </button>
        </span>
      ) : (
        <BinDelete bin={bin} onAsk={() => setAsking(true)}>
          Löschen
        </BinDelete>
      )}
      <p data-testid="msg">{msg}</p>
    </div>
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("<BinDelete>", () => {
  it("at rest: a pill with the bin and the word – one accessible name, the letters split for the bin", () => {
    render(<Harness remove={vi.fn(async () => {})} />);
    const b = screen.getByRole("button", { name: "Löschen" });
    expect(b).toHaveAttribute("data-bin", "idle");
    expect(b).toHaveTextContent(/^Löschen$/);
    expect(b.querySelectorAll("[aria-hidden] .inline-block")).toHaveLength(7);
    expect(b.className).toContain("rounded-full");
  });

  it("a tap only asks – nothing is eaten, nothing deleted", async () => {
    const remove = vi.fn(async () => {});
    render(<Harness remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(screen.getByText("Wirklich löschen?")).toBeInTheDocument();
    await pause(50);
    expect(remove).not.toHaveBeenCalled();
    expect(steps).toHaveLength(0);
  });

  it("„Ja, löschen“: the bin eats the word first, the REAL deletion runs with the spinner, the ring closes, then `done`", async () => {
    let answer: () => void = () => {};
    const remove = vi.fn(() => new Promise<void>((r) => (answer = r)));
    const onDone = vi.fn();
    render(<Harness remove={remove} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    const b = await screen.findByRole("button", { name: "Löschen" });
    await waitFor(() => expect(b).toHaveAttribute("data-bin", "eat"));
    expect(b).toHaveAttribute("aria-busy", "true");
    // the letters fly one after another (85 ms apart) – and nothing is deleted while the bin eats
    await pause(binFullAt(7) - 200);
    expect(remove).not.toHaveBeenCalled();
    const flights = steps.filter((s) => s.keys.length === 5 && s.o.duration === binEat.flight);
    expect(flights.length).toBeGreaterThanOrEqual(5);
    // the pill turns into a disc (a clip of the face – the button keeps its box), then the spinner = the deletion
    await waitFor(() => expect(b).toHaveAttribute("data-bin", "spin"), { timeout: 2000 });
    expect(steps.some((s) => String(s.keys[1]?.clipPath ?? "").includes("inset(0px"))).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(BIN_STRINGS.busy);
    // the spinner turns as long as the deletion has not answered – no fake success
    await pause(binEat.spinMin + 300);
    expect(b).toHaveAttribute("data-bin", "spin");
    expect(onDone).not.toHaveBeenCalled();
    act(() => answer());
    await waitFor(() => expect(b).toHaveAttribute("data-bin", "done"));
    expect(screen.getByRole("status")).toHaveTextContent(BIN_STRINGS.done);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(remove).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("a failed deletion brings the pill back with its word and lets the caller say why – no ✓, no `done`", async () => {
    fx.reduced = true;
    const remove = vi.fn(async () => {
      throw new Error("nope");
    });
    const onDone = vi.fn();
    render(<Harness remove={remove} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    await waitFor(() => expect(screen.getByTestId("msg")).toHaveTextContent("Löschen fehlgeschlagen."));
    const b = screen.getByRole("button", { name: "Löschen" });
    await waitFor(() => expect(b).toHaveAttribute("data-bin", "idle"));
    expect(b).not.toHaveAttribute("aria-busy");
    expect(onDone).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("confirmed is confirmed: a pill that leaves before its spinner still deletes (once) and the caller hears it", async () => {
    const remove = vi.fn(async () => {});
    const onDone = vi.fn();
    const { unmount } = render(<Harness remove={remove} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Löschen" })).toHaveAttribute("data-bin", "eat"));
    unmount();
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await pause(50);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a completed hold confirms by itself (no question)", async () => {
    fx.reduced = true;
    const remove = vi.fn(async () => {});
    render(<Harness remove={remove} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Löschen" }), { button: 0 });
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(screen.queryByText("Wirklich löschen?")).toBeNull();
  });
});

describe("useKept", () => {
  function Show({ value, keep }: { value?: string; keep: boolean }) {
    return <p data-testid="v">{useKept(value, keep) ?? "–"}</p>;
  }
  it("keeps the last value while a run goes on, lets go after", () => {
    const { rerender } = render(<Show value="A" keep={false} />);
    rerender(<Show value={undefined} keep={true} />);
    expect(screen.getByTestId("v")).toHaveTextContent("A");
    rerender(<Show value={undefined} keep={false} />);
    expect(screen.getByTestId("v")).toHaveTextContent("–");
  });
});
