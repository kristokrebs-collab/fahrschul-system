import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACK_CHECK_MS, BACK_LAND_TIMEOUT_MS, BACK_STATE_KEY, SCROLL_MODE_RESTORE_MS, backStackState, consumeHandledHashChange, depthOf, installBackStack, openBackEntry, pushPageEntry, replaceEntryURL, type BackEnv } from "@/store/backStack";

/**
 * A simulated session history (the browser's): `go` is asynchronous like the real one – queued until `land()` – and
 * every traversal fires `popstate`; `userBack()` is the system back button (a traversal the app did not start).
 */
function createHistory(url = "https://journal.test/#overview") {
  const list: { url: string; state: unknown; mode?: ScrollRestoration }[] = [{ url, state: null, mode: "auto" }];
  let index = 0;
  const queued: number[] = [];
  const listeners = new Set<() => void>();
  const log: string[] = [];
  const resolve = (u: string | URL | null | undefined) => {
    if (u == null) return list[index]!.url;
    const s = String(u);
    return s.startsWith("#") ? list[index]!.url.replace(/#.*$/, "") + s : s;
  };
  const clone = (s: unknown) => (s == null ? null : JSON.parse(JSON.stringify(s)));
  const traverse = (delta: number) => {
    const to = Math.max(0, Math.min(list.length - 1, index + delta));
    if (to === index) return;
    index = to;
    for (const l of [...listeners]) l();
  };
  const env: BackEnv = {
    history: {
      get state() {
        return list[index]!.state;
      },
      // per entry, like the browser's; a pushed entry inherits the current one's
      get scrollRestoration() {
        return list[index]!.mode ?? "auto";
      },
      set scrollRestoration(m: ScrollRestoration) {
        list[index]!.mode = m;
      },
      pushState(state: unknown, _t: string, u?: string | URL | null) {
        const next = { url: resolve(u), state: clone(state), mode: list[index]!.mode };
        list.splice(index + 1);
        list.push(next);
        index += 1;
        log.push(`push ${depthOf(next.state)}`);
      },
      replaceState(state: unknown, _t: string, u?: string | URL | null) {
        list[index] = { url: resolve(u), state: clone(state), mode: list[index]!.mode };
        log.push(`replace ${depthOf(state)}`);
      },
      go(delta?: number) {
        queued.push(delta ?? 0);
        log.push(`go ${delta}`);
      },
    },
    location: {
      get href() {
        return list[index]!.url;
      },
    },
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
  };
  return {
    env,
    log,
    /** the system back button */
    userBack: () => traverse(-1),
    userForward: () => traverse(1),
    /** delivers the app's own queued traversals (`history.go`) */
    land: () => {
      while (queued.length) traverse(queued.shift()!);
    },
    /** the browser ignores the queued traversals */
    drop: () => queued.splice(0),
    get index() {
      return index;
    },
    get length() {
      return list.length;
    },
    get depth() {
      return depthOf(list[index]!.state);
    },
    entries: () => list.map((e) => `${e.url.replace(/^.*#/, "#")}${depthOf(e.state) ? `+${depthOf(e.state)}` : ""}`),
    modes: () => list.map((e) => e.mode ?? "auto"),
    setUrlOfCurrent: (u: string) => {
      list[index] = { ...list[index]!, url: resolve(u) };
    },
  };
}

/** Lets the layer's microtask reconcile run. */
const settle = async () => {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
};

/** Every dialog a test made: closed after each test (the layer's session list is module state). */
const made: { close: () => void }[] = [];

/** A dialog session: `close` is its close path (what back runs), `guard` keeps it open (unsaved input). */
function dialog(name: string, calls: string[], opts: { guard?: () => boolean } = {}) {
  let release: (() => void) | null = null;
  const d = {
    open: () => {
      release = openBackEntry(() => {
        calls.push(`back ${name}`);
        if (opts.guard?.()) return; // "Änderungen verwerfen?" – stays open
        d.close();
      });
    },
    /** any close path (×, Speichern, swipe, Verwerfen) */
    close: () => {
      release?.();
      release = null;
    },
    get isOpen() {
      return release !== null;
    },
  };
  made.push(d);
  return d;
}

describe("backStack", () => {
  let sim: ReturnType<typeof createHistory>;
  let uninstall: () => void;
  let calls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    sim = createHistory();
    uninstall = installBackStack(sim.env);
    calls = [];
  });
  afterEach(() => {
    uninstall();
    for (const d of made.splice(0)) d.close();
    vi.useRealTimers();
  });

  it("an open dialog owns one same-URL entry; closing it another way consumes it with an own back nobody reacts to", async () => {
    const editor = dialog("editor", calls);
    editor.open();
    await settle();
    expect(sim.entries()).toEqual(["#overview", "#overview+1"]);
    expect(sim.env.history.state).toEqual({ [BACK_STATE_KEY]: 1 });

    editor.close(); // × / Speichern / swipe
    await settle();
    expect(sim.log).toEqual(["push 1", "go -1"]);
    expect(backStackState().pending).toBe(1);
    sim.land();
    expect(sim.index).toBe(0);
    expect(calls).toEqual([]); // the own traversal closes nothing and is no back press
    expect(backStackState()).toEqual({ have: 0, want: 0, pending: 0 });
    // its hashchange (if the URL differed) would be the layer's, not the router's
    expect(consumeHandledHashChange(sim.env.location.href)).toBe(true);
    expect(consumeHandledHashChange(sim.env.location.href)).toBe(false);
  });

  it("back closes the topmost dialog through its close path and leaves the history alone", async () => {
    const detail = dialog("detail", calls);
    detail.open();
    await settle();
    sim.userBack();
    expect(calls).toEqual(["back detail"]);
    expect(detail.isOpen).toBe(false);
    await settle();
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.log).toEqual(["push 1"]); // no own back: the user's back already took the entry
    expect(backStackState()).toEqual({ have: 0, want: 0, pending: 0 });
    // the next back is a page-level one (the router's hashchange)
    sim.userBack();
    expect(calls).toEqual(["back detail"]);
  });

  it("a guard that keeps the dialog open gets the entry back: the next back asks again, Verwerfen consumes it", async () => {
    let dirty = true;
    const editor = dialog("editor", calls, { guard: () => dirty });
    editor.open();
    await settle();
    sim.userBack(); // → "Änderungen verwerfen?"
    expect(calls).toEqual(["back editor"]);
    expect(editor.isOpen).toBe(true);
    expect(sim.depth).toBe(0);
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.entries()).toEqual(["#overview", "#overview+1"]); // re-pushed
    // "Weiter bearbeiten" (nothing happens to the history), back again → asks again
    sim.userBack();
    expect(calls).toEqual(["back editor", "back editor"]);
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.depth).toBe(1);
    // "Verwerfen" → the programmatic close consumes the re-pushed entry
    dirty = false;
    editor.close();
    await settle();
    sim.land();
    expect(sim.index).toBe(0);
    expect(calls).toEqual(["back editor", "back editor"]);
    expect(sim.log).toEqual(["push 1", "push 1", "push 1", "go -1"]);
    expect(backStackState()).toEqual({ have: 0, want: 0, pending: 0 });
  });

  it("nested dialogs: back closes the inner one, then the outer one", async () => {
    const editor = dialog("editor", calls);
    const setup = dialog("setup", calls);
    editor.open();
    await settle();
    setup.open(); // + Neue Grundlage inside the editor
    await settle();
    expect(sim.entries()).toEqual(["#overview", "#overview+1", "#overview+2"]);
    sim.userBack();
    expect(calls).toEqual(["back setup"]);
    expect(editor.isOpen).toBe(true);
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.depth).toBe(1);
    sim.userBack();
    expect(calls).toEqual(["back setup", "back editor"]);
    expect(editor.isOpen).toBe(false);
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.log).toEqual(["push 1", "push 2"]);
    expect(sim.index).toBe(0);
  });

  it("nested: the inner dialog closed by Speichern consumes only its own entry", async () => {
    const editor = dialog("editor", calls);
    const setup = dialog("setup", calls);
    editor.open();
    setup.open();
    await settle();
    expect(sim.log).toEqual(["push 1", "push 2"]);
    setup.close();
    await settle();
    sim.land();
    expect(sim.depth).toBe(1);
    sim.userBack();
    expect(calls).toEqual(["back editor"]);
  });

  it("a hand-off in one tick keeps the entry (detail → editor); an effect replay pushes once", async () => {
    const detail = dialog("detail", calls);
    const editor = dialog("editor", calls);
    detail.open();
    await settle();
    detail.close();
    editor.open(); // same commit
    await settle();
    expect(sim.log).toEqual(["push 1"]);
    sim.userBack();
    expect(calls).toEqual(["back editor"]);

    // StrictMode: open → release → open within one commit
    sim.log.length = 0;
    const d = dialog("strict", calls);
    d.open();
    d.close();
    d.open();
    await settle();
    expect(sim.log).toEqual(["push 1"]);
  });

  it("no history growth over many open/close cycles, whichever way they close", async () => {
    for (let i = 0; i < 40; i += 1) {
      const d = dialog(`d${i}`, calls);
      d.open();
      await settle();
      if (i % 2) {
        d.close();
        await settle();
        sim.land();
      } else {
        sim.userBack();
        vi.advanceTimersByTime(BACK_CHECK_MS + 1);
      }
    }
    expect(sim.index).toBe(0);
    expect(sim.length).toBeLessThanOrEqual(2); // the page entry + at most one forward entry
    expect(backStackState()).toEqual({ have: 0, want: 0, pending: 0 });
  });

  it("no loop: a dialog that can never close costs one push per back press, and the timers end", async () => {
    const stuck = dialog("stuck", calls, { guard: () => true });
    stuck.open();
    await settle();
    for (let i = 0; i < 5; i += 1) {
      sim.userBack();
      vi.advanceTimersByTime(BACK_CHECK_MS + 1);
      await settle();
    }
    expect(calls).toHaveLength(5);
    expect(sim.log.filter((l) => l.startsWith("go"))).toEqual([]);
    expect(sim.log.filter((l) => l.startsWith("push"))).toHaveLength(6);
    expect(sim.length).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a page switch from inside a dialog takes its entry; back then returns to the page the dialog was on", async () => {
    const nav = dialog("nav", calls);
    nav.open();
    await settle();
    pushPageEntry("#trades"); // command navigation link: navigate(…) then close
    nav.close();
    await settle();
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.entries()).toEqual(["#overview", "#trades"]);
    expect(sim.log).toEqual(["push 1", "replace 0"]);
    sim.userBack();
    expect(sim.env.location.href).toMatch(/#overview$/);
    expect(calls).toEqual([]);
    // a morph dialog that closes first, then navigates (Alle Trades →) ends the same way
    const morph = dialog("morph", calls);
    morph.open();
    await settle();
    morph.close();
    pushPageEntry("#trades?setup=s_bo");
    await settle();
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.entries()).toEqual(["#overview", "#trades?setup=s_bo"]);
  });

  it("a page switch from inside a dialog that stays open puts the dialog's entry back on top of the new page", async () => {
    const d = dialog("d", calls);
    d.open();
    await settle();
    pushPageEntry("#trades");
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    expect(sim.entries()).toEqual(["#overview", "#trades", "#trades+1"]);
    sim.userBack();
    expect(calls).toEqual(["back d"]);
  });

  it("a page switch over nested dialog entries steps down to the page entry first, then pushes the page", async () => {
    const a = dialog("a", calls);
    const b = dialog("b", calls);
    a.open();
    b.open();
    await settle();
    pushPageEntry("#settings");
    a.close();
    b.close();
    await settle();
    expect(sim.log).toEqual(["push 1", "push 2", "go -2"]);
    sim.land();
    expect(sim.entries()).toEqual(["#overview", "#settings"]);
    // a page switch while an own back is under way waits for it
    const c = dialog("c", calls);
    c.open();
    await settle();
    c.close();
    await settle();
    pushPageEntry("#setups");
    expect(sim.entries()).toEqual(["#overview", "#settings", "#settings+1"]);
    sim.land();
    expect(sim.entries()).toEqual(["#overview", "#settings", "#setups"]);
  });

  it("replaceEntryURL keeps a dialog entry's marker", async () => {
    const d = dialog("d", calls);
    d.open();
    await settle();
    replaceEntryURL("#trades?q=delta");
    expect(sim.env.history.state).toEqual({ [BACK_STATE_KEY]: 1 });
    // back to the page entry (older URL): its hashchange belongs to closing the dialog
    sim.userBack();
    expect(calls).toEqual(["back d"]);
    expect(consumeHandledHashChange(sim.env.location.href)).toBe(true);
  });

  it("a back that goes past the dialog's page entry is a page switch as well (the router sees it)", async () => {
    pushPageEntry("#trades");
    const d = dialog("d", calls);
    d.open();
    await settle();
    expect(sim.entries()).toEqual(["#overview", "#trades", "#trades+1"]);
    // long-press history: two entries back at once
    sim.env.history.go(-2);
    sim.land();
    expect(calls).toEqual(["back d"]);
    expect(consumeHandledHashChange(sim.env.location.href)).toBe(false);
  });

  it("forward into a closed dialog's entry steps back again", async () => {
    const d = dialog("d", calls);
    d.open();
    await settle();
    sim.userBack();
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    sim.userForward();
    await settle();
    expect(sim.log.at(-1)).toBe("go -1");
    sim.land();
    expect(sim.index).toBe(0);
    expect(calls).toEqual(["back d"]);
  });

  it("a traversal the browser drops is waited for only BACK_LAND_TIMEOUT_MS and never retried in a loop", async () => {
    const d = dialog("d", calls);
    d.open();
    await settle();
    d.close();
    await settle();
    expect(sim.log).toEqual(["push 1", "go -1"]);
    sim.drop();
    vi.advanceTimersByTime(BACK_LAND_TIMEOUT_MS + 1);
    await settle();
    expect(sim.log).toEqual(["push 1", "go -1"]);
    expect(backStackState().pending).toBe(0);
    // the next dialog works normally again (it takes over the entry the dropped back left behind)
    const e = dialog("e", calls);
    e.open();
    await settle();
    expect(sim.log).toEqual(["push 1", "go -1"]);
    expect(sim.depth).toBe(1);
    sim.userBack();
    expect(calls).toEqual(["back e"]);
  });

  it("a reload on a dialog entry steps back to the page entry", async () => {
    uninstall();
    const reloaded = createHistory();
    reloaded.env.history.pushState({ [BACK_STATE_KEY]: 1 }, "");
    reloaded.log.length = 0;
    uninstall = installBackStack(reloaded.env);
    expect(reloaded.log).toEqual(["go -1"]);
    reloaded.land();
    expect(reloaded.index).toBe(0);
    expect(backStackState()).toEqual({ have: 0, want: 0, pending: 0 });
  });

  it("the page entry scrolls as `manual` while dialogs are open (no older scroll restored over it); its mode comes back after the last close", async () => {
    let dirty = true;
    const editor = dialog("editor", calls, { guard: () => dirty });
    editor.open();
    await settle();
    expect(sim.modes()).toEqual(["manual", "manual"]);
    // back with the guard: re-pushed, the page entry stays held
    sim.userBack();
    vi.advanceTimersByTime(BACK_CHECK_MS + 1);
    vi.advanceTimersByTime(SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.modes()[0]).toBe("manual");
    // Verwerfen → own back → the page entry gets "auto" back once the traversal is over
    dirty = false;
    editor.close();
    await settle();
    sim.land();
    expect(sim.modes()[0]).toBe("manual");
    vi.advanceTimersByTime(SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.modes()[0]).toBe("auto");
    // a back press that closes the last dialog hands it back as well
    const detail = dialog("detail", calls);
    detail.open();
    await settle();
    sim.userBack();
    await settle();
    vi.advanceTimersByTime(SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.modes()[0]).toBe("auto");
    // nested: held until the outer one is gone too
    const a = dialog("a", calls);
    const b = dialog("b", calls);
    a.open();
    b.open();
    await settle();
    b.close();
    await settle();
    sim.land();
    vi.advanceTimersByTime(SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.modes()[0]).toBe("manual");
    a.close();
    await settle();
    sim.land();
    vi.advanceTimersByTime(SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.modes()[0]).toBe("auto");
  });

  it("a page switch from inside a dialog: the new page entry scrolls as `auto` again", async () => {
    const nav = dialog("nav", calls);
    nav.open();
    await settle();
    pushPageEntry("#trades");
    nav.close();
    await settle();
    vi.advanceTimersByTime(BACK_CHECK_MS + SCROLL_MODE_RESTORE_MS + 1);
    expect(sim.entries()).toEqual(["#overview", "#trades"]);
    expect(sim.modes()[1]).toBe("auto");
  });

  it("uninstall hands the page entry its mode back at once", async () => {
    const d = dialog("d", calls);
    d.open();
    await settle();
    expect(sim.modes()[0]).toBe("manual");
    sim.userBack();
    uninstall();
    expect(sim.modes()[0]).toBe("auto");
  });

  it("not installed: sessions touch no history", async () => {
    uninstall();
    const d = dialog("d", calls);
    d.open();
    await settle();
    d.close();
    await settle();
    expect(sim.log).toEqual([]);
  });

  it("a refused pushState switches the layer off instead of throwing", async () => {
    sim.env.history.pushState = () => {
      throw new DOMException("refused", "SecurityError");
    };
    const d = dialog("d", calls);
    d.open();
    await expect(settle()).resolves.toBeUndefined();
    d.close();
    await settle();
    expect(sim.log).toEqual([]);
  });
});
