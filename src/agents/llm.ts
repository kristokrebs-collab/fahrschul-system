/**
 * LLM-Anbindung (Anthropic Claude) fuer die generativen Agenten.
 *
 * Wichtige Designentscheidung:
 *
 * Die *pruefenden* Agenten (Brand Voice Guardian, Fact Verifier, Privacy
 * Reviewer, Compliance Reviewer) sind bewusst KEINE LLM-Aufrufe, sondern
 * deterministische Regelwerke. Ein Vetorecht, das sich wegdiskutieren laesst,
 * ist kein Vetorecht. Regeln sind testbar, wiederholbar und ueberstehen einen
 * Prompt-Injection-Versuch in einem Kommentar.
 *
 * Die *generativen* Agenten (Strategie, Recherche, Produktion, Text) nutzen
 * Claude, wenn Zugangsdaten vorhanden sind. Ohne Zugangsdaten arbeiten sie in
 * einem deterministischen Kompositionsmodus aus der Markendatenbank. Dieser
 * Modus wird in /api/health und in der Oberflaeche offen ausgewiesen - er wird
 * nicht als vollwertige Generierung ausgegeben.
 */
import Anthropic from '@anthropic-ai/sdk';
import { log } from '../observability/logger.js';

/** Opus 5 ist das aktuelle Standardmodell. Ueber ANTHROPIC_MODEL ueberschreibbar. */
const DEFAULT_MODEL = 'claude-opus-5';

export type LlmMode = 'anthropic' | 'deterministic';

let client: Anthropic | null = null;
let resolved = false;

/**
 * Der SDK-Client loest Zugangsdaten selbst auf (ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN oder ein `ant auth login`-Profil). Wir konstruieren ihn
 * daher ohne Argumente und behandeln das Fehlen von Zugangsdaten als
 * "deterministischer Modus" statt als Fehler.
 */
export function llmClient(): Anthropic | null {
  if (resolved) return client;
  resolved = true;
  const hasEnvCredential =
    !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  if (!hasEnvCredential) {
    log.warn(
      'Keine Anthropic-Zugangsdaten gefunden. Generative Agenten laufen im deterministischen Modus.',
    );
    client = null;
    return null;
  }
  try {
    client = new Anthropic();
  } catch (err) {
    log.error('Anthropic-Client konnte nicht initialisiert werden.', {
      error: (err as Error).message,
    });
    client = null;
  }
  return client;
}

export function llmMode(): LlmMode {
  return llmClient() ? 'anthropic' : 'deterministic';
}

export function llmModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export class LlmUnavailableError extends Error {
  constructor() {
    super('Kein LLM konfiguriert - der Aufrufer muss den deterministischen Pfad nutzen.');
  }
}

export class LlmRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(
      `Die Anfrage wurde vom Modell abgelehnt (Kategorie: ${category ?? 'unbekannt'}). ` +
        'Inhalt wurde nicht erzeugt.',
    );
  }
}

export interface GenerateOptions {
  system: string;
  user: string;
  /** JSON-Schema fuer strukturierte Ausgabe. Ohne Schema wird Text geliefert. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Ein Aufruf gegen die Messages API.
 *
 * Bewusst gesetzt:
 *  - `thinking: adaptive` - Claude entscheidet die Denktiefe selbst.
 *  - `output_config.effort` - steuert Aufwand und Kosten.
 *  - `fallbacks: "default"` - eine abgelehnte Anfrage wird serverseitig auf
 *    einem geeigneten Modell erneut versucht, statt als Fehler zu enden.
 *  - Kein `temperature`/`top_p` - auf Opus 5 nicht zulaessig.
 */
export async function generate(opts: GenerateOptions): Promise<string> {
  const c = llmClient();
  if (!c) throw new LlmUnavailableError();

  const maxTokens = opts.maxTokens ?? 8000;

  const body: Record<string, unknown> = {
    model: llmModel(),
    max_tokens: maxTokens,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: opts.effort ?? 'high',
      ...(opts.schema
        ? { format: { type: 'json_schema', schema: opts.schema } }
        : {}),
    },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };

  let response: any;
  try {
    response = await (c as any).beta.messages.create(body);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error('Anthropic-Ratenlimit erreicht. Bitte spaeter erneut versuchen.');
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('Anthropic-Zugangsdaten sind ungueltig oder abgelaufen.');
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new Error('Anthropic ist nicht erreichbar (Netzwerkfehler).');
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic-Fehler ${err.status}: ${err.message}`);
    }
    throw err;
  }

  // Ablehnungen kommen als HTTP 200 mit stop_reason "refusal" - vor dem
  // Zugriff auf content pruefen, sonst laeuft man in einen Indexfehler.
  if (response.stop_reason === 'refusal') {
    throw new LlmRefusalError(response.stop_details?.category ?? null);
  }
  if (response.stop_reason === 'max_tokens') {
    log.warn('LLM-Antwort wurde durch max_tokens abgeschnitten.', { maxTokens });
  }

  const text = (response.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  if (!text.trim()) {
    throw new Error('LLM lieferte eine leere Antwort.');
  }
  return text;
}

/** Wie `generate`, gibt aber ein validiertes Objekt zurueck. */
export async function generateJson<T>(
  opts: GenerateOptions & { schema: Record<string, unknown> },
): Promise<T> {
  const text = await generate(opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Manche Antworten kommen in einem Codeblock - defensiv extrahieren.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        /* faellt unten durch */
      }
    }
    throw new Error('LLM-Antwort war kein gueltiges JSON.');
  }
}
