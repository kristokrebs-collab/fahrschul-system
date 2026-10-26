import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { radius, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Skeleton } from "@/primitives/Skeleton";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import type { ShareInfo } from "@/social/contract";
import { shareUrl } from "@/social/links";
import { openShare, openSheet, revokeShareLink, useSocial } from "@/social/store";
import { PROOF } from "@/social/proofStrings";
import { S, SHARE, SHARE_KIND_LABEL } from "@/social/strings";
import { copyText } from "@/social/ui/copy";
import { Glyph } from "@/social/ui/glyphs";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

function ShareRow({ s, index }: { s: ShareInfo; index: number }) {
  const reduced = useReducedFx();
  const [now] = useState(() => Date.now());
  const expired = !!s.expiresAt && Date.parse(s.expiresAt) <= now;
  const dead = s.revoked || expired;
  const copy = async () => pushToast((await copyText(shareUrl(s.token))) ? { kind: "success", title: S.linkCopied } : { kind: "error", title: S.copyFailed });
  return (
    <motion.li
      layout="position"
      style={{ borderRadius: radius.input }}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: dead ? 0.55 : 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ default: { ...tween.reveal, delay: Math.min(index, stagger.max) * stagger.rows }, layout: spring.layout }}
      data-testid="share-row"
    >
      <span className="grid min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <Badge tone="mute">{SHARE_KIND_LABEL[s.kind]}</Badge>
          <span className="truncate text-[13px] font-medium">{s.title}</span>
        </span>
        <span className="font-mono text-[10.5px] text-faint">
          {dateLabel(s.createdAt)} · {SHARE.views(s.views)} · {s.revoked ? SHARE.revoked : expired ? SHARE.expired : s.expiresAt ? SHARE.until(dateLabel(s.expiresAt)) : SHARE.forever}
        </span>
      </span>
      {!dead && (
        <span className="flex gap-1.5">
          <Button size="sm" onClick={copy} aria-label={`${SHARE.copy}: ${s.title}`}>
            <Glyph name="copy" className="size-3.5" />
          </Button>
          <Button size="sm" onClick={() => void revokeShareLink(s.id)} data-testid="share-revoke">
            {SHARE.revoke}
          </Button>
        </span>
      )}
    </motion.li>
  );
}

/** "Deine Links" (P12): every link the user handed out – views, expiry, copy, revoke at once; new figures / setup shares. */
export function SharesCard({ className }: { className?: string }) {
  const shares = useSocial((s) => s.shares);
  const setups = useJournal((s) => s.settings.setups);
  const [setup, setSetup] = useState("");
  const list = shares.data ?? [];
  const chosen = setups.some((s) => s.id === setup) ? setup : (setups[0]?.id ?? "");
  return (
    <Card title={SHARE.myLinks} className={cn("h-full", className)} data-testid="shares-card">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openShare({ kind: "stats" })} data-testid="share-stats">
            <Glyph name="share" className="size-3.5" />
            {SHARE.shareStats}
          </Button>
          <Button size="sm" onClick={() => openSheet({ kind: "proof" })} title={PROOF.createHint} data-testid="share-proof">
            <Glyph name="share" className="size-3.5" />
            {PROOF.create}
          </Button>
          {setups.length > 0 && (
            // the setup's whole name: the select is as wide as its name (it wraps only when a name is wider than the card)
            <span className="flex min-w-0 max-w-full items-center gap-2">
              <MorphSelect<string> aria-label={SHARE.pickSetup} value={chosen} onChange={setSetup} options={setups.map((s) => ({ value: s.id, label: s.name }))} size="sm" wrap />
              <Button size="sm" onClick={() => chosen && openShare({ kind: "setup", setupId: chosen })} data-testid="share-setup">
                {SHARE.shareSetup}
              </Button>
            </span>
          )}
        </div>
        {shares.load === "loading" && !shares.data ? (
          <div className="grid gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : list.length === 0 ? (
          // the list is what the card is for → the one empty state (fills the row beside the feedback card)
          <EmptyState title={SHARE.linksEmptyTitle} text={SHARE.linksEmpty} line={false} className="min-h-[132px] flex-1" />
        ) : (
          <ul className="grid gap-1.5">
            <AnimatePresence initial={false}>
              {list.slice(0, 12).map((s, i) => (
                <ShareRow key={s.id} s={s} index={i} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Card>
  );
}
