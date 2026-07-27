/**
 * Experimente.
 *
 * Der Auftrag sagt es deutlich: gewoehnliches organisches Posten liefert keine
 * Kausalitaet unter Laborbedingungen. Dieses Modul tut deshalb zwei Dinge, die
 * die meisten Marketing-Werkzeuge unterlassen:
 *
 *   1. Es weigert sich, einen Sieger auszurufen, bevor die Mindeststichprobe
 *      je Variante erreicht ist.
 *   2. Es benennt Stoergroessen ungefragt: unterschiedliche Sendezeiten,
 *      Themenueberschneidung, saisonale Effekte, ungleiche Gruppengroessen.
 */
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordEvent } from '../observability/logger.js';

export type ExperimentVariable =
  | 'hook'
  | 'opening_visual'
  | 'duration'
  | 'cover'
  | 'caption_length'
  | 'cta'
  | 'publish_time'
  | 'topic_framing';

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  variable: ExperimentVariable;
  variants_json: string;
  min_sample_per_variant: number;
  primary_metric: string;
  status: 'draft' | 'running' | 'concluded' | 'abandoned';
  started_at: string | null;
  concluded_at: string | null;
  conclusion: string | null;
  confounders: string | null;
  created_at: string;
}

export function createExperiment(input: {
  name: string;
  hypothesis: string;
  variable: ExperimentVariable;
  variants: string[];
  minSamplePerVariant?: number;
  primaryMetric?: string;
  actor: string;
}): Experiment {
  if (input.variants.length < 2) {
    throw new Error('Ein Experiment braucht mindestens zwei Varianten.');
  }
  if (input.variants.length > 4) {
    throw new Error(
      'Mehr als vier Varianten sind bei organischer Ausspielung nicht sinnvoll auswertbar - ' +
        'die Stichprobe je Variante wird zu klein.',
    );
  }
  const id = newId('exp');
  run(
    `INSERT INTO experiments
      (id, name, hypothesis, variable, variants_json, min_sample_per_variant, primary_metric,
       status, created_at)
     VALUES (?,?,?,?,?,?,?,'running',?)`,
    id,
    input.name,
    input.hypothesis,
    input.variable,
    JSON.stringify(input.variants),
    input.minSamplePerVariant ?? 5,
    input.primaryMetric ?? 'business_score',
    nowIso(),
  );
  run('UPDATE experiments SET started_at = ? WHERE id = ?', nowIso(), id);
  recordEvent({
    kind: 'experiment.created',
    actor: input.actor,
    entityType: 'experiment',
    entityId: id,
    message: `Experiment "${input.name}" gestartet. Variable: ${input.variable}, ${input.variants.length} Varianten.`,
  });
  return get<Experiment>('SELECT * FROM experiments WHERE id = ?', id)!;
}

