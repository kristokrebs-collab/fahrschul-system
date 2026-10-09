/**
 * "Lage" panel of the market card (decision 19 / 23): the automatic Lage-Ampel replaces the manual trigger scenario.
 * Traffic light + headline, what it means for an entry (under the user's setting), the daily close countdown, reason
 * chips with values, the 4H reversal signs while the daily trend is down, the EMA ladder (1D / 4H 21 / 50 / 200) and
 * the nearest resistances / supports split at the live price, the feed's honest status, and a "Details" morph with the
 * method and the backtest.
 *
 * Renders: `useLage()` publishes only when a shown value changes (≤ ~1/s while the price moves); the price itself and
 * the countdown are MotionValue leaves (zero React renders per tick / second). Fixed row heights and tabular slots,
 * so a 1-Hz update never moves the layout (the market panel sets the hero row's height).
 */
import { motion, useTransform } from "motion/react";
import { memo, useMemo, type ReactNode } from "react";
import {
  clockText,
  dayText,
  LAGE_EMA_TITLE,
  LAGE_HEADLINE,
  LAGE_LEVELS_TITLE,
  LAGE_LOADING,
  LAGE_METHOD,
  LAGE_MODE_TEXT,
  LAGE_NO_DATA,
  LAGE_SETTINGS_TITLE,
  LAGE_SIGNS_TITLE,
  LAGE_STATE_WORD,
  LAGE_TITLE,
  lageSettingsOf,
  SIGN_SHORT,
  TREND_TEXT,
  type Lage,
  type LageChip,
  type LageEma,
  type LageLevel,
  type LageSettings,
  type LageSign,
  type LageState,
} from "@/domain/lage";
import { cn } from "@/lib/cn";
import { n0, n1, pct } from "@/lib/format";
import { priceMv, useLage, type LageFeedStatus } from "@/market";
import { useNowMv } from "@/motion/clock";
import { useMediaQuery } from "@/motion/useMediaQuery";
import { MorphCard } from "@/motion/MorphCard";
import { StaggerItem } from "@/motion/Stagger";
import { radius } from "@/motion/tokens";
import { Skeleton } from "@/primitives/Skeleton";
import { useJournal } from "@/store/journalStore";
import { alignPad, CHIP_DOT, closeInText, emaColumn, feedText, keepTogether, levelColumn, meaningText, STATE_TONE, type LightTone } from "./lageView";

export const LAGE_DETAILS_ID = "lage-details";
/** lg+ (two hero columns): the Lage spans the hero as a band under P&L and market panel instead of sitting in the panel. */
export const LAGE_BAND_QUERY = "(min-width: 1024px)";
/** Whether the Lage renders as the hero band (lg+); else inside the market panel. `false` without `matchMedia`. */
export const useLageBand = (): boolean => useMediaQuery(LAGE_BAND_QUERY, false);
export const LAGE_DETAILS_LABEL = "Details +";
/** Headline while the first daily bars load. */
export const LAGE_PENDING = "Wird ermittelt …";
/** Accessible name of the Details pill (contains the visible "Details", unique beside the hero's `Details +`). */
export const LAGE_DETAILS_NAME = "Lage-Ampel: Details";

const TONE_TEXT: Readonly<Record<LightTone, string>> = { win: "text-win", warn: "text-warn", loss: "text-loss", mute: "text-mute" };
const LIGHT_ON: Readonly<Record<Exclude<LageState, "none">, string>> = {
  red: "bg-loss shadow-[0_0_0_3px_rgb(255_77_79/0.16),0_0_10px_rgb(255_77_79/0.55)]",
  amber: "bg-warn shadow-[0_0_0_3px_rgb(255_176_32/0.16),0_0_10px_rgb(255_176_32/0.5)]",
  green: "bg-win shadow-[0_0_0_3px_rgb(61_220_132/0.16),0_0_10px_rgb(61_220_132/0.5)]",
};
const LIGHT_ORDER = ["red", "amber", "green"] as const;

/** The traffic light: three dots, the active one lit (all dark when off / no data). */
function Lights({ state, off }: { state: LageState; off: boolean }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[5px] rounded-full border border-line-2 bg-ink-950/60 px-[6px] py-[4px]">
      {LIGHT_ORDER.map((k) => (
        <span key={k} className={cn("size-[7px] rounded-full transition-[background-color,box-shadow] duration-300", !off && state === k ? LIGHT_ON[k] : "bg-white/[0.09]")} />
      ))}
    </span>
  );
}

