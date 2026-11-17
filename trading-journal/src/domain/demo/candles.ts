/**
 * Beispiel-Kerzen der Demo (F58): KÜNSTLICH, aus Sinus-Wellen berechnet – kein Zufall, keine Uhr, kein Netz, keine echten Kurse.
 * Dieselben Zahlen bei jedem Aufruf und auf jedem Gerät (auf drei Nachkommastellen gerundet). Sie sind so gebaut, dass Regeln
 * in der Demo etwas zu tun bekommen (Trendphasen, Rücksetzer, ruhige und unruhige Stücke); sie sagen NICHTS über einen echten
 * Markt, und die Demo nennt sie überall „Beispiel-Kerzen“. Die Zeitstempel sind nur eine Zählung (die Demo zeigt nie ein Datum).
 *
 * Aus den 1h-Kerzen entstehen 2h, 4h und 1D durch vollständige Zeitfenster – dieselbe Zusammenfassung wie im Labor
 * (`aggregateBars`).
 */
import { aggregateBars } from "../backtest/bars";
import type { Bar, BarsBy } from "../backtest/types";

/** 250 Tage in Stunden-Kerzen. */
export const DEMO_BARS = 6000;
/** Erste Kerze: ein Montag 00:00 UTC (nur damit Tages- und Wochenfenster sauber aufgehen). */
export const DEMO_T0 = 1_704_067_200;
/** Gezeigter Name des Beispielmarkts: ein erfundenes Kürzel, keine Börse, kein Paar. */
export const DEMO_MARKET = "DEMO";

const TAU = Math.PI * 2;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Schlusskurs der Kerze i: Trend, drei Wellen und eine langsame Schwankung der Wellenhöhe. */
function closeAt(i: number): number {
  const regime = 1 + 0.45 * Math.sin((TAU * i) / 1300 + 0.4);
  const waves = 9 * Math.sin((TAU * i) / 410) + 5 * Math.sin((TAU * i) / 97 + 0.6) + 2.2 * Math.sin((TAU * i) / 29 + 1.3) + 0.9 * Math.sin((TAU * i) / 7.3);
  return 100 + 0.0011 * i + regime * waves;
}

let cache: { h1: Bar[]; byTf: BarsBy } | null = null;

function build(): { h1: Bar[]; byTf: BarsBy } {
  const h1: Bar[] = [];
  let prev = closeAt(-1);
  for (let i = 0; i < DEMO_BARS; i++) {
    const c = closeAt(i);
    const o = prev;
    // Dochte: immer positiv, mal länger, mal kürzer
    const up = 0.18 + 0.16 * (1 + Math.sin((TAU * i) / 17 + 0.7));
    const dn = 0.18 + 0.16 * (1 + Math.sin((TAU * i) / 23 + 2.1));
    const range = Math.abs(c - o);
    const v = 800 + 420 * (1 + Math.sin((TAU * i) / 31)) + 260 * range;
    h1.push({ t: DEMO_T0 + i * 3600, o: r3(o), h: r3(Math.max(o, c) + up), l: r3(Math.min(o, c) - dn), c: r3(c), v: Math.round(v) });
    prev = c;
  }
  const bucket = (sec: number) => (t: number) => Math.floor((t - DEMO_T0) / sec) * sec + DEMO_T0;
  const h2 = aggregateBars(h1, bucket(7200), 2);
  const h4 = aggregateBars(h1, bucket(14_400), 4);
  const d1 = aggregateBars(h1, bucket(86_400), 24);
  return { h1, byTf: { "1h": h1, "2h": h2, "4h": h4, "1d": d1 } };
}

/** Die Beispiel-Kerzen aller Zeiteinheiten (1h, 2h, 4h, 1D). Berechnet beim ersten Aufruf, danach dieselben Objekte. */
export function demoBars(): BarsBy {
  cache ??= build();
  return cache.byTf;
}

/** Nur die 1h-Kerzen (die Ausgangsreihe). */
export function demoHourly(): readonly Bar[] {
  cache ??= build();
  return cache.h1;
}

/** Zeiteinheiten, in denen die Demo rechnet (alles andere läuft in der Demo auf 1h, mit Hinweis). */
export const DEMO_INTERVALS = ["1h", "2h", "4h", "1d"] as const;
export type DemoInterval = (typeof DEMO_INTERVALS)[number];
export const isDemoInterval = (v: string): v is DemoInterval => (DEMO_INTERVALS as readonly string[]).includes(v);

/** Die Kennzeichnung, die jede Karte der Demo trägt. */
export const DEMO_TAG = "Beispiel – nicht deine Daten";
/** Warum die Kerzen nichts über einen Markt sagen. */
export const DEMO_CANDLES_NOTE = "Künstliche Beispiel-Kerzen aus Sinus-Wellen berechnet – kein Zufall, keine echten Kurse. Die Zahlen zeigen, wie die Rechnung arbeitet, nicht, wie ein Markt sich verhält.";
