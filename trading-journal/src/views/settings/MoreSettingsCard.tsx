/**
 * "Weitere Einstellungen" (P14): the settings that live on their feature pages, one tap away – Konto & Cloud (login,
 * sync, 2FA, privacy, exchange connections), Preise & Abo, the Box-Einstellungen of the Markt page and the
 * Risiko-Einstellungen. A row opens the page and scrolls the named card into view once it is on screen (the page may be
 * a lazy chunk – the scroll waits for it, ≤ 4 s). Cloud rows only where this build has a cloud (else an honest line).
 * Rows press with `usePressable`; the arrow nudges on hover (CSS transform only).
 */
import { motion } from "motion/react";
import { PAGE_ICON, PAGE_LABELS } from "@/app/Dock";
import { preloadPage } from "@/app/pages";
import { cloudEnabled } from "@/cloud/env";
import { usePressable } from "@/motion/usePressable";
import { Card } from "@/primitives/Card";
import { Icon } from "@/primitives/icons";
import { hasClaudeRuntime } from "@/store/capability";
import { navigate } from "@/store/router";
import type { Page } from "@/store/uiStore";

export const MORE_SETTINGS = {
  title: "Weitere Einstellungen",
  note: "Auf ihren Seiten, einen Tipp entfernt",
  noCloud: "Konto, Sync und Abos gibt es in dieser Version nicht – dein Journal bleibt in diesem Browser.",
  rows: {
    konto: { label: "Konto & Cloud", sub: "Login, Sync, 2FA, Datenschutz, Börsen-Verbindungen" },
    preise: { label: "Preise & Abo", sub: "Tarife vergleichen, Abo verwalten" },
    markt: { label: "Box-Einstellungen", sub: "Box-zu-Box, Alarme, Scanner-Watchlist", heading: "Box-Einstellungen" },
    risiko: { label: "Risiko-Einstellungen", sub: "Limits, Liquidations-Stufen, Korrelation", heading: "Risiko-Einstellungen" },
  },
} as const;

type Row = { page: Page; label: string; sub: string; heading?: string };

/** Opens `page` and, once its layer shows a heading starting with `heading`, scrolls that card into view. */
export function openSettingsOn(page: Page, heading?: string): void {
  navigate(page);
  if (!heading || typeof document === "undefined") return;
  const deadline = performance.now() + 4000;
  const tick = () => {
    const layer = document.querySelector(`[data-page="${page}"][data-page-role="current"]`);
    const h = layer ? Array.from(layer.querySelectorAll<HTMLElement>("h2, h3")).find((x) => (x.textContent ?? "").trim().startsWith(heading)) : undefined;
    if (h) {
      h.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function LinkRow({ row }: { row: Row }) {
  const press = usePressable({ scale: 0.98 });
  return (
    <motion.button
      type="button"
      onClick={() => openSettingsOn(row.page, row.heading)}
      onPointerEnter={() => preloadPage(row.page)}
      onFocus={() => preloadPage(row.page)}
      whileTap={press.whileTap}
      transition={press.transition}
      data-testid={`settings-link-${row.page}`}
      className="group/row flex w-full items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3 text-left outline-none transition-colors duration-200 hover:border-white/25 focus-visible:border-white/60 pointer-coarse:min-h-12"
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-2 text-mute group-hover/row:text-fg [&>svg]:size-4">
        <Icon name={PAGE_ICON[row.page]} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13.5px] font-medium text-fg">{row.label}</span>
        <span className="truncate text-[12px] text-mute">{row.sub}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-mute transition-transform duration-200 group-hover/row:translate-x-0.5">
        →
      </span>
    </motion.button>
  );
}

export function MoreSettingsCard({ className }: { className?: string }) {
  const cloud = cloudEnabled() && !hasClaudeRuntime();
  const rows: Row[] = [
    ...(cloud
      ? [
          { page: "konto" as const, ...MORE_SETTINGS.rows.konto },
          { page: "preise" as const, ...MORE_SETTINGS.rows.preise },
        ]
      : []),
    { page: "markt", ...MORE_SETTINGS.rows.markt },
    { page: "risiko", ...MORE_SETTINGS.rows.risiko },
  ];
  return (
    <Card title={MORE_SETTINGS.title} note={MORE_SETTINGS.note} className={className} data-testid="settings-more">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {rows.map((r) => (
          <LinkRow key={r.page} row={{ ...r, label: r.label || PAGE_LABELS[r.page] }} />
        ))}
      </div>
      {!cloud && <p className="mt-3 text-[12px] text-faint">{MORE_SETTINGS.noCloud}</p>}
    </Card>
  );
}