export function assign(experimentId: string, itemId: string, actor: string): string {
  const exp = get<Experiment>('SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} nicht gefunden.`);
  if (exp.status !== 'running') throw new Error(`Experiment ist im Zustand "${exp.status}".`);

  const variants = parseJson<string[]>(exp.variants_json, []);
  const counts = all<{ variant: string; n: number }>(
    'SELECT variant, COUNT(*) AS n FROM experiment_assignments WHERE experiment_id = ? GROUP BY variant',
    experimentId,
  );
  const countMap = new Map(counts.map((c) => [c.variant, Number(c.n)]));
  // Gleichmaessige Zuteilung: immer die bislang kleinste Gruppe.
  const variant = variants
    .map((v) => ({ v, n: countMap.get(v) ?? 0 }))
    .sort((a, b) => a.n - b.n)[0].v;

  run(
    `INSERT INTO experiment_assignments (id, experiment_id, content_item_id, variant, assigned_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(experiment_id, content_item_id) DO NOTHING`,
    newId('exa'),
    experimentId,
    itemId,
    variant,
    nowIso(),
  );
  run(
    'UPDATE content_items SET experiment_id = ?, experiment_variant = ? WHERE id = ?',
    experimentId,
    variant,
    itemId,
  );
  recordEvent({
    kind: 'experiment.assigned',
    actor,
    entityType: 'content_item',
    entityId: itemId,
    message: `Beitrag Experiment "${exp.name}" zugeordnet, Variante "${variant}".`,
  });
  return variant;
}

export interface VariantResult {
  variant: string;
  n: number;
  meanVirality: number | null;
  meanBusiness: number | null;
  stdDevBusiness: number | null;
  items: string[];
}

export interface ExperimentAnalysis {
  experiment: Experiment;
  variants: VariantResult[];
  readyToConclude: boolean;
  blockingReason: string | null;
  leader: string | null;
  leadMargin: number | null;
  confounders: string[];
  verdict: string;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function analyze(experimentId: string): ExperimentAnalysis {
  const exp = get<Experiment>('SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} nicht gefunden.`);

  const variantNames = parseJson<string[]>(exp.variants_json, []);
  const rows = all<any>(
    `SELECT a.variant, a.content_item_id, c.scheduled_for, c.format, p.pillar,
            s.virality_score, s.business_score
     FROM experiment_assignments a
     JOIN content_items c ON c.id = a.content_item_id
     LEFT JOIN plan_items p ON p.id = c.plan_item_id
     LEFT JOIN scores s ON s.content_item_id = c.id AND s.window_key = 't7d'
     WHERE a.experiment_id = ?`,
    experimentId,
  );

  const variants: VariantResult[] = variantNames.map((name) => {
    const mine = rows.filter((r) => r.variant === name);
    const business = mine.map((r) => r.business_score).filter((x) => typeof x === 'number');
    const virality = mine.map((r) => r.virality_score).filter((x) => typeof x === 'number');
    return {
      variant: name,
      n: mine.length,
      meanVirality: mean(virality),
      meanBusiness: mean(business),
      stdDevBusiness: stdDev(business),
      items: mine.map((r) => r.content_item_id),
    };
  });

  // --- Stoergroessen offen benennen ------------------------------------
  const confounders: string[] = [];

  const hours = rows.map((r) => (r.scheduled_for ? new Date(r.scheduled_for).getHours() : null)).filter((h) => h !== null) as number[];
  if (hours.length > 1 && Math.max(...hours) - Math.min(...hours) > 4 && exp.variable !== 'publish_time') {
    confounders.push(
      `Die Beitraege wurden zwischen ${Math.min(...hours)}:00 und ${Math.max(...hours)}:00 Uhr ` +
        'veroeffentlicht. Die Sendezeit variiert staerker als die getestete Variable.',
    );
  }
  const pillars = new Set(rows.map((r) => r.pillar).filter(Boolean));
  if (pillars.size > 1) {
    confounders.push(
      `Die Beitraege verteilen sich auf ${pillars.size} verschiedene Inhaltssaeulen ` +
        `(${[...pillars].join(', ')}). Themenunterschiede ueberlagern den Variantenunterschied.`,
    );
  }
  const formats = new Set(rows.map((r) => r.format));
  if (formats.size > 1) {
    confounders.push(`Unterschiedliche Formate im Test (${[...formats].join(', ')}).`);
  }
  const sizes = variants.map((v) => v.n);
  if (sizes.length > 1 && Math.max(...sizes) > 2 * Math.min(...sizes) && Math.min(...sizes) > 0) {
    confounders.push(
      `Ungleiche Gruppengroessen (${sizes.join(' vs ')}). Der Mittelwert der kleineren Gruppe ist instabil.`,
    );
  }
  const dates = rows.map((r) => (r.scheduled_for ? new Date(r.scheduled_for).getTime() : null)).filter(Boolean) as number[];
  if (dates.length > 1 && Math.max(...dates) - Math.min(...dates) > 45 * 86400_000) {
    confounders.push(
      'Der Testzeitraum umspannt mehr als sechs Wochen. Saisonale Nachfrage und Aenderungen ' +
        'an der Ausspielung der Plattform wirken mit.',
    );
  }

  // --- Abbruchregel ----------------------------------------------------
  const under = variants.filter((v) => v.n < exp.min_sample_per_variant);
  let blockingReason: string | null = null;
  if (under.length > 0) {
    blockingReason =
      `Mindeststichprobe nicht erreicht: ${under
        .map((v) => `"${v.variant}" hat ${v.n} von ${exp.min_sample_per_variant}`)
        .join(', ')}. Es wird kein Sieger ausgerufen.`;
  }
  const withoutData = variants.filter((v) => v.meanBusiness === null);
  if (!blockingReason && withoutData.length > 0) {
    blockingReason = `Fuer ${withoutData.map((v) => `"${v.variant}"`).join(', ')} liegen noch keine 7-Tage-Bewertungen vor.`;
  }

  const scored = variants.filter((v) => v.meanBusiness !== null).sort((a, b) => b.meanBusiness! - a.meanBusiness!);
  const leader = scored[0]?.variant ?? null;
  const leadMargin =
    scored.length >= 2 && scored[0].meanBusiness !== null && scored[1].meanBusiness !== null
      ? Math.round((scored[0].meanBusiness - scored[1].meanBusiness) * 10) / 10
      : null;

  // Vorsprung im Verhaeltnis zur Streuung. Ist der Abstand kleiner als die
  // Streuung innerhalb einer Gruppe, ist er Rauschen.
  let verdict: string;
  if (blockingReason) {
    verdict = blockingReason;
  } else if (leadMargin === null) {
    verdict = 'Zu wenige bewertete Varianten fuer einen Vergleich.';
  } else {
    const noise = Math.max(scored[0].stdDevBusiness ?? 0, scored[1]?.stdDevBusiness ?? 0);
    if (noise > 0 && leadMargin < noise) {
      verdict =
        `"${leader}" liegt mit ${leadMargin} Punkten vorn, die Streuung innerhalb der Gruppen ` +
        `betraegt aber ${Math.round(noise * 10) / 10} Punkte. Der Unterschied ist nicht von Rauschen zu trennen. ` +
        'Empfehlung: weiterlaufen lassen.';
    } else {
      verdict =
        `"${leader}" fuehrt beim Business Impact um ${leadMargin} Punkte bei ` +
        `n=${scored[0].n} je Gruppe. Das ist ein brauchbarer Hinweis, kein Beweis.` +
        (confounders.length ? ` Zu beruecksichtigen: ${confounders.length} Stoergroesse(n).` : '');
    }
  }

  return {
    experiment: exp,
    variants,
    readyToConclude: !blockingReason,
    blockingReason,
    leader,
    leadMargin,
    confounders,
    verdict,
  };
}

export function conclude(experimentId: string, actor: string, force = false): ExperimentAnalysis {
  const analysis = analyze(experimentId);
  if (!analysis.readyToConclude && !force) {
    throw new Error(
      `${analysis.blockingReason} Ein Abschluss waere unseriös. Mit force=true bewusst ueberstimmbar.`,
    );
  }
  const conclusion = force && !analysis.readyToConclude
    ? `${analysis.verdict} [Vorzeitig abgeschlossen durch ${actor} trotz unzureichender Datenlage.]`
    : analysis.verdict;

  run(
    `UPDATE experiments SET status = 'concluded', concluded_at = ?, conclusion = ?, confounders = ? WHERE id = ?`,
    nowIso(),
    conclusion,
    analysis.confounders.join('\n'),
    experimentId,
  );
  recordEvent({
    kind: 'experiment.concluded',
    actor,
    severity: force && !analysis.readyToConclude ? 'warn' : 'info',
    entityType: 'experiment',
    entityId: experimentId,
    message: conclusion,
  });
  return { ...analysis, verdict: conclusion };
}

export function listExperiments() {
  return all<Experiment>('SELECT * FROM experiments ORDER BY created_at DESC').map((e) => ({
    ...e,
    variants: parseJson<string[]>(e.variants_json, []),
  }));
}
