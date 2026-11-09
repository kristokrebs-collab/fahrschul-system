import { useMemo } from "react";
import type { EnrichedTrade } from "@/domain/types";
import { downloadShareCard } from "@/journal/sharePng";
import { RADIAL_CHANNEL as CHANNEL, RadialShare, type RadialTarget } from "@/motion/RadialShare";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { shareTitle } from "../format";
import { REDACT_DEFAULTS, redactTrade } from "../redact";
import { S, SHARE } from "../strings";
import { canNativeShare, copyText, nativeShareText } from "./copy";
import { Glyph } from "./glyphs";

/** The sentence a trade is copied / handed to the system share sheet as: the redacted one-line title (pair, side, R) – never money. */
export function tradeShareText(trade: EnrichedTrade, setups: Parameters<typeof redactTrade>[2]): string {
  return shareTitle(redactTrade(trade, { ...REDACT_DEFAULTS }, setups));
}

/**
 * „Teilen“ of the trade detail as a radial fan (R11): Kopieren · Bild · Link · Teilen. Each target uses the logic that
 * already exists – the clipboard helper of the share sheet (`copyText`), the share picture (`downloadShareCard`, R and %
 * only), the share sheet itself for the link (`openShare`, which says honestly when a link needs the cloud or a login) and the
 * system share sheet where the browser has one (`nativeShareText`, only offered when `navigator.share` exists). What leaves
 * the device is the same redacted payload the sheet shows; the fan adds no new way to pass data on.
 */
export function RadialShareButton({ trade, className }: { trade: EnrichedTrade; className?: string }) {
  const currency = useJournal((s) => s.settings.currency);
  const setups = useJournal((s) => s.settings.setups);
  const native = canNativeShare();
  const targets = useMemo<RadialTarget[]>(() => {
    const text = () => tradeShareText(trade, setups);
    const list: RadialTarget[] = [
      {
        id: "copy",
        label: SHARE.copy,
        detail: "Kurzfassung ohne Geldbeträge kopieren",
        icon: <Glyph name="copy" className="size-5" />,
        color: CHANNEL.copy,
        // Runde 13: the fan says the result itself (busy word → done word + ✓); only a failure still comes as a toast
        busy: "Kopiere …",
        done: "Kurzfassung kopiert",
        onSelect: async () => {
          const ok = await copyText(text());
          if (!ok) pushToast({ kind: "error", title: "Kopieren ging nicht – bitte die Zeile selbst markieren." });
          return ok;
        },
      },
      {
        id: "image",
        label: "Bild",
        detail: "Teilen-Bild speichern (nur R und %)",
        icon: <Glyph name="image" className="size-5" />,
        color: CHANNEL.image,
        busy: "Speichere …",
        done: S.imageSaved,
        onSelect: async () => {
          const ok = await downloadShareCard(trade, { privacy: "percent", currency, setups: [] });
          if (!ok) pushToast({ kind: "error", title: S.failed });
          return ok;
        },
      },
      {
        id: "link",
        label: "Link",
        detail: "Teilen-Blatt mit Link öffnen",
        icon: <Glyph name="link" className="size-5" />,
        color: CHANNEL.link,
        // the share sheet decides what is possible (cloud, login) and says so – a link is never promised here
        onSelect: () => import("../store").then((m) => m.openShare({ kind: "trade", tradeId: trade.id })),
      },
    ];
    if (native)
      list.push({
        id: "native",
        label: "Weitergeben",
        detail: "Mit einer App teilen",
        icon: <Glyph name="send" className="size-5" />,
        color: CHANNEL.native,
        onSelect: async () => void (await nativeShareText(text(), text())),
      });
    return list;
  }, [trade, setups, currency, native]);
  return <RadialShare targets={targets} label={SHARE.sheetTitle} icon={<Glyph name="share" className="size-4" />} className={className} />;
}