/**
 * `Tagesschluss 02:00` + `in 8:29 h` — the countdown is a `nowMv` leaf (renders nothing per second). `wide`: the
 * right-hand block of the header (the header COLUMN ≥ 400 px — in the hero band at 1024 px the state column is ~350 px,
 * where the block ran into the Details pill); else one line under the headline, so it never crowds the title.
 */
const DailyClose = memo(function DailyClose({ at, wide, stand }: { at: number; wide: boolean; stand: string | null }) {
  const now = useNowMv();
  const text = useTransform(now, (t) => `in ${closeInText(at - t)}`);
  if (!wide)
    return (
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 @min-[400px]/lagehead:hidden" data-testid="lage-close-narrow">
        <span className="label !text-[9.5px] !tracking-[0.12em]">Tagesschluss {clockText(at)}</span>
        <motion.span className="num font-mono text-[12px] text-fg">{text}</motion.span>
        {/* no leading "·": on a narrow phone the stand wraps to its own line and must not start with a separator */}
        {stand && <span className="text-[10.5px] text-faint">{stand}</span>}
      </span>
    );
  return (
    <span className="hidden shrink-0 justify-items-end gap-0.5 text-right @min-[400px]/lagehead:grid" data-testid="lage-close">
      <span className="label !text-[9.5px] !tracking-[0.12em]">Tagesschluss {clockText(at)}</span>
      <motion.span className="num inline-block min-w-[7ch] text-right font-mono text-[12.5px] leading-tight text-fg">{text}</motion.span>
      {stand && <span className="text-[10.5px] leading-tight text-faint">{stand}</span>}
    </span>
  );
});

function Chip({ chip, strong }: { chip: LageChip; strong?: boolean }) {
  return (
    <li
      className={cn(
        "inline-flex max-w-full items-start gap-1.5 rounded-lg border px-2 py-[3px] text-[11.5px] leading-snug",
        strong ? "border-warn/35 bg-warn/[0.07] text-warn" : "border-line-2 bg-white/[0.02] text-mute",
      )}
      data-chip={chip.id}
      data-tone={chip.tone}
    >
      {/* on the first line's centre (11.5 px × snug ≈ 15.8 px line box), also for a chip that wraps */}
      <span aria-hidden="true" className={cn("mt-[5.5px] size-[5px] shrink-0 rounded-full", CHIP_DOT[chip.tone])} />
      <span className="min-w-0">{keepTogether(chip.text)}</span>
    </li>
  );
}

