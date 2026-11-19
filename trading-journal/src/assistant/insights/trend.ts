/**
 * „Welche Zeiteinheiten haben eine Preis-Trendlinie in Annäherung, Bruch oder Retest?“ / „Wie weit ist der Kurs von der
 * nächsten Linie?“ / „Welche Zeiteinheiten sind gesperrt und warum?“ – the assistant reads the live trendline store
 * (`getTrendlines`, i.e. `analyzeTrendlines` on the closed candles of every selected timeframe) and phrases each line with
 * the domain's own `describeLine` / `distText`. A timeframe the feed cannot serve is named with its reason and is not
 * guessed. Observations with numbers – no forecast, no recommendation.
 */
import { describeLine, distText, KIND_LABEL, type TrendLineView, type TrendPhase } from "@/domain/trendlines";
import { has, tokensOf } from "../fuzzy";
import type { ToolEnv, ToolReply } from "../tools";
import { trendView } from "./sources";
import { fact, openAction, plural, reply } from "./shared";

const SPOT = { page: "markt", feature: "struktur" } as const;

interface Found {
  tf: string;
  line: TrendLineView;
  phase: TrendPhase;
  title: string;
}

/** Every price line of the analysed timeframes, with its phase. */
function priceLines(view: Awaited<ReturnType<typeof trendView>>): Found[] {
  const out: Found[] = [];
  for (const it of view.items) {
    const a = it.analysis;
    if (!a) continue;
    for (const slot of [a.price.down, a.price.up]) {
      for (const line of [slot.active, slot.broken]) {
        if (!line) continue;
        const d = describeLine(line);
        out.push({ tf: it.tf, line, phase: d.phase, title: d.title });
      }
    }
  }
  return out;
}

const tfList = (xs: readonly string[]): string => [...new Set(xs)].join(", ");

function idle(env: ToolEnv): ToolReply {
  return reply({
    title: "Der Live-Markt läuft gerade nicht",
    text: "Die Trendlinien rechne ich aus den echten Kerzen des Live-Markts, und der ist gerade nicht verbunden. Öffne die Markt-Seite, dann laden die Zeiteinheiten – ich erfinde keine Linien.",
    tone: "mute",
    actions: [openAction(env, "Markt öffnen", SPOT)],
  });
}

