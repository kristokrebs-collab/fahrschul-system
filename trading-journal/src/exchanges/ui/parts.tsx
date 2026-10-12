import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { TextScramble } from "@/motion/TextScramble";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Short venue glyph for the dot-matrix tile. */
export const VENUE_GLYPH: Readonly<Record<string, string>> = { bitunix: "BX", binance: "BN", bybit: "BY", okx: "OKX" };
export const VENUE_NAME: Readonly<Record<string, string>> = { bitunix: "Bitunix", binance: "Binance", bybit: "Bybit", okx: "OKX" };

/** Dot-matrix venue tile (decorative). */
export function VenueTile({ exchange, className }: { exchange: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid h-12 min-w-12 shrink-0 place-items-center rounded-2xl border border-line-2 bg-ink-950 px-2.5", className)}>
      <DotMatrixText text={VENUE_GLYPH[exchange] ?? exchange.slice(0, 3).toUpperCase()} size={3} gap={1} tone="fg" decorative />
    </span>
  );
}

/** `••••abcd` that decodes in (TextScramble) – the only part of a key the browser ever sees again. */
export function MaskedKey({ last4, className }: { last4: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-mono tabular-nums", className)}>
      <span aria-hidden="true" className="tracking-[0.18em] text-faint">
        ••••
      </span>
      <TextScramble text={last4 || "····"} className="text-fg" />
      <span className="sr-only">Key endet auf {last4}</span>
    </span>
  );
}

const ICONS: Record<string, ReactNode> = {
  read: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  auto: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 0 0-14.9-3.8M4 13a8 8 0 0 0 14.9 3.8" />
      <path d="M4 4v4h4M20 20v-4h-4" />
    </svg>
  ),
};

/** Three facts with drawn icons, rising one after another (first view). */
export function FactList({ facts }: { facts: readonly { k: string; title: string; text: string }[] }) {
  const reduced = useReducedFx();
  return (
    <ul className="grid gap-2.5 sm:grid-cols-3">
      {facts.map((f, i) => (
        <motion.li
          key={f.k}
          className="flex min-w-0 gap-3 rounded-xl border border-line bg-ink-950/40 p-3 sm:flex-col sm:gap-2"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ y: { ...spring.enter, delay: 0.08 * i }, opacity: { ...tween.fade, delay: 0.08 * i } }}
        >
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-2 bg-ink-900 text-fg [&>svg]:size-4">
            {ICONS[f.k]}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="text-[13px] font-medium text-fg">{f.title}</span>
            <span className="text-[12px] leading-snug text-mute">{f.text}</span>
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

/** Honest one-line notice (no cloud functions, server not set up, …). */
export function Notice({ children, tone = "mute", className }: { children: ReactNode; tone?: "mute" | "warn" | "loss"; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed",
        tone === "loss" ? "border-loss/35 bg-loss/[0.07] text-loss" : tone === "warn" ? "border-warn/30 bg-warn/[0.06] text-warn" : "border-line bg-ink-950/40 text-mute",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Signed money with sign colour: `+59,18` / `−39,88`. */
export function Money({ value, className, digits = 2 }: { value: number | null | undefined; className?: string; digits?: 0 | 1 | 2 }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-faint", className)}>–</span>;
  const s = new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return <span className={cn("num font-mono tabular-nums", value > 0 ? "text-win" : value < 0 ? "text-loss" : "text-mute", className)}>{`${value > 0 ? "+" : value < 0 ? "−" : ""}${s}`}</span>;
}

export const fmtPlain = (v: number, digits = 2): string => new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
