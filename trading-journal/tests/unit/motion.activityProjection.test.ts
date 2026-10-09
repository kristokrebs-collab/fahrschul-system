import { rootProjectionNode, type IProjectionNode } from "motion-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdProjectionForHide, settleRevealedProjection } from "@/motion/activityProjection";

type FakeNode = Pick<IProjectionNode<unknown>, "isLayoutDirty" | "instance"> & Partial<IProjectionNode<unknown>>;

function fakeRoot(nodes: FakeNode[]) {
  let blocked = false;
  const root = {
    nodes: { forEach: (cb: (n: unknown) => void) => nodes.forEach(cb) },
    isUpdateBlocked: () => blocked,
    blockUpdate: vi.fn(() => (blocked = true)),
    unblockUpdate: vi.fn(() => (blocked = false)),
  };
  rootProjectionNode.current = root as unknown as IProjectionNode;
  return root;
}

const saved = rootProjectionNode.current;
afterEach(() => {
  rootProjectionNode.current = saved;
});

describe("settleRevealedProjection (keep-alive show)", () => {
  it("drops the mount dirty flag of the shown page's idle nodes only", () => {
    const page = document.createElement("div");
    const other = document.createElement("div");
    const inPage = () => page.appendChild(document.createElement("span"));
    const idle: FakeNode = { isLayoutDirty: true, instance: inPage() };
    const clean: FakeNode = { isLayoutDirty: false, instance: inPage() };
    const snapshotting: FakeNode = { isLayoutDirty: true, instance: inPage(), snapshot: {} as IProjectionNode["snapshot"] };
    const resuming: FakeNode = { isLayoutDirty: true, instance: inPage(), resumeFrom: {} as IProjectionNode };
    const animating: FakeNode = { isLayoutDirty: true, instance: inPage(), currentAnimation: {} as IProjectionNode["currentAnimation"] };
    const elsewhere: FakeNode = { isLayoutDirty: true, instance: other.appendChild(document.createElement("span")) };
    const detached: FakeNode = { isLayoutDirty: true, instance: undefined };
    fakeRoot([idle, clean, snapshotting, resuming, animating, elsewhere, detached]);

    expect(settleRevealedProjection(page)).toBe(1);
    expect(idle.isLayoutDirty).toBe(false);
    // anything that takes part in an animation right now, and every node outside the page, keeps its flag
    expect(snapshotting.isLayoutDirty).toBe(true);
    expect(resuming.isLayoutDirty).toBe(true);
    expect(animating.isLayoutDirty).toBe(true);
    expect(elsewhere.isLayoutDirty).toBe(true);
    expect(detached.isLayoutDirty).toBe(true);
  });

  it("is a no-op without a projection root or a container", () => {
    rootProjectionNode.current = undefined;
    expect(settleRevealedProjection(document.createElement("div"))).toBe(0);
    fakeRoot([{ isLayoutDirty: true, instance: document.createElement("i") }]);
    expect(settleRevealedProjection(null)).toBe(0);
  });
});

describe("holdProjectionForHide (keep-alive hide)", () => {
  it("blocks the root for the rest of the task and releases it in a microtask", async () => {
    const root = fakeRoot([]);
    holdProjectionForHide();
    holdProjectionForHide();
    expect(root.blockUpdate).toHaveBeenCalledTimes(1);
    expect(root.isUpdateBlocked()).toBe(true);
    await Promise.resolve();
    expect(root.unblockUpdate).toHaveBeenCalledTimes(1);
    expect(root.isUpdateBlocked()).toBe(false);
  });
});
