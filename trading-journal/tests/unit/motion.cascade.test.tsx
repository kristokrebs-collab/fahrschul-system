import { AnimatePresence, LayoutGroupContext, motion } from "motion/react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { memo, useContext, useEffect, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { LayoutCascade, NoLayoutCascade } from "@/motion/NoLayoutCascade";

interface Count {
  n: number;
  ctx: unknown[];
}
/** Render counts per probe id (module scope: the probe never writes to its props). */
const counts = new Map<string, Count>();
const counter = (id: string): Count => {
  let c = counts.get(id);
  if (!c) counts.set(id, (c = { n: 0, ctx: [] }));
  return c;
};

/**
 * Reads the layout-group context exactly like every `motion` component does (`useLayoutId`) and counts its renders:
 * a changed context value re-renders every such consumer – that is the app-wide cascade. Memoised with stable props,
 * so only a context change (never the host's own re-render) counts.
 */
const Consumer = memo(function Consumer({ id }: { id: string }) {
  const ctx = useContext(LayoutGroupContext);
  // counted after every render (no deps): the component is memoised, so each effect run is one render
  useEffect(() => {
    const c = counter(id);
    c.n++;
    c.ctx.push(ctx);
  });
  return <span data-testid={id} />;
});

/** A presence whose only child leaves with a short exit when `on` is false. */
function Leaf({ on }: { on: boolean }) {
  return (
    <AnimatePresence>
      {on && <motion.span key="leaf" data-testid="leaf" initial={false} exit={{ opacity: 0, transition: { duration: 0.03 } }} />}
    </AnimatePresence>
  );
}

function Host({ children, wrap = (n: ReactNode) => n }: { children: (on: boolean) => ReactNode; wrap?: (n: ReactNode) => ReactNode }) {
  const [on, setOn] = useState(true);
  return (
    <MotionRoot>
      <button type="button" onClick={() => setOn(false)}>
        weg
      </button>
      {wrap(children(on))}
    </MotionRoot>
  );
}

async function leaveAndSettle(): Promise<void> {
  act(() => screen.getByRole("button", { name: "weg" }).click());
  await waitFor(() => expect(screen.queryByTestId("leaf")).toBeNull(), { timeout: 1500 });
  // the group's forceRender is deferred to the end of the frame: give it a few frames
  await act(() => new Promise((r) => setTimeout(r, 120)));
}

describe("MotionRoot layout groups", () => {
  it("a finished exit does NOT re-render group consumers outside the presence (no app-wide cascade)", async () => {
    const count = counter("root-consumer");
    render(
      <Host>
        {(on) => (
          <>
            <Leaf on={on} />
            <Consumer id="root-consumer" />
          </>
        )}
      </Host>,
    );
    const before = count.n;
    await leaveAndSettle();
    expect(count.n).toBe(before);
    // no layout group at the root: no id (layoutIds stay unprefixed), no shared projection group (a layout change never
    // measures unrelated nodes) and no forceRender
    const ctx = count.ctx[0] as { id?: string; group?: unknown; forceRender?: unknown };
    expect(ctx.id).toBeUndefined();
    expect(ctx.group).toBeUndefined();
    expect(ctx.forceRender).toBeUndefined();
  });

  it("LayoutCascade: a scoped group – its consumers re-render once the exit finished, consumers outside it do not", async () => {
    const inside = counter("scoped-inside");
    const outside = counter("scoped-outside");
    render(
      <Host>
        {(on) => (
          <>
            <Consumer id="scoped-outside" />
            <LayoutCascade>
              <Leaf on={on} />
              <Consumer id="scoped-inside" />
            </LayoutCascade>
          </>
        )}
      </Host>,
    );
    const insideBefore = inside.n;
    const outsideBefore = outside.n;
    await leaveAndSettle();
    expect(inside.n).toBeGreaterThan(insideBefore);
    expect(outside.n).toBe(outsideBefore);
    // the scoped group owns its projection group (the root has none) and keeps layoutIds unprefixed
    const root = outside.ctx[0] as { id?: string; group?: unknown };
    const scoped = inside.ctx[0] as { id?: string; group?: unknown; forceRender?: unknown };
    expect(root.group).toBeUndefined();
    expect(scoped.group).toBeDefined();
    expect(scoped.id).toBeUndefined();
    expect(typeof scoped.forceRender).toBe("function");
  });

  it("NoLayoutCascade inside a LayoutCascade drops the scoped forceRender for its presences", async () => {
    const inside = counter("nocascade-inside");
    render(
      <Host>
        {(on) => (
          <LayoutCascade>
            <NoLayoutCascade>
              <Leaf on={on} />
            </NoLayoutCascade>
            <Consumer id="nocascade-inside" />
          </LayoutCascade>
        )}
      </Host>,
    );
    const before = inside.n;
    await leaveAndSettle();
    expect(inside.n).toBe(before);
  });

  it("a layout change measures only the nodes that changed – siblings join in only inside a LayoutCascade", async () => {
    const measured: string[] = [];
    /** A memoised `layout` node that never re-renders on its own: only a group can make it measure. */
    const Still = memo(function Still({ id }: { id: string }) {
      return <motion.div layout data-testid={id} onLayoutMeasure={() => measured.push(id)} />;
    });
    function Mover({ dep }: { dep: number }) {
      return <motion.div layout layoutDependency={dep} onLayoutMeasure={() => measured.push(`mover-${dep}`)} />;
    }
    function Scene({ scoped }: { scoped: boolean }) {
      const [dep, setDep] = useState(0);
      const body = (
        <>
          <button type="button" onClick={() => setDep((d) => d + 1)}>
            weiter
          </button>
          <Mover dep={dep} />
          <Still id="still" />
        </>
      );
      return <MotionRoot>{scoped ? <LayoutCascade>{body}</LayoutCascade> : body}</MotionRoot>;
    }
    const step = async () => {
      measured.length = 0;
      act(() => screen.getByRole("button", { name: "weiter" }).click());
      await act(() => new Promise((r) => setTimeout(r, 50)));
      return [...measured];
    };

    const { unmount } = render(<Scene scoped={false} />);
    await step(); // the first projection update after mount
    const root = await step();
    expect(root).toContain("mover-2");
    expect(root).not.toContain("still");
    unmount();

    render(<Scene scoped />);
    await step();
    const scoped = await step();
    expect(scoped).toContain("mover-2");
    expect(scoped).toContain("still");
  });
});