function Signs({ signs, met }: { signs: readonly LageSign[]; met: number }) {
  return (
    <div className="grid gap-1.5" data-testid="lage-signs" data-met={met}>
      <div className="flex items-center justify-between gap-2">
        <span className="label !text-[9.5px] !tracking-[0.12em]">{LAGE_SIGNS_TITLE}</span>
        <span className={cn("num font-mono text-[11.5px]", met ? "text-warn" : "text-faint")}>{met}/4</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {signs.map((s) => (
          <li
            key={s.id}
            title={`${s.label}: ${s.detail}`}
            className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] leading-tight", s.met ? "border-win/30 bg-win/[0.06] text-fg" : "border-line bg-white/[0.015] text-faint")}
            data-sign={s.id}
            data-met={s.met == null ? "none" : String(s.met)}
          >
            <span aria-hidden="true" className={cn("size-[5px] shrink-0 rounded-full", s.met ? "bg-win" : "bg-white/15")} />
            <span className="sr-only">{s.met ? "an: " : s.met === false ? "aus: " : "keine Daten: "}</span>
            <span>{SIGN_SHORT[s.id]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ ladder */

const ROW = "grid h-[18px] grid-cols-[minmax(0,1fr)_auto_3.2rem] items-center gap-x-2 text-[11.5px] leading-none";

/** The live price in the ladder: a MotionValue leaf. */
function PriceRow({ fallback, line }: { fallback: number | null; line?: boolean }) {
  const text = useTransform(priceMv, (v) => n0(v > 0 ? v : fallback));
  if (line)
    return (
      <li aria-hidden="true" className="relative h-[18px]">
        <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/25" />
      </li>
    );
  return (
    <li className={cn(ROW, "-mx-1.5 rounded-md bg-white/[0.07] px-1.5")} data-row="price">
      <span className="font-semibold text-fg">Kurs</span>
      {/* every tick changes this text: its own layer with layout + paint containment, so a new price repaints these few
          pixels only — not the Lage section (≈ 350 section repaints / 10 s of feed before) */}
      <motion.span className="num inline-block min-w-[6ch] text-right font-mono font-semibold text-fg will-change-transform [contain:layout_paint]">{text}</motion.span>
      <span aria-hidden="true" />
    </li>
  );
}

const Pad = ({ n }: { n: number }) => (n > 0 ? Array.from({ length: n }, (_, i) => <li key={`pad${i}`} aria-hidden="true" className="hidden h-[18px] @min-[400px]/lage:block" />) : null);

function EmaRow({ e }: { e: LageEma }) {
  return (
    <li className={ROW} data-row={e.id}>
      <span className="min-w-0 truncate text-[11px] text-mute">
        <span className="text-faint">{e.tf}</span>-EMA {e.len}
      </span>
      <span className="num font-mono text-fg">{n0(e.value)}</span>
      <span className="num text-right font-mono text-mute">{pct(e.dist)}</span>
    </li>
  );
}

const levelKind = (l: LageLevel): string => l.label.slice(l.tf.length + 1);

/** Levels per side a narrow (stacked) ladder shows; the two-column ladder shows as many as the EMA column has rows. */
const NARROW_LEVELS = 2;

function LevelRow({ l, extra }: { l: LageLevel; extra?: boolean }) {
  return (
    <li className={cn(ROW, extra && "hidden @min-[400px]/lage:grid")} data-row={l.id} data-side={l.side} data-extra={extra ? "" : undefined}>
      <span className="min-w-0 truncate text-[11px] text-mute" title={l.label}>
        <span className="text-faint">{l.tf}</span> {levelKind(l)}
      </span>
      <span className="num font-mono text-fg">{n0(l.price)}</span>
      <span className="num text-right font-mono text-mute">{pct(l.dist)}</span>
    </li>
  );
}

function ColHead({ title, right }: { title: string; right: string }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="label !text-[9.5px] !tracking-[0.12em]">{title}</span>
      <span className="label !text-[9px] !tracking-[0.1em] !text-faint">{right}</span>
    </div>
  );
}

/**
 * The EMA ladder beside the levels. `footer` (hero band, falling market): the 4H reversal signs under both columns —
 * beside the reason chips they made the state column ~150 px taller than the ladder, an empty band under it.
 */
function Ladder({ lage, footer }: { lage: Lage; footer?: ReactNode }) {
  const emas = useMemo(() => emaColumn(lage), [lage]);
  const lv = useMemo(() => levelColumn(lage, emas), [lage, emas]);
  const pad = alignPad(emas, lv);
  const hasLevels = lv.above.length + lv.below.length > 0;
  return (
    <div className="grid gap-x-4 gap-y-3 @min-[400px]/lage:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]" data-testid="lage-ladder">
      <div className="min-w-0">
        <ColHead title={LAGE_EMA_TITLE} right="Kurs vs. EMA" />
        <ul className="grid" aria-label="EMA-Leiter, höchste zuerst">
          <Pad n={pad.aTop} />
          {emas.above.map((e) => (
            <EmaRow key={e.id} e={e} />
          ))}
          <PriceRow fallback={lage.price} />
          {emas.below.map((e) => (
            <EmaRow key={e.id} e={e} />
          ))}
          <Pad n={pad.aBottom} />
        </ul>
      </div>
      {hasLevels && (
        <div className="min-w-0">
          <ColHead title={LAGE_LEVELS_TITLE} right="Abstand" />
          <ul className="grid" aria-label="Nächste Widerstände und Supports">
            <Pad n={pad.bTop} />
            {lv.above.map((l, i) => (
              <LevelRow key={l.id} l={l} extra={i < lv.above.length - NARROW_LEVELS} />
            ))}
            <PriceRow fallback={lage.price} line />
            {lv.below.map((l, i) => (
              <LevelRow key={l.id} l={l} extra={i >= NARROW_LEVELS} />
            ))}
            <Pad n={pad.bBottom} />
          </ul>
        </div>
      )}
      {footer && <div className="min-w-0 @min-[400px]/lage:col-span-2">{footer}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

function Footer({ status }: { status: LageFeedStatus }) {
  const f = feedText(status);
  return (
    <p className={cn("text-[11px] leading-snug", f.tone === "warn" ? "text-warn" : "text-faint")} data-testid="lage-feed" data-feed={status.state}>
      {f.text}
    </p>
  );
}

/** `Stand 15:32` of a fresh feed (header), `null` when the feed line says more. */
const standOf = (s: LageFeedStatus): string | null => (s.state === "ok" && s.fetchedAt != null ? `Stand ${clockText(s.fetchedAt)}` : null);

function DetailsButton({ lage, status }: { lage: Lage | null; status: LageFeedStatus }) {
  return (
    <MorphCard
      id={LAGE_DETAILS_ID}
      title={LAGE_SETTINGS_TITLE}
      borderRadius={radius.pill}
      className="touch-hit ml-1 !w-auto shrink-0 rounded-full border border-line-2 px-2 py-px hover:border-white/50"
      dialogClassName="max-w-[680px]"
      motionProps={{ "aria-label": LAGE_DETAILS_NAME }}
      body={() => <LageDetails initial={lage} initialStatus={status} />}
    >
      <span className="label !text-[9.5px] group-hover:!text-fg">{LAGE_DETAILS_LABEL}</span>
    </MorphCard>
  );
}

function useLageSettings(): LageSettings {
  const on = useJournal((s) => lageSettingsOf(s.settings.signals).on);
  const mode = useJournal((s) => lageSettingsOf(s.settings.signals).mode);
  return useMemo(() => ({ on, mode }), [on, mode]);
}

/** Placeholder with the loaded panel's geometry (header, two chip rows, 7 ladder rows): nothing jumps when data lands. */
function LoadingBody() {
  return (
    <div aria-hidden="true" className="grid gap-2.5">
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-28 rounded-lg" />
        <Skeleton className="h-6 w-36 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-lg" />
      </div>
      <div className="grid gap-x-4 gap-y-1 @min-[400px]/lage:grid-cols-2">
        <Skeleton className="h-[146px] rounded-lg" />
        <Skeleton className="hidden h-[146px] rounded-lg @min-[400px]/lage:block" />
      </div>
    </div>
  );
}

/**
 * The panel. `data-state` = red | amber | green | none, `data-gate` = on | off, `data-mode` = block | warn.
 */
export const LagePanel = memo(function LagePanel({ band = false }: { band?: boolean }) {
  const { lage, status } = useLage();
  const settings = useLageSettings();
  const state: LageState = lage?.state ?? "none";
  const tone = settings.on ? STATE_TONE[state] : "mute";
  const loading = !lage && (status.state === "loading" || status.state === "idle");
  const title = lage ? lage.title : loading ? LAGE_PENDING : LAGE_HEADLINE.none;
  const word = !settings.on ? "Aus" : LAGE_STATE_WORD[state];
  const chips = lage ? lage.reasons.filter((c) => !c.id.startsWith("sign-")) : [];
  const stand = standOf(status);
  return (
    <section
      // band: a card of its own in the hero (the market panel's surface); else a box inside the market panel
      className={cn("@container/lage relative grid gap-2.5", band ? "rounded-2xl border border-white/10 bg-ink-900 p-5" : "rounded-xl border border-line-2 bg-white/[0.02] p-3.5")}
      data-testid="lage-panel"
      data-band={band ? "" : undefined}
      data-state={state}
      data-gate={settings.on ? "on" : "off"}
      data-mode={settings.mode}
      aria-label={`${LAGE_TITLE}: ${word} – ${title}`}
    >
      {/* the market panel's column: one stack; the hero band (≥ 860 px container, lg+): the state on the left, the
          ladder on the right */}
      <div className="grid gap-2.5 @min-[860px]/lage:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] @min-[860px]/lage:gap-x-8">
        <div className="@container/lagehead grid min-w-0 content-start gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1.5">
              <div className="flex items-center gap-2">
                <span className="label">{LAGE_TITLE}</span>
                <Lights state={state} off={!settings.on || !lage} />
                <span className={cn("text-[11.5px] font-semibold transition-colors duration-300", TONE_TEXT[tone])} data-testid="lage-word">
                  {word}
                </span>
                <DetailsButton lage={lage} status={status} />
              </div>
              <strong className={cn("text-[15px] font-semibold leading-snug transition-colors duration-300", lage && settings.on ? TONE_TEXT[tone] : "text-fg")} data-testid="lage-title">
                {title}
              </strong>
              {lage && <DailyClose at={lage.dailyCloseAt} wide={false} stand={stand} />}
            </div>
            {lage && <DailyClose at={lage.dailyCloseAt} wide stand={stand} />}
          </div>

          {loading ? (
            <p className="text-[12px] leading-relaxed text-faint">{LAGE_LOADING}</p>
          ) : (
            <p className="text-[12px] leading-relaxed text-mute" data-testid="lage-meaning">
              {lage ? meaningText(lage, settings) : LAGE_NO_DATA}
            </p>
          )}

          {lage && (lage.wobble || chips.length > 0) && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Gründe" data-testid="lage-chips">
              {lage.wobble && <Chip chip={lage.wobble} strong />}
              {chips.map((c) => (
                <Chip key={c.id} chip={c} />
              ))}
            </ul>
          )}
          {lage?.abwaerts && !band && <Signs signs={lage.signs} met={lage.signsMet} />}
        </div>
        {loading ? <LoadingBody /> : lage ? <Ladder lage={lage} footer={band && lage.abwaerts ? <Signs signs={lage.signs} met={lage.signsMet} /> : null} /> : null}
      </div>

      {!stand && !loading && <Footer status={status} />}
    </section>
  );
});

/* ------------------------------------------------------------------ details dialog */

const SECTION = "grid gap-2";
const H = "text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mute";

function DetailRow({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-[12.5px] last:border-b-0">
      <span className="min-w-0 text-mute">{label}</span>
      <span className="num text-right font-mono text-fg">{value}</span>
      {sub && <span className="col-span-2 text-[11.5px] leading-snug text-faint">{sub}</span>}
    </div>
  );
}

const SIGN_MARK = {
  ok: { mark: "✓", cls: "bg-win/20 text-win" },
  no: { mark: "✕", cls: "bg-white/[0.06] text-faint" },
  none: { mark: "–", cls: "bg-white/[0.06] text-faint" },
} as const;

const RULE_DOT: Readonly<Record<string, string>> = { red: "bg-loss", amber: "bg-warn", green: "bg-win" };

/** Dialog body: the live state with every value, then the method, the backtest and its limits. */
function LageDetails({ initial, initialStatus }: { initial: Lage | null; initialStatus: LageFeedStatus }) {
  const live = useLage();
  const settings = useLageSettings();
  const lage = live.lage ?? initial;
  const status = live.lage || live.status.state !== "idle" ? live.status : initialStatus;
  const s = settings;
  const tone = s.on && lage ? STATE_TONE[lage.state] : "mute";
  const d = lage?.daily;
  const h = lage?.h4;
  return (
    <div className="grid gap-5" data-testid="lage-details">
      <StaggerItem className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Lights state={lage?.state ?? "none"} off={!s.on || !lage} />
          <span className={cn("text-[12px] font-semibold", TONE_TEXT[tone])}>{!s.on ? "Aus" : LAGE_STATE_WORD[lage?.state ?? "none"]}</span>
        </div>
        <strong className={cn("text-[17px] font-semibold leading-snug", TONE_TEXT[tone] === "text-mute" ? "text-fg" : TONE_TEXT[tone])}>{lage?.title ?? LAGE_HEADLINE.none}</strong>
        <p className="text-[13px] leading-relaxed text-mute">{lage ? meaningText(lage, s) : LAGE_NO_DATA}</p>
        <p className="text-[12px] text-faint">
          Wirkung: {s.on ? LAGE_MODE_TEXT[s.mode] : "aus"} · Einstellungen → {LAGE_SETTINGS_TITLE}
        </p>
      </StaggerItem>

      {lage && d && (
        <StaggerItem className={SECTION}>
          <span className={H}>Tagestrend · 1D-EMA 21</span>
          <div>
            <DetailRow label={`Letzter Tagesschluss (${dayText(d.at)})`} value={n0(d.close)} sub={`EMA 21 ${n0(d.ema21)} · Schluss ${pct(d.dist21)} zur EMA`} />
            <DetailRow label="Schlüsse in Folge unter EMA 21" value={String(d.below)} sub={lage.abwaerts ? "2 oder mehr = Abwärtstrend" : d.below === 1 ? "1 – rot, wenn der nächste auch darunter schließt" : "Tagesschluss darüber = kein Abwärtstrend"} />
            <DetailRow label="Kurs zur 1D-EMA 21" value={pct(lage.dist)} />
            <DetailRow label="Nächster Tagesschluss" value={clockText(lage.dailyCloseAt)} sub="00:00 UTC · erst der Schluss zählt, nicht der Kurs davor" />
          </div>
        </StaggerItem>
      )}

      {lage && (
        <StaggerItem className={SECTION}>
          <span className={H}>
            {LAGE_SIGNS_TITLE} · {lage.signsMet}/4{lage.abwaerts ? "" : " · zählen nur im Abwärtstrend"}
          </span>
          <ul className="grid gap-1.5">
            {lage.signs.map((sg) => {
              const m = SIGN_MARK[sg.met ? "ok" : sg.met === false ? "no" : "none"];
              return (
                <li key={sg.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-sign={sg.id}>
                  <span aria-hidden="true" className={cn("mt-px grid size-5 place-items-center rounded-full text-[11px] font-bold", m.cls)}>
                    {m.mark}
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn("text-[13px] font-semibold leading-snug", sg.met ? "text-fg" : "text-mute")}>
                      {sg.id} · {sg.label}
                    </span>
                    <span className="text-[12px] leading-snug text-faint">{sg.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </StaggerItem>
      )}

      {lage && h && (
        <StaggerItem className={SECTION}>
          <span className={H}>4H · letzter Schluss</span>
          <div>
            <DetailRow label="Schluss" value={n0(h.close)} sub={`EMA 21 ${n0(h.ema21)} · EMA 50 ${n0(h.ema50)}${h.ema200 != null ? ` · EMA 200 ${n0(h.ema200)}` : ""}`} />
            <DetailRow label="EMA 21 zu EMA 50" value={h.cross ? "darüber" : "darunter"} />
            <DetailRow label="Struktur (LuxAlgo SMC)" value={TREND_TEXT[h.trend]} sub={`intern ${TREND_TEXT[h.itrend]} · ATR 14 ${n0(h.atr)}`} />
          </div>
        </StaggerItem>
      )}

      {lage && lage.levels.resistances.length + lage.levels.supports.length > 0 && (
        <StaggerItem className={SECTION}>
          <span className={H}>{LAGE_LEVELS_TITLE} · 4H und 1D</span>
          <div>
            {[...lage.levels.resistances.slice().reverse(), ...lage.levels.supports].map((l) => (
              <DetailRow
                key={l.id}
                label={
                  <>
                    <span className={l.side === "resistance" ? "text-fg" : "text-mute"}>{l.side === "resistance" ? "Widerstand" : "Support"}</span> · {l.label}
                  </>
                }
                value={n0(l.price)}
                sub={`${pct(l.dist)} · ${n1(l.distAtr)} ATR (4H)${l.top !== l.btm ? ` · Zone ${n0(l.btm)}–${n0(l.top)}` : ""}`}
              />
            ))}
          </div>
        </StaggerItem>
      )}

      <StaggerItem className={SECTION}>
        <span className={H}>{LAGE_METHOD.ruleTitle}</span>
        <ul className="grid gap-2">
          {LAGE_METHOD.rules.map((r) => (
            <li key={r.tone} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 text-[12.5px] leading-relaxed">
              <span aria-hidden="true" className={cn("mt-[7px] size-[7px] rounded-full", RULE_DOT[r.tone])} />
              <span className="text-mute">
                <span className="font-semibold text-fg">{r.title}:</span> {r.text}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] leading-relaxed text-mute">{LAGE_METHOD.signsTitle}:</p>
        <ul className="grid gap-1 pl-1 text-[12.5px] leading-relaxed text-mute">
          {LAGE_METHOD.signs.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
        <p className="text-[12.5px] leading-relaxed text-mute">{LAGE_METHOD.effect}</p>
        <p className="text-[12px] leading-relaxed text-faint">{LAGE_METHOD.data}</p>
      </StaggerItem>

      <StaggerItem className={SECTION}>
        <span className={H}>{LAGE_METHOD.backtestTitle}</span>
        <ul className="grid gap-1 text-[12.5px] leading-relaxed text-mute">
          {LAGE_METHOD.backtest.map((t) => (
            <li key={t}>{keepTogether(t)}</li>
          ))}
        </ul>
        <span className={cn(H, "mt-1")}>{LAGE_METHOD.caveatsTitle}</span>
        <ul className="grid gap-1 text-[12.5px] leading-relaxed text-mute">
          {LAGE_METHOD.caveats.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
        <p className="rounded-xl border border-line-2 bg-white/[0.02] px-3 py-2 text-[12.5px] leading-relaxed text-fg">{LAGE_METHOD.fixed}</p>
      </StaggerItem>

      <StaggerItem>
        <Footer status={status} />
      </StaggerItem>
    </div>
  );
}
