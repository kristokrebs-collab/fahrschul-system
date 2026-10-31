/**
 * Playbook revisions (F45, pure): a playbook file may carry a stable `id` and a revision number `rev`. When the same playbook comes
 * in again with a higher `rev`, the reader sees it as the NEWER FASSUNG of a draft he already has – with what changed in plain
 * language – and decides: take it as a new version of that draft, or as a separate draft. Nothing here updates anything by itself:
 * there is no subscription, no server and no push; a new revision is a new file the person reads in.
 *
 * Also the checklist: a playbook's manual pre-trade checks become the checklist of a journal setup (Entscheidungsgrundlage) on request,
 * so they can be ticked on trades and show up in the setup's rule-adherence figures.
 */
import { diffConfigs } from "../lab/versions";
import { customKey, summarizeCustom } from "../lab/rules/tree";
import type { CustomConfig } from "../lab/rules/types";
import type { Setup } from "../types";
import { EMPTY_AUTO, withStrategy } from "../strategy/types";
import type { Playbook } from "./index";

/** A playbook's stable id ("pb-" + lower-case letters and digits). */
export const PLAYBOOK_ID_RE = /^pb-[a-z0-9]{6,30}$/;

/** What a draft remembers about the playbook it came from. */
export interface PlaybookLink {
  /** `id` of the playbook, `null` = a one-off file without one */
  pid: string | null;
  /** the revision the draft took over */
  rev: number | null;
  /** `customKey` of the rules as they were taken over */
  key: string;
}

export type PlaybookRelation =
  /** no id on one of the sides: nothing to relate */
  | { kind: "none" }
  /** another playbook */
  | { kind: "other" }
  /** the file is a newer revision of the draft's playbook */
  | { kind: "newer"; from: number; to: number; diff: string[]; localEdits: boolean }
  /** the same revision with the same rules */
  | { kind: "same"; rev: number }
  /** the same revision number but other rules: the author changed them without a new number, or the file was edited */
  | { kind: "same-rev-changed"; rev: number; diff: string[]; localEdits: boolean }
  /** an older revision than the draft has */
  | { kind: "older"; from: number; to: number; diff: string[]; localEdits: boolean };

/**
 * How the file `next` relates to a draft (`link` = what the draft took over, `config` = its rules NOW). `diff` is what would change in the
 * draft's rules if the file were taken over; `localEdits` says the draft's rules differ from what was taken over (the reader changed them).
 */
export function playbookRelation(link: PlaybookLink | null | undefined, config: CustomConfig, next: Pick<Playbook, "id" | "rev" | "key" | "config">): PlaybookRelation {
  if (!link || !link.pid || link.rev == null || !next.id || next.rev == null) return { kind: "none" };
  if (link.pid !== next.id) return { kind: "other" };
  const localEdits = customKey(config) !== link.key;
  // the draft's own name is not part of the playbook's rules: compare with it, not with the title in the file
  const diff = diffConfigs(config, { ...next.config, name: config.name });
  if (next.rev > link.rev) return { kind: "newer", from: link.rev, to: next.rev, diff, localEdits };
  if (next.rev < link.rev) return { kind: "older", from: link.rev, to: next.rev, diff, localEdits };
  return next.key === link.key ? { kind: "same", rev: next.rev } : { kind: "same-rev-changed", rev: next.rev, diff, localEdits };
}

/** A new playbook id (the random source is the caller's, so the function stays pure). */
export function newPlaybookId(random: () => number): string {
  let s = "";
  while (s.length < 10) s += Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
  const id = `pb-${s.slice(0, 10)}`;
  return PLAYBOOK_ID_RE.test(id) ? id : "pb-0000000000";
}

/** The revision a draft's next export gets: 1 for a first export, the same number while the rules are unchanged, else one more. */
export function nextRevision(exported: { rev: number; key: string } | null | undefined, key: string): number {
  if (!exported) return 1;
  return exported.key === key ? exported.rev : exported.rev + 1;
}

/** One line for a revision ("Fassung 2 von Anna: engerer Stop"). */
export function revisionNote(pb: Pick<Playbook, "rev" | "author" | "changes">): string {
  return `Fassung ${pb.rev ?? "?"}${pb.author ? ` von ${pb.author}` : ""}${pb.changes ? `: ${pb.changes}` : ""}`.slice(0, 140);
}

// ── checklist → journal setup ────────────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 40;

/** A setup name that is not taken yet ("Name" → "Name (Playbook)" → "Name (Playbook 2)"). */
function freeName(name: string, taken: readonly string[]): string {
  const norm = (s: string): string => s.trim().toLocaleLowerCase("de-DE");
  const used = new Set(taken.map(norm));
  const base = name.trim().slice(0, MAX_NAME) || "Playbook";
  if (!used.has(norm(base))) return base;
  for (let i = 1; i < 100; i++) {
    const c = `${base.slice(0, MAX_NAME - 14)} (Playbook${i > 1 ? ` ${i}` : ""})`;
    if (!used.has(norm(c))) return c;
  }
  return `${base.slice(0, MAX_NAME - 8)} (${Date.now().toString(36)})`;
}

/**
 * The journal setup (Entscheidungsgrundlage) a playbook makes: its checklist as the setup's checklist, the lab rules in plain language as
 * entry criteria, the author's text and origin in the description. Nothing from the playbook is executed; the person decides to create it.
 */
export function setupFromPlaybook(pb: Playbook, existing: readonly Pick<Setup, "name">[], color: string, id: (prefix: string) => string): Setup {
  const rules = summarizeCustom(pb.config);
  const base: Setup = {
    id: id("s_"),
    name: freeName(pb.title, existing.map((s) => s.name)),
    account: "both",
    color,
    desc: [pb.description, `Aus einem Playbook${pb.author ? ` von ${pb.author}` : ""}${pb.rev != null ? ` (Fassung ${pb.rev})` : ""} – fremde Regeln, nicht von dir geprüft.`].filter(Boolean).join("\n\n").slice(0, 1000),
    checklist: pb.checklist.map((text) => ({ id: id("c"), text })),
  };
  return withStrategy(base, {
    entryCriteria: rules.filter((l) => /^(Long|Short) wenn /.test(l)).map((text) => ({ id: id("k"), text: text.slice(0, 200) })),
    exitCriteria: rules.filter((l) => l.startsWith("Stop:")).map((text) => ({ id: id("k"), text: text.slice(0, 200) })),
    riskModel: { riskPct: null, maxLeverage: null, minRR: null, stop: null },
    tags: ["Playbook"],
    examples: [],
    markets: pb.symbol ? [pb.symbol] : [],
    tf: [],
    auto: { ...EMPTY_AUTO, boxKinds: [], sessions: [], sides: [] },
  });
}
