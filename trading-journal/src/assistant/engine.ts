/**
 * The assistant's brain, glued from the parts (F74): `understand` (local language layer) → the journal answer engine
 * (`answerIntent`) or a tool (`runTool`). Pure apart from the callbacks in `ToolEnv`. When the local layer cannot place a
 * question it reports `needsServer`, and the UI may ask the optional server router (`route.ts`) for canonical
 * questions – which come back through the same local parser, so even then every number is computed by the app.
 *
 * The evaluation tools (Prüfbericht, Forward-Test, Trendlinien, Signale …, `insights/`) read their figures from the app's
 * stores and load their code on demand, so their replies are not ready when `respond` returns: the turn carries them as
 * `later` (a promise of the replies) and the UI shows the usual waiting beat meanwhile. `settled(turn)` waits for either kind.
 */
import { answerIntent, parseContextOf, type Answer, type AnswerData } from "@/domain/coach/nlq";
import type { Intent } from "@/domain/coach/nlq";
import { isInsightTool } from "./insightRoutes";
import { runTool, type ToolEnv, type ToolReply } from "./tools";
import { understand, type Plan, type UnderstandCtx } from "./understand";

export type Reply =
  | { kind: "journal"; answer: Answer }
  | { kind: "tool"; tool: string; reply: ToolReply }
  | { kind: "clarify"; text: string; suggestions: string[] };

export interface Turn {
  replies: Reply[];
  /** how the question was read ("Was lief gut", "setpu → setup", "Folgefrage zu …") – shown as chips */
  via: string[];
  /** learned topic key, null when nothing was understood */
  topic: string | null;
  /** the local layer gave up: the optional server router may try */
  needsServer: boolean;
  /** an evaluation tool is on its way (it loads its figures on demand): the replies it will give; `replies` is empty until then */
  later?: Promise<Reply[]>;
}

export interface EngineEnv extends Omit<ToolEnv, "prev"> {
  /** the last journal intent / answer of the conversation (follow-ups, "warum?") */
  prev: { question: string; answer: Answer } | null;
  /** the evaluation tool the newest answer came from, if it was one (a short „und letzte Woche?“ continues it) */
  prevTool?: UnderstandCtx["prevTool"];
}

/** Answers `question`. */
export function respond(question: string, env: EngineEnv): Turn {
  const data: AnswerData = env.data;
  const parse = parseContextOf(data.closed, data);
  const plan: Plan = understand(question, { parse, prev: env.prev?.answer.intent ?? null, closed: data.closed.length, prevTool: env.prevTool ?? null });
  return execute(plan, question, env);
}

const FAILED: ToolReply = { title: "Das hat nicht geklappt", text: "Dabei ist ein Fehler aufgetreten. Versuch es bitte noch einmal oder frag anders.", facts: [], followUps: [], actions: [], tone: "mute" };

/** Runs an already made plan (the server router re-enters here with its canonical questions). */
export function execute(plan: Plan, question: string, env: EngineEnv): Turn {
  const data = env.data;
  switch (plan.kind) {
    case "journal": {
      const replies: Reply[] = plan.intents.map((i: Intent) => ({ kind: "journal", answer: answerIntent(i, { ...data, now: env.now }) }));
      return { replies, via: plan.via, topic: plan.topic, needsServer: false };
    }
    case "tool": {
      const tool = plan.tool;
      if (isInsightTool(tool)) {
        const later = import("./insights")
          .then((m) => m.runInsight(tool, plan.arg || question, env))
          .catch((): ToolReply => FAILED)
          .then((reply): Reply[] => [{ kind: "tool", tool, reply }]);
        return { replies: [], via: plan.via, topic: plan.topic, needsServer: false, later };
      }
      const reply = runTool(tool, tool === "navigate" ? plan.arg : question, env);
      return { replies: [{ kind: "tool", tool, reply }], via: plan.via, topic: plan.topic, needsServer: false };
    }
    case "clarify":
      return { replies: [{ kind: "clarify", text: plan.text, suggestions: plan.suggestions }], via: [], topic: null, needsServer: true };
  }
}

/** The replies of a turn, waiting for an evaluation tool if one is running. */
export const settled = (turn: Turn): Promise<Reply[]> => (turn.later ? turn.later : Promise.resolve(turn.replies));

/** The text a reply says aloud / the plain-text form of a reply (read-aloud, copy, tests). */
export function replyText(r: Reply): string {
  switch (r.kind) {
    case "journal":
      return r.answer.text;
    case "tool":
      return `${r.reply.title}. ${r.reply.text}`;
    case "clarify":
      return r.text;
  }
}
