import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { openAuthSheet, useCloudSession } from "@/cloud/session";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { downloadShareCard } from "@/journal/sharePng";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { GlyphZoom } from "@/motion/pulse/GlyphZoom";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Sheet } from "@/motion/Sheet";
import { bodyRevealDelay, StaggerItem } from "@/motion/Stagger";
import { Switch } from "@/motion/Switch";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useEnriched, useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import type { SharePayload, SharedTrade } from "../contract";
import { fmtMove, fmtR, shareTitle } from "../format";
import { useLocalStats } from "../hooks";
import { shareUrl } from "../links";
import { setupFigures } from "../metrics";
import { REDACT_DEFAULTS, redactSetup, redactStats, redactTrade, type RedactOptions } from "../redact";
import { closeShare, communityEnabled, createShareLink, loadCommunity, postReview, useSocial, type ShareTarget } from "../store";
import { S, SHARE } from "../strings";
import { canNativeShare, copyText, nativeShare } from "./copy";
import { Glyph } from "./glyphs";

type Days = 0 | 1 | 7 | 30;

/** The word the camera dives into: the R of a trade, SETUP, the window of the figures. */
function wordOf(p: SharePayload): string {
  if (p.kind === "setup") return "SETUP";
  if (p.kind === "stats") return `${p.windowDays}T`;
  if (p.r != null) return fmtR(p.r, 1).replace("−", "-");
  if (p.movePct != null) return fmtMove(p.movePct).replace("−", "-").replace(" %", "%");
  return "TRADE";
}

/** Big hero inside the dive: what the link will be about, at a glance. */
function Hero({ p }: { p: SharePayload }) {
  const tone = (v: number | null | undefined) => (v == null || v === 0 ? "fg" : v > 0 ? "win" : "loss");
  return (
    <div className="grid size-full place-items-center bg-[radial-gradient(120%_90%_at_50%_0%,#1c1c1c_0%,#0a0a0a_60%)] p-5">
      <div className="grid justify-items-center gap-3 text-center">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-mute">
          {p.kind === "trade" ? `${p.pair === "-" ? "Trade" : p.pair} · ${p.side === "short" ? "Short" : "Long"}${p.timeframe ? ` · ${p.timeframe}` : ""}` : p.kind === "setup" ? "Entscheidungsgrundlage" : `${p.trades} Trades`}
        </span>
        {p.kind === "setup" ? (
          <span className="max-w-[18ch] text-[22px] font-semibold tracking-tight [overflow-wrap:anywhere]">{p.name}</span>
        ) : (
          <DotMatrixText
            text={p.kind === "trade" ? (p.r != null ? fmtR(p.r).replace("−", "-") : wordOf(p)) : p.expectancyR != null ? fmtR(p.expectancyR).replace("−", "-") : "--"}
            tone={tone(p.kind === "trade" ? (p.r ?? p.movePct) : p.expectancyR)}
            size={5}
            gap={1.5}
            decorative
          />
        )}
        <span className="flex items-center gap-1.5 rounded-full border border-line-2 bg-ink-950/60 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
          <Glyph name="lock" className="size-3" />
          geschwärzt · R statt Euro
        </span>
      </div>
    </div>
  );
}

/** A labelled switch row. */
function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-line first:border-t-0">
      <label htmlFor={id} className="text-[13.5px] text-fg">
        {label}
      </label>
      <Switch id={id} size="sm" tone="fg" checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

/** What the payload contains, field by field (transparency before anything leaves). */
function Fields({ p }: { p: SharePayload }) {
  const rows: [string, string][] = [];
  if (p.kind === "trade") {
    rows.push(["R", fmtR(p.r)], ["Bewegung", fmtMove(p.movePct)], ["Tag", p.day ? p.day.split("-").reverse().join(".") : "–"]);
    if (p.time) rows.push(["Uhrzeit", p.time]);
    if (p.entry !== undefined) rows.push(["Preise", "Einstieg, Ausstieg, Stop, Ziel"]);
    if (p.setups?.length) rows.push(["Grundlagen", p.setups.join(", ")]);
    if (p.tags?.length || p.mistakes?.length) rows.push(["Tags", [...(p.tags ?? []), ...(p.mistakes ?? [])].join(", ") || "–"]);
  } else if (p.kind === "setup") {
    rows.push(["Regeln", `${p.checklist.length + p.entryCriteria.length + p.exitCriteria.length}`], ["Risiko-Modell", p.risk ? "ja" : "–"], ["Kennzahlen", p.stats ? `${p.stats.trades} Trades in R` : "nein"]);
  } else {
    rows.push(["Erwartung", fmtR(p.expectancyR)], ["Trades", String(p.trades)]);
  }
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="num truncate text-right text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <StaggerItem as="section" className="grid gap-3 rounded-2xl border border-line bg-ink-900/60 p-4">
      <h3 className="label">{title}</h3>
      {children}
    </StaggerItem>
  );
}

