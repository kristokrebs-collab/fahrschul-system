/**
 * „Wie stehen die Chancen für meinen Plan?“ – the answer behind the Zeitmaschine. The assistant does NOT compute (it never starts a
 * run, never loads candles): it quotes the last finished run of this session – plan, odds with their interval, expectancy, the
 * earlier occasions, the verdict line and the warning when simulation and history disagree, the seed and the stamp – and
 * otherwise says honestly that nothing was played through and where to do it. A probability, never a promise.
 */
import { NO_ADVICE_TEXT } from "@/ui/AnalysisNote";
import { count, durationText, pc, pc0, planLine, rr } from "@/domain/timemachine/texts";
import type { ToolEnv, ToolReply } from "../tools";
import { timeMachineMemory } from "./sources";
import { fact, openAction, reply, stampText } from "./shared";

const SPOT = { page: "labor", testid: "tm-section", feature: "zeitmaschine" } as const;

export async function timemachineAnswer(_norm: string, env: ToolEnv): Promise<ToolReply> {
  const mem = await timeMachineMemory(env);
  const open = openAction(env, "Zeitmaschine öffnen", SPOT);
  if (!mem) {
    return reply({
      title: "Das habe ich noch nicht gerechnet",
      text: `Die Zeitmaschine spielt einen Plan (Einstieg, Stop, Ziel) durch 10 000 neu gemischte Sitzungen aus den echten Kerzen und durch jedes frühere Mal, als der Aufbau ausgelöst hätte – und sagt, wie oft Ziel oder Stop zuerst kamen. In dieser Sitzung wurde noch kein Plan durchgespielt. Ich rechne nicht von mir aus: Trag den Plan im Labor ganz unten unter „Zeitmaschine“ ein, oder öffne im Trade-Detail „Zeitmaschine“. ${NO_ADVICE_TEXT}`,
      tone: "mute",
      actions: [open],
      followUps: ["Wie läuft mein Forward-Test?"],
    });
  }
  const r = mem.result;
  const s = r.sim;
  const h = r.history;
  const stand = `Stand ${stampText(mem.at)} · Seed ${r.seed} · ${count(r.pool.bars)} Kerzen${mem.source ? ` (${mem.source})` : ""}`;
  const odds = `Von ${count(s.runs)} Sitzungen zu je ${durationText(s.horizon, r.interval)} erreichten ${pc(s.target.p)} (95 %: ${pc0(s.target.lo)}–${pc0(s.target.hi)}) das Ziel zuerst, ${pc(s.stop.p)} den Stop zuerst und ${pc(s.neither.p)} keins von beiden${s.moved.k > 0 ? `; ${pc(s.moved.p)} endeten am nachgezogenen Stop` : ""}.`;
  const expect = `Der Erwartungswert liegt bei ${rr(s.expectancy.mean)} je Trade nach Kosten (95 %: ${rr(s.expectancy.lo)} bis ${rr(s.expectancy.hi)} – das ist nur das Rechenrauschen der Läufe).`;
  const real = h.n > 0 ? `Auf den echten Kerzen löste der Aufbau ${count(h.n)}-mal aus: ${count(h.target.k)} Ziel, ${count(h.stop.k)} Stop${h.expectancy ? `, im Schnitt ${rr(h.expectancy.mean)}` : ""}${h.n < 20 ? " – zu wenig, um beides zu vergleichen" : ""}.` : "Auf den vorhandenen Kerzen hat der Aufbau nie ausgelöst, die Simulation steht allein.";
  const warn = r.compare.warn ? ` ${r.compare.text}` : "";
  return reply({
    title: "Das sagt die Zeitmaschine zu deinem Plan",
    text: `${planLine(r.plan, r.symbol, r.interval)}. ${odds} ${expect} ${real} ${r.verdict.text}${warn} ${stand}. Wahrscheinlichkeiten aus neu gemischten und aus echten Kerzen – keine Zusage. ${NO_ADVICE_TEXT}`,
    tone: r.verdict.tone === "warn" ? "mute" : r.verdict.tone,
    facts: [
      fact("Ziel zuerst", pc(s.target.p), "fg", s.target.p),
      fact("Stop zuerst", pc(s.stop.p), "fg", s.stop.p),
      fact("Weder noch", pc(s.neither.p), "mute", s.neither.p),
      fact("Ø je Trade", rr(s.expectancy.mean), s.expectancy.mean > 0.005 ? "win" : s.expectancy.mean < -0.005 ? "loss" : "fg", s.expectancy.mean),
      fact("Echte Vorfälle", String(h.n), "fg", h.n),
    ],
    actions: [open],
    followUps: ["Wie läuft mein Forward-Test?"],
  });
}
