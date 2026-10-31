import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memo, useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoverPillFor, useHoverStore, type HoverStore } from "@/motion/HoverPill";
import { installTempo } from "@/motion/physics";

const renders: Record<string, number> = {};

const Row = memo(function Row({ id, hover }: { id: string; hover: HoverStore<string> }) {
  // counted after every committed render of this row (an effect without deps)
  useEffect(() => {
    renders[id] = (renders[id] ?? 0) + 1;
  });
  return (
    <li data-testid={`row-${id}`} className="relative" {...hover.bind(id)}>
      <HoverPillFor store={hover} id={id} group="t" />
      Zeile {id}
    </li>
  );
});

let listRenders = 0;
function List() {
  useEffect(() => {
    listRenders++;
  });
  const hover = useHoverStore<string>();
  return (
    <ul onMouseLeave={hover.clear}>
      {["a", "b", "c", "d"].map((id) => (
        <Row key={id} id={id} hover={hover} />
      ))}
    </ul>
  );
}

const pill = (id: string) => screen.getByTestId(`row-${id}`).querySelector('[aria-hidden="true"]');

describe("hover store: a hover re-renders the two pills, never the list or its rows", () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    uninstall = installTempo(window);
    listRenders = 0;
    for (const k of Object.keys(renders)) delete renders[k];
  });
  afterEach(() => uninstall());

  it("moves the pill between rows without re-rendering the list", () => {
    render(<List />);
    const list = listRenders;
    const before: Record<string, number> = { ...renders };
    fireEvent.mouseEnter(screen.getByTestId("row-a"));
    expect(pill("a")).not.toBeNull();
    fireEvent.mouseLeave(screen.getByTestId("row-a"));
    fireEvent.mouseEnter(screen.getByTestId("row-c"));
    fireEvent.mouseMove(screen.getByTestId("row-c"));
    expect(pill("c")).not.toBeNull();
    expect(listRenders).toBe(list);
    for (const id of ["a", "b", "c", "d"]) expect(renders[id]).toBe(before[id]);
    // the same binding object every time (rows stay memoised)
    fireEvent.mouseLeave(screen.getByTestId("row-c"));
  });
});
