import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "@/motion/useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

/** A live-ish MediaQueryList stub: `set(matches)` flips it and fires `change` like a real list. */
function stubLists() {
  const lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  const subscribe = vi.fn();
  const matchMedia = vi.fn((query: string) => {
    let l = lists.get(query);
    if (!l) lists.set(query, (l = { matches: false, listeners: new Set() }));
    const list = l;
    return {
      get matches() {
        return list.matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => {
        subscribe();
        list.listeners.add(cb);
      },
      removeEventListener: (_: string, cb: () => void) => list.listeners.delete(cb),
    } as unknown as MediaQueryList;
  });
  vi.stubGlobal("matchMedia", matchMedia);
  const set = (query: string, matches: boolean) => {
    const l = lists.get(query)!;
    l.matches = matches;
    for (const cb of [...l.listeners]) cb();
  };
  return { matchMedia, subscribe, set };
}

describe("useMediaQuery", () => {
  it("one list and one listener per query for any number of components and renders; follows changes", () => {
    const { matchMedia, subscribe, set } = stubLists();
    function Probe({ id }: { id: string }) {
      const hover = useMediaQuery("(hover: hover)");
      const [n, setN] = useState(0);
      return (
        <button type="button" data-testid={id} onClick={() => setN(n + 1)}>
          {hover ? "hover" : "touch"} {n}
        </button>
      );
    }
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("touch 0");
    for (let i = 0; i < 5; i++) act(() => screen.getByTestId("a").click());
    expect(screen.getByTestId("a")).toHaveTextContent("touch 5");
    // re-renders neither create lists nor re-subscribe
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    act(() => set("(hover: hover)", true));
    expect(screen.getByTestId("a")).toHaveTextContent("hover 5");
    expect(screen.getByTestId("b")).toHaveTextContent("hover 0");
  });
});