/** Link part: expiry, create, then copy / native share. Honest without cloud / login. */
function LinkPart({ payload }: { payload: SharePayload }) {
  const reduced = useReducedFx();
  const phase = useCloudSession((s) => s.phase);
  const busy = useSocial((s) => s.busy);
  const [days, setDays] = useState<Days>(30);
  const [url, setUrl] = useState<string | null>(null);
  const enabled = communityEnabled();
  const signedIn = phase === "signedIn";
  const create = async () => {
    const share = await createShareLink(payload, days);
    if (share) setUrl(shareUrl(share.token));
  };
  const copy = async () => {
    if (!url) return;
    pushToast(await copyText(url) ? { kind: "success", title: S.linkCopied } : { kind: "error", title: S.copyFailed });
  };
  if (!enabled) return <p className="text-[12.5px] leading-relaxed text-mute">{SHARE.linkNeedsCloud}</p>;
  if (!signedIn)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-mute">{SHARE.linkNeedsLogin}</p>
        <Button size="sm" onClick={() => openAuthSheet("signin", "card")}>
          Anmelden
        </Button>
      </div>
    );
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-mute">{SHARE.expiry}</span>
        <Segmented<string> size="sm" aria-label={SHARE.expiry} options={SHARE.expiryOptions.map((o) => ({ v: o.v, label: o.label }))} value={String(days)} onChange={(v) => setDays(Number(v) as Days)} />
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {url ? (
          <motion.div
            key="url"
            className="grid gap-2"
            initial={reduced ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
            transition={{ default: spring.pop, opacity: tween.fade }}
          >
            <Input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12px]" data-testid="share-url" />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={copy} data-testid="share-copy">
                <Glyph name="copy" className="size-3.5" />
                {SHARE.copy}
              </Button>
              {canNativeShare() && (
                <Button size="sm" onClick={() => void nativeShare(url, shareTitle(payload))}>
                  <Glyph name="share" className="size-3.5" />
                  {SHARE.nativeShare}
                </Button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="create" exit={{ opacity: 0, transition: tween.exit }}>
            <Button variant="primary" onClick={create} disabled={busy === "share"} data-testid="share-create">
              <Glyph name="link" className="size-4" />
              {SHARE.createLink}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Post the redacted trade into a group for a joint review. */
function GroupPart({ payload }: { payload: SharedTrade }) {
  const groups = useSocial((s) => s.groups);
  const load = useSocial((s) => s.load);
  const busy = useSocial((s) => s.busy);
  const active = useSocial((s) => s.activeGroup);
  const [group, setGroup] = useState<string>(active ?? groups[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [posted, setPosted] = useState(false);
  const qid = useId();
  useEffect(() => {
    if (load === "idle") void loadCommunity();
  }, [load]);
  const target = groups.some((g) => g.id === group) ? group : (groups[0]?.id ?? "");
  if (!groups.length) return <p className="text-[12.5px] text-mute">{load === "loading" ? "Lade Gruppen …" : SHARE.noGroups}</p>;
  const post = async () => {
    if (await postReview(target, payload, question.trim())) {
      setPosted(true);
      setQuestion("");
    }
  };
  return (
    <div className="grid gap-3">
      <MorphSelect<string> aria-label="Gruppe" value={target} onChange={setGroup} options={groups.map((g) => ({ value: g.id, label: g.name }))} size="sm" className="w-full" data-testid="share-group" />
      <label htmlFor={qid} className="sr-only">
        Frage
      </label>
      <Input id={qid} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Frage an die Gruppe (optional)" />
      <div className="flex items-center gap-3">
        <Button onClick={post} disabled={busy === "review" || posted} data-testid="share-post-review">
          <Glyph name={posted ? "check" : "send"} className="size-4" />
          {posted ? "Gepostet" : SHARE.toGroupAction}
        </Button>
      </div>
    </div>
  );
}

/** The dive starts once the sheet has landed and the stage faded in (sheet spring reveal point + one reveal). */
const DIVE_AFTER_MS = Math.round((bodyRevealDelay(spring.sheet) + tween.reveal.duration) * 1000);

function Body({ target, trade, setup, open }: { target: ShareTarget; trade: EnrichedTrade | null; setup: Setup | null; open: boolean }) {
  const [dive, setDive] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setDive(true), DIVE_AFTER_MS);
    return () => clearTimeout(id);
  }, [open]);
  const settings = useJournal((s) => s.settings);
  const trades = useJournal((s) => s.trades);
  const stats = useLocalStats();
  const [opts, setOpts] = useState<Required<RedactOptions>>({ ...REDACT_DEFAULTS });
  const [withStats, setWithStats] = useState(false);
  const enabled = communityEnabled();
  const phase = useCloudSession((s) => s.phase);

  const payload = useMemo<SharePayload | null>(() => {
    if (target.kind === "trade") return trade ? redactTrade(trade, opts, settings.setups) : null;
    if (target.kind === "setup") return setup ? redactSetup(setup, withStats ? setupFigures(trades, setup.id) : null) : null;
    return redactStats(stats);
  }, [target.kind, trade, setup, opts, settings.setups, withStats, trades, stats]);

  if (!payload) return <p className="text-[13px] text-mute">{SHARE.notFound}</p>;
  const set = (k: keyof RedactOptions) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const saveImage = async () => {
    if (!trade) return;
    const ok = await downloadShareCard(trade, { privacy: "percent", currency: settings.currency, setups: opts.setups ? settings.setups : [] });
    pushToast(ok ? { kind: "success", title: S.imageSaved } : { kind: "error", title: S.failed });
  };
  return (
    <div className="grid gap-3">
      <StaggerItem>
        <GlyphZoom word={wordOf(payload)} open={open && dive} label={shareTitle(payload)} className="h-[220px] rounded-2xl border border-line-2 sm:h-[250px]">
          <Hero p={payload} />
        </GlyphZoom>
      </StaggerItem>
      <Section title={SHARE.what}>
        <Fields p={payload} />
        {target.kind === "trade" && (
          <div className="grid">
            <Toggle label={SHARE.prices} checked={opts.prices} onChange={set("prices")} testId="share-opt-prices" />
            <Toggle label={SHARE.time} checked={opts.time} onChange={set("time")} testId="share-opt-time" />
            <Toggle label={SHARE.setups} checked={opts.setups} onChange={set("setups")} testId="share-opt-setups" />
            <Toggle label={SHARE.tags} checked={opts.tags} onChange={set("tags")} testId="share-opt-tags" />
          </div>
        )}
        {target.kind === "setup" && <Toggle label={SHARE.stats} checked={withStats} onChange={setWithStats} testId="share-opt-stats" />}
        <p className="flex items-start gap-2 text-[12px] leading-snug text-faint">
          <Glyph name="lock" className="mt-0.5 size-3.5 shrink-0" />
          {SHARE.never}
        </p>
      </Section>
      <Section title="Link">
        <LinkPart payload={payload} />
      </Section>
      {payload.kind === "trade" && enabled && phase === "signedIn" && (
        <Section title={SHARE.toGroup}>
          <GroupPart payload={payload} />
        </Section>
      )}
      {trade && (
        <Section title="Bild">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-mute">1200 × 675 · ohne Euro-Beträge · bleibt auf dem Gerät.</p>
            <Button size="sm" onClick={saveImage} data-testid="share-image">
              <Glyph name="image" className="size-3.5" />
              {SHARE.image}
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * Share sheet (P12): mounted once by `SocialHost`, opened with `openShare({ kind, … })` (ShareButton in the trade
 * detail, the Community page). The share card is BORN from the trade: the sheet lands, then the camera dives into the
 * R (`GlyphZoom`) and reveals the card's hero. Everything the link would contain is listed field by field; details are
 * opt-in switches; money never leaves. Link (cloud + login), group review (signed in, with groups) and the picture
 * (always, on the device) are three separate actions.
 */
export function ShareSheet() {
  const target = useSocial((s) => s.share);
  const open = useSocial((s) => s.shareOpen);
  const seq = useSocial((s) => s.shareSeq);
  const enriched = useEnriched();
  const setups = useJournal((s) => s.settings.setups);
  const trade = target?.kind === "trade" ? (enriched.find((t) => t.id === target.tradeId) ?? null) : null;
  const setup = target?.kind === "setup" ? (setups.find((s) => s.id === target.setupId) ?? null) : null;
  const title = target?.kind === "setup" ? `${SHARE.sheetTitle} · Setup` : target?.kind === "stats" ? `${SHARE.sheetTitle} · Kennzahlen` : SHARE.sheetTitle;
  return (
    <Sheet open={open} onClose={closeShare} title={title} size="md" dismissGuard={false}>
      {target && <Body key={seq} target={target} trade={trade} setup={setup} open={open} />}
    </Sheet>
  );
}
