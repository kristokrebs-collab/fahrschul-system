/**
 * „Wie ging es nach ähnlichen Situationen weiter?“ – the answer behind the Markt card „Ähnliche Situationen“: the last closed
 * candle of a timeframe is described by a few numbers, the earlier candles that looked most alike are the hits, and what really
 * happened after each is measured (`findSimilar`). The assistant quotes the headline of the domain (`headline`), the cases that
 * went the OTHER way (always, none hidden), the yardstick (`baselineText`) and – below 20 hits – „zu wenig Daten“ (`fewText`).
 * The existing tool `similar` only opens the card; this one answers and offers the card as a button. Similarity is a
 * description of the past, not a forecast.
 */
import { baselineText, fewText, headline, horizonText, moveText, NOT_A_FORECAST, pctText as simPct, type SimilarHit, type SimilarResult } from "@/domain/similar";
import { closeAssistant } from "../open";
import type { ReplyAction, ToolEnv, ToolReply } from "../tools";
import { similarSource } from "./sources";
import { fact, plural, reply } from "./shared";

const stamp = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function counterLine(r: SimilarResult): string {
  const s = r.summary!;
  if (!s.counters.length) return "Gegenbeispiele: keines – alle Fundstellen liefen in dieselbe Richtung.";
  const top = s.counters.slice(0, 3).map((h: SimilarHit) => `${stamp(h.time)} (${moveText(h.outcome.change, r.cfg.unit)})`);
  return `Gegenbeispiele: ${plural(s.counters.length, "Fundstelle ging", "Fundstellen gingen")} den anderen Weg${s.medianSetback != null ? `, der Rücklauf gegen die Mehrheit lag im Median bei ${moveText(s.medianSetback, r.cfg.unit, false)}` : ""}; die größten: ${top.join(", ")}${s.counters.length > top.length ? ", …" : ""}.`;
}

export async function situationAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const inp = await similarSource(env, norm);
  const open: ReplyAction = {
    label: "Ähnliche Situationen öffnen",
    run: () => {
      // the existing `similar` callback navigates to the Markt page and asks the card to scroll into view
      closeAssistant();
      if (env.similar) env.similar();
      else env.go("markt");
    },
  };
  if (inp.state === "idle") {
    return reply({ title: "Der Live-Markt läuft gerade nicht", text: "Ähnliche Situationen suche ich in den echten Kerzen des Live-Markts, und der ist gerade nicht verbunden. Öffne die Markt-Seite, dann laden die Kerzen – ich erfinde keine Fundstellen.", tone: "mute", actions: [open] });
  }
  if (inp.state === "waiting" || !inp.result) {
    return reply({ title: `Für ${inp.tf} liegen keine Kerzen vor`, text: `${inp.reason ?? `Die Kerzen für ${inp.tf} sind noch nicht geladen.`} Es wird keine andere Zeiteinheit untergeschoben.`, tone: "mute", actions: [open] });
  }
  const r = inp.result;
  const base = `Zeiteinheit ${r.tf}, Horizont ${horizonText(r.cfg.horizon)}, ${r.bars} geschlossene Kerzen geladen.`;
  const few = fewText(r);
  if (!r.summary || few) {
    return reply({
      title: "Zu wenig Daten für eine Auswertung",
      text: `${base} ${few ?? "Es gibt keine Verteilung."} ${NOT_A_FORECAST}`,
      facts: [fact("Fundstellen", String(r.hits.length), "mute", r.hits.length), fact("Mindestens", "20", "mute", 20), fact("Kerzen", String(r.bars), "fg", r.bars)],
      tone: "mute",
      actions: [open],
      followUps: ["Zeig mir ähnliche Situationen"],
    });
  }
  const s = r.summary;
  const med = s.change.median;
  return reply({
    title: `Ähnliche Situationen auf ${r.tf}`,
    text: [headline(s, r.cfg.horizon), `Im Median lag der Kurs danach ${moveText(med, r.cfg.unit)} (mittlere Hälfte ${moveText(s.change.q25, r.cfg.unit)} bis ${moveText(s.change.q75, r.cfg.unit)}).`, counterLine(r), baselineText(s, r), base, NOT_A_FORECAST].filter(Boolean).join(" "),
    facts: [fact("Fundstellen", String(s.n), "fg", s.n), fact("Höher", simPct(s.up.share), s.expectation === "up" ? "win" : "fg", s.up.share), fact("Tiefer", simPct(s.down.share), s.expectation === "down" ? "loss" : "fg", s.down.share), fact("Gegenbeispiele", String(s.counters.length), "mute", s.counters.length)],
    actions: [open],
    followUps: ["Zeig mir ähnliche Situationen"],
  });
}
