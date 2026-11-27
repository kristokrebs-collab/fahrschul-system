/**
 * Manual trade links (Review F04): group two trades of one idea (shared groupId), mark a hedge (hedgeOf), leave the
 * link again – written from the trade detail, folded by `groupTrades` like the automatic hedge detection.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { groupTrades } from "@/domain/grouping";
import type { Trade } from "@/domain/types";
import { GroupLinksSection } from "@/journal/grouping/GroupLinksSection";
import { applyLinkPatch, groupPatches, hedgePatch, linkCandidates, unlinkPatch } from "@/journal/grouping/links";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { enriched, mkTrade, settings } from "./domain.fixtures";

const A = mkTrade({ id: "a", date: "2026-05-01T10:00", pair: "BTC/USDT", side: "long", entry: 100, exit: 110, size: 100 });
const B = mkTrade({ id: "b", date: "2026-05-03T10:00", pair: "BINANCE:BTCUSDT.P", side: "long", entry: 105, exit: 112, size: 100 });
const C = mkTrade({ id: "c", date: "2026-05-02T09:00", pair: "BTC/USDT", side: "short", entry: 108, exit: 104, size: 100 });
const FAR = mkTrade({ id: "far", date: "2026-07-01T10:00", pair: "BTC/USDT", side: "long", entry: 100, exit: 101, size: 100 });
const ETH = mkTrade({ id: "eth", date: "2026-05-01T11:00", pair: "ETH/USDT", side: "long", entry: 10, exit: 11, size: 10 });

describe("links (pure)", () => {
  it("candidates: same pair (any notation), ± 14 days, nearest first", () => {
    expect(linkCandidates(A, [A, B, C, FAR, ETH]).map((t) => t.id)).toEqual(["c", "b"]);
  });

  it("group / hedge / unlink patches fold into groupTrades", () => {
    const g = groupPatches(A, B);
    expect(g).toHaveLength(2);
    const gid = g[0]!.set.groupId!;
    expect(gid).toMatch(/^grp_/);
    expect(groupPatches({ id: "x", groupId: "grp_1" }, { id: "y" })).toEqual([{ id: "y", set: { groupId: "grp_1" } }]);
    const now = "2026-05-04T00:00:00.000Z";
    const linked = [applyLinkPatch(A, g[0]!, now), applyLinkPatch(B, g[1]!, now), C];
    const res = groupTrades(linked, { hedges: false });
    expect(res.groupOf.get("a")?.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(res.groupOf.get("a")?.kind).toBe("group");
    expect(hedgePatch(A, B)).toBeNull();
    const h = hedgePatch(C, A)!;
    const hedged = groupTrades([A, applyLinkPatch(C, h, now)], { hedges: false });
    expect(hedged.groupOf.get("c")?.kind).toBe("hedge");
    const u = unlinkPatch({ id: "a", groupId: gid, hedgeOf: "c" })!;
    expect(applyLinkPatch({ ...A, groupId: gid, hedgeOf: "c" } as Trade, u, now)).not.toHaveProperty("groupId");
    expect(unlinkPatch(A)).toBeNull();
  });
});

describe("Gruppe & Hedge in the detail", () => {
  it("groups with a nearby trade, marks a hedge, leaves the group again", async () => {
    const saved: Trade[] = [];
    const saveTrade = vi.fn(async (t: Trade) => {
      saved.push(t);
      useJournal.setState((s) => ({ trades: s.trades.map((x) => (x.id === t.id ? t : x)) }));
    });
    useJournal.setState({ trades: [A, B, C, FAR, ETH], settings: settings(), loaded: true, mode: "local", saveTrade } as never);
    const all = () => enriched(useJournal.getState().trades);
    const { rerender } = render(
      <MotionRoot>
        <GroupLinksSection trade={all()[0]!} all={all()} currency="USDT" />
      </MotionRoot>,
    );
    expect(screen.getByTestId("group-status")).toHaveTextContent("Mit keinem Trade verbunden.");
    const rows = screen.getAllByTestId("group-candidate");
    expect(rows.map((r) => r.dataset.id)).toEqual(["c", "b"]);
    // the short C may hedge A, the long B may not
    expect(within(rows[0]!).getByTestId("group-hedge")).toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId("group-hedge")).toBeNull();
    fireEvent.click(within(rows[1]!).getByTestId("group-join"));
    await waitFor(() => expect(saved).toHaveLength(2));
    const gid = saved[0]!.groupId;
    expect(gid).toMatch(/^grp_/);
    expect(saved.map((t) => [t.id, t.groupId])).toEqual([
      ["a", gid],
      ["b", gid],
    ]);
    rerender(
      <MotionRoot>
        <GroupLinksSection trade={all()[0]!} all={all()} currency="USDT" />
      </MotionRoot>,
    );
    await waitFor(() => expect(screen.getByTestId("group-status")).toHaveTextContent("In einer Gruppe mit 1 Trade"));
    fireEvent.click(screen.getByTestId("group-unlink"));
    await waitFor(() => expect(saved).toHaveLength(3));
    expect(saved[2]).not.toHaveProperty("groupId");
  });
});
