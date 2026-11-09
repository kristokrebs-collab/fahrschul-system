/**
 * „Morgenbriefing“ / „Was ist heute wichtig?“ (F43): the briefing of the card „Heute wichtig“ on the Markt page in a few sentences,
 * built by the same deterministic function from the same stores. Every sentence keeps its source and time in brackets, what the
 * app does not have is „keine Daten“, nothing is estimated, nothing is fetched or started here and no trade is suggested. The full
 * version – every line with its full source – is one tap away.
 */
import { briefingParagraph, buildBriefing } from "@/domain/events";
import { formatClock } from "@/domain/events/zone";
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { briefingInputOf } from "@/views/termine/briefingInput";
import type { ToolEnv, ToolReply } from "../tools";
import { briefingSource } from "./sources";
import { fact, openAction, plural, reply } from "./shared";

const SPOT = { page: "markt", feature: "morgenbriefing", testid: "briefing-card" } as const;

export async function briefingAnswer(_norm: string, env: ToolEnv): Promise<ToolReply> {
  const stores = await briefingSource(env);
  const b = buildBriefing(briefingInputOf(stores));
  const section = (id: string) => b.sections.find((s) => s.id === id)!;
  const events = section("events").lines.filter((l) => !l.missing && !/^Für heute sind keine Termine/.test(l.text));
  const markets = section("markets").lines;
  const missing = b.sections.reduce((n, s) => n + s.lines.filter((l) => l.missing).length, 0);
  const moving = markets.filter((l) => /bewegt sich$/.test(l.text)).length;
  const checkin = section("checkin").lines[0]!;
  return reply({
    title: "Heute wichtig",
    text: `${briefingParagraph(b, 6)} Stand ${formatClock(b.generatedAt, b.tz)} Uhr (${b.tz}). ${NO_ADVICE_TEXT}`,
    facts: [fact("Termine", String(events.length), "fg", events.length), fact("Märkte in Bewegung", String(moving), "fg", moving), fact("Ohne Daten", plural(missing, "Zeile", "Zeilen"), missing ? "mute" : "fg", missing), fact("Check-in", /erledigt/.test(checkin.text) ? "erledigt" : /übersprungen/.test(checkin.text) ? "übersprungen" : "offen", "fg")],
    actions: [openAction(env, "Briefing mit allen Quellen öffnen", SPOT)],
    followUps: ["Wo finde ich die Termine?"],
    tone: "fg",
  });
}
