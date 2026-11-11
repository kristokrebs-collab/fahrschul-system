import { AnimatePresence, motion } from "motion/react";
import { Fragment, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { StaggerItem } from "@/motion/Stagger";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { EmptyState } from "@/primitives/EmptyState";
import { Input } from "@/primitives/Input";
import { Sheet } from "@/motion/Sheet";
import { useEnriched } from "@/store/journalStore";
import type { CommentInfo, GroupDetail, ReviewInfo } from "@/social/contract";
import { fmtR } from "@/social/format";
import { closeSheet, deleteComment, deleteReview, openSheet, openShare, postComment, sendFeedback, setReviewStatus, useSocial } from "@/social/store";
import { FEED, S } from "@/social/strings";
import { Glyph } from "@/social/ui/glyphs";
import { Monogram } from "@/social/ui/Monogram";
import { TradeShareCard } from "@/social/ui/ShareCards";
import { pushToast } from "@/store/uiStore";
import { ConfirmAction } from "./ConfirmAction";

const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const THREAD = { hidden: {}, shown: { transition: { staggerChildren: stagger.rows } } };

/** Reports a comment / review (needs a login – the server checks the reporter can see it). */
function report(type: "comment" | "review", id: string): void {
  if (useCloudSession.getState().phase !== "signedIn") {
    pushToast({ kind: "error", title: S.loginToReport });
    return;
  }
  void sendFeedback({ kind: "report", message: "Unangemessener Inhalt", page: "community", target: { type, id } });
}

/** Splits a comment into text and `@Pseudonym` mentions of the group (longest names first). */
export function mentionParts(text: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const out: { text: string; mention: boolean }[] = [];
  let rest = text;
  for (;;) {
    let best: { at: number; name: string } | null = null;
    const lower = rest.toLocaleLowerCase("de-DE");
    for (const n of sorted) {
      const at = lower.indexOf(`@${n.toLocaleLowerCase("de-DE")}`);
      if (at >= 0 && (!best || at < best.at)) best = { at, name: n };
    }
    if (!best) break;
    if (best.at > 0) out.push({ text: rest.slice(0, best.at), mention: false });
    out.push({ text: rest.slice(best.at, best.at + best.name.length + 1), mention: true });
    rest = rest.slice(best.at + best.name.length + 1);
  }
  if (rest) out.push({ text: rest, mention: false });
  return out;
}

function MentionText({ text, names }: { text: string; names: readonly string[] }) {
  return (
    <>
      {mentionParts(text, names).map((p, i) =>
        p.mention ? (
          <span key={i} className="rounded bg-white/[0.07] px-1 font-medium text-fg">
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function Comment({ c, group, reviewId }: { c: CommentInfo; group: GroupDetail; reviewId: string }) {
  const manager = group.role === "owner" || group.role === "mentor";
  return (
    <StaggerItem as="li" className={cn("grid gap-1 rounded-xl px-3 py-2", c.mentionsMe ? "border border-signal/30 bg-signal/[0.05]" : "bg-ink-950/50", c.hidden && "opacity-60")} data-testid="comment">
      <div className="flex items-center gap-2">
        <Monogram pseudonym={c.author} size="xs" tone={c.me ? "signal" : "fg"} />
        <span className="min-w-0 truncate text-[12.5px] font-medium">{c.author}</span>
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-faint">{when(c.createdAt)}</span>
        {c.mentionsMe && <Badge tone="warn" className="shrink-0">{FEED.mentionsYou}</Badge>}
        {c.hidden && <Badge tone="loss">{FEED.hidden}</Badge>}
        <span className="flex-1" />
        {(c.me || manager) && (
          <button type="button" className="touch-hit text-[11px] text-faint transition-colors hover:text-loss" onClick={() => void deleteComment(group.id, reviewId, c.id)}>
            {FEED.delete}
          </button>
        )}
        {!c.me && (
          <button type="button" className="touch-hit text-faint transition-colors hover:text-fg" aria-label={`${FEED.report}: ${c.author}`} onClick={() => report("comment", c.id)}>
            <Glyph name="flag" className="size-3.5" />
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg [overflow-wrap:anywhere]">
        <MentionText text={c.body} names={group.memberList.map((m) => m.pseudonym)} />
      </p>
    </StaggerItem>
  );
}

/** Composer with mention chips (tap a member → "@Pseudonym " is inserted). */
function Composer({ group, reviewId }: { group: GroupDetail; reviewId: string }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** Inserts "@Pseudonym " at the end and puts the caret behind it. */
  const mention = (name: string) => {
    const next = `${text}${text && !text.endsWith(" ") ? " " : ""}@${name} `;
    setText(next);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(next.length, next.length));
  };
  const busy = useSocial((s) => s.busy);
  const id = useId();
  const others = group.memberList.filter((m) => !m.me).slice(0, 6);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (await postComment(group.id, reviewId, body)) setText("");
  };
  return (
    <form onSubmit={submit} className="grid gap-2">
      {others.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={FEED.mention}>
          {others.map((m) => (
            <button
              key={m.id}
              type="button"
              className="rounded-full border border-line-2 px-2.5 py-0.5 text-[11px] text-mute transition-colors hover:border-white/30 hover:text-fg"
              onClick={() => mention(m.pseudonym)}
            >
              @{m.pseudonym}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          {FEED.comment}
        </label>
        <Input ref={inputRef} id={id} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={FEED.commentPlaceholder} wrapperClassName="flex-1" data-testid="comment-input" />
        <Button type="submit" variant="primary" disabled={!text.trim() || busy === "comment"} aria-label={FEED.send} data-testid="comment-send">
          <Glyph name="send" className="size-4" />
        </Button>
      </div>
    </form>
  );
}

/** One shared trade with its question and thread. */
export function ReviewCard({ r, group, index, focus = false }: { r: ReviewInfo; group: GroupDetail; index: number; focus?: boolean }) {
  const reduced = useReducedFx();
  const manager = group.role === "owner" || group.role === "mentor";
  const canClose = r.me || manager;
  return (
    <motion.article
      layout="position"
      id={`review-${r.id}`}
      className={cn("grid gap-3 rounded-2xl border bg-ink-900 p-4", focus ? "border-line-2" : "border-line", r.status === "done" && "opacity-[0.92]")}
      style={{ borderRadius: radius.card }}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
      transition={{ default: { ...spring.enter, delay: Math.min(index, stagger.max) * stagger.cards }, opacity: { ...tween.fade, delay: Math.min(index, stagger.max) * stagger.cards }, layout: spring.layout }}
      data-testid="review-card"
      data-status={r.status}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Monogram pseudonym={r.author} tone={r.me ? "signal" : "fg"} />
        <span className="grid min-w-0">
          <span className="truncate text-[13.5px] font-medium">{r.me ? `Du · ${r.author}` : r.author}</span>
          <span className="font-mono text-[10.5px] text-faint">{when(r.createdAt)}</span>
        </span>
        <span className="flex-1" />
        <Badge tone={r.status === "done" ? "win" : "warn"} dot>
          {r.status === "done" ? (r.reviewedBy ? FEED.reviewedBy(r.reviewedBy) : FEED.done) : FEED.open}
        </Badge>
      </header>
      {r.question && <blockquote className="border-l-2 border-signal/60 pl-3 text-[13.5px] leading-relaxed text-fg">{r.question}</blockquote>}
      <TradeShareCard p={r.payload} compact />
      <motion.ol className="grid gap-1.5" variants={THREAD} initial={reduced ? false : "hidden"} animate="shown" aria-label={`${r.comments.length} Kommentare`}>
        <AnimatePresence initial={false}>
          {r.comments.map((c) => (
            <Comment key={c.id} c={c} group={group} reviewId={r.id} />
          ))}
        </AnimatePresence>
      </motion.ol>
      <Composer group={group} reviewId={r.id} />
      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {canClose && (
          <Button size="sm" onClick={() => void setReviewStatus(group.id, r.id, r.status === "done" ? "open" : "done")} data-testid="review-toggle">
            <Glyph name="check" className="size-3.5" />
            {r.status === "done" ? FEED.reopen : FEED.done}
          </Button>
        )}
        <span className="flex-1" />
        {!r.me && (
          <Button size="sm" onClick={() => report("review", r.id)} aria-label={FEED.report}>
            <Glyph name="flag" className="size-3.5" />
          </Button>
        )}
        {(r.me || manager) && <ConfirmAction label={FEED.delete} question="Review löschen?" onConfirm={() => void deleteReview(group.id, r.id)} />}
      </footer>
    </motion.article>
  );
}

/** Picks a closed trade from the journal; the share sheet then redacts it and posts it to the group. */
export function TradePicker() {
  const open = useSocial((s) => s.sheet?.kind === "pick");
  const onClose = closeSheet;
  const enriched = useEnriched();
  const recent = useMemo(
    () =>
      enriched
        .filter((t) => t.status === "closed")
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 40),
    [enriched],
  );
  const pick = (id: string) => {
    onClose();
    openShare({ kind: "trade", tradeId: id });
  };
  return (
    <Sheet open={open} onClose={onClose} title={FEED.pickTitle} dismissGuard={false}>
      <div className="grid gap-3">
        <StaggerItem>
          <p className="text-[12.5px] text-mute">{FEED.pickHint}</p>
        </StaggerItem>
        {recent.length === 0 ? (
          <StaggerItem>
            <p className="rounded-xl border border-line px-4 py-6 text-center text-[13px] text-mute">{FEED.pickNone}</p>
          </StaggerItem>
        ) : (
          <StaggerItem as="section">
            <ul className="grid gap-1">
              {recent.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => pick(t.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line-2 hover:bg-white/[0.03]"
                    data-testid="pick-trade"
                  >
                    <span className="grid min-w-0">
                      <span className="flex items-center gap-2 text-[13px]">
                        <span className="truncate font-medium">{t.pair}</span>
                        <span className={t.side === "short" ? "text-loss" : "text-win"}>{t.side === "short" ? "▼ Short" : "▲ Long"}</span>
                      </span>
                      <span className="font-mono text-[10.5px] text-faint">{t.date.replace("T", " · ")}</span>
                    </span>
                    <span className={cn("num font-mono text-[13.5px]", (t.r ?? 0) > 0 ? "text-win" : (t.r ?? 0) < 0 ? "text-loss" : "text-fg")}>{fmtR(t.r)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </StaggerItem>
        )}
      </div>
    </Sheet>
  );
}

/** The group's reviews (newest first) with the "Trade zur Review" entry. */
export function ReviewFeed({ group, reviews, focusId }: { group: GroupDetail; reviews: readonly ReviewInfo[]; focusId?: string | null }) {
  return (
    <section className="grid content-start gap-3" data-testid="review-feed">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="label">{FEED.title}</h3>
        <Button size="sm" variant="primary" onClick={() => openSheet({ kind: "pick" })} data-testid="review-new">
          <Glyph name="plus" className="size-3.5" />
          {FEED.post}
        </Button>
      </div>
      {reviews.length === 0 ? (
        <div data-testid="feed-empty">
          <EmptyState title={FEED.emptyTitle} text={FEED.empty} line={false} />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {reviews.map((r, i) => (
            <ReviewCard key={r.id} r={r} group={group} index={i} focus={r.id === focusId} />
          ))}
        </AnimatePresence>
      )}
    </section>
  );
}