export async function trendAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const view = await trendView(env);
  const open = openAction(env, "Preis- & RSI-Struktur öffnen", SPOT);
  if (view.state === "idle") return idle(env);
  const t = tokensOf(norm);
  const chosen = view.items.filter((i) => i.selected);

  // locked timeframes and why
  if (has(t, "gesperrt", "sperr", "verfuegbar", "fehlen", "fehlt", "ausgeblendet") || (has(t, "warum") && has(t, "zeiteinheit"))) {
    const locked = view.items.filter((i) => !i.avail.ok);
    if (!locked.length) {
      return reply({ title: "Keine Zeiteinheit gesperrt", text: `Alle ${view.items.length} Zeiteinheiten (${view.items.map((i) => i.tf).join(", ")}) kann der Datenfeed gerade bedienen. Ausgewertet werden die ${chosen.length ? `gewählten: ${chosen.map((i) => i.tf).join(", ")}` : "gewählten – aktuell ist keine ausgewählt"}.`, facts: [fact("Gesperrt", "0", "fg", 0), fact("Gewählt", String(chosen.length), "fg", chosen.length)], actions: [open] });
    }
    return reply({
      title: plural(locked.length, "Zeiteinheit gesperrt", "Zeiteinheiten gesperrt"),
      text: `${locked.map((i) => `${i.tf}: ${i.avail.reason}`).join(" ")} Eine gesperrte Zeiteinheit wird nicht ausgewertet und nicht durch eine andere ersetzt.`,
      facts: [fact("Gesperrt", String(locked.length), "loss", locked.length), fact("Verfügbar", String(view.items.length - locked.length), "fg", view.items.length - locked.length)],
      tone: "mute",
      actions: [open],
    });
  }

  const analysed = chosen.filter((i) => i.analysis);
  if (!analysed.length) {
    const why = chosen.filter((i) => !i.avail.ok).map((i) => `${i.tf}: ${i.avail.reason}`);
    return reply({
      title: chosen.length ? "Noch keine Zeiteinheit ausgewertet" : "Keine Zeiteinheit gewählt",
      text: chosen.length ? `Für die gewählten Zeiteinheiten liegen noch keine Kerzen vor. ${why.join(" ")}` : "Auf der Markt-Seite ist keine Zeiteinheit für die Trendlinien gewählt. Wähle dort die Zeiteinheiten, dann werte ich sie aus.",
      tone: "mute",
      actions: [open],
    });
  }

  const lines = priceLines(view);
  const active = lines.filter((l) => l.phase === "approach" || l.phase === "intact");

  // distance to the nearest line
  if (has(t, "weit", "abstand", "entfernt", "naechst", "nah")) {
    const near = active.filter((l) => l.line.distPct != null).sort((a, b) => Math.abs(a.line.distPct!) - Math.abs(b.line.distPct!));
    const n = near[0];
    if (!n) return reply({ title: "Keine unverletzte Preislinie", text: `In den ausgewerteten Zeiteinheiten (${analysed.map((i) => i.tf).join(", ")}) gibt es gerade keine unverletzte diagonale Preislinie, zu der ich einen Abstand nennen könnte.`, tone: "mute", actions: [open] });
    const side = n.line.kind === "down" ? "unter" : "über";
    const others = near.slice(1, 4).map((o) => `${o.tf} ${distText(o.line)}`);
    return reply({
      title: `Nächste Linie: ${n.tf}`,
      text: `Die nächste Preislinie ist die ${KIND_LABEL[n.line.kind]} auf ${n.tf}: Der letzte Schluss liegt ${distText(n.line)} ${side} der Linie (${n.line.touches} Berührungen).${others.length ? ` Weitere: ${others.join("; ")}.` : ""} Ein Bruch zählt erst mit dem Kerzenschluss; der Abstand ist keine Prognose.`,
      facts: [fact("Zeiteinheit", n.tf), fact("Abstand", n.line.distPct == null ? "–" : `${n.line.distPct.toFixed(2).replace(".", ",")} %`, "fg", n.line.distPct), fact("Berührungen", String(n.line.touches), "fg", n.line.touches)],
      actions: [open],
      followUps: ["Welche Zeiteinheiten sind gesperrt und warum?"],
    });
  }

  // approach / break / retest per timeframe
  const approach = lines.filter((l) => l.phase === "approach");
  const brk = lines.filter((l) => l.phase === "break");
  const retest = lines.filter((l) => l.phase === "retest-open" || l.phase === "retest-held" || l.phase === "retest-failed" || l.phase === "no-retest");
  const intact = lines.filter((l) => l.phase === "intact");
  const one = (l: Found): string => `${l.tf} (${KIND_LABEL[l.line.kind]}: ${l.title}, ${l.line.touches} Berührungen)`;
  const parts: string[] = [];
  if (approach.length) parts.push(`Annäherung: ${approach.map((l) => `${l.tf} (${KIND_LABEL[l.line.kind]}, Schluss ${distText(l.line)} entfernt)`).join("; ")}.`);
  if (brk.length) parts.push(`Bruch (Retest steht aus): ${brk.map(one).join("; ")}.`);
  if (retest.length) parts.push(`Retest: ${retest.map(one).join("; ")}.`);
  if (!parts.length) parts.push(`Keine der ${plural(analysed.length, "ausgewerteten Zeiteinheit", "ausgewerteten Zeiteinheiten")} (${analysed.map((i) => i.tf).join(", ")}) hat gerade eine Preislinie in Annäherung, Bruch oder Retest.${intact.length ? ` Intakt, aber nicht nah: ${tfList(intact.map((l) => l.tf))}.` : " Es gibt dort auch keine diagonale Preislinie."}`);
  const locked = chosen.filter((i) => !i.avail.ok);
  if (locked.length) parts.push(`Nicht ausgewertet: ${locked.map((i) => `${i.tf} (${i.avail.reason})`).join("; ")}.`);
  return reply({
    title: approach.length + brk.length + retest.length ? "Trendlinien mit Bewegung" : "Keine Trendlinie in Annäherung, Bruch oder Retest",
    text: `${view.symbol ? `${view.symbol}: ` : ""}${parts.join(" ")} Das sind Beobachtungen auf geschlossenen Kerzen, keine Prognose.`,
    facts: [fact("Annäherung", String(new Set(approach.map((l) => l.tf)).size), "fg", approach.length), fact("Bruch", String(new Set(brk.map((l) => l.tf)).size), "fg", brk.length), fact("Retest", String(new Set(retest.map((l) => l.tf)).size), "fg", retest.length), fact("Ausgewertet", String(analysed.length), "fg", analysed.length)],
    actions: [open],
    followUps: ["Wie weit ist der Kurs von der nächsten Linie?", "Welche Zeiteinheiten sind gesperrt und warum?"],
  });
}
