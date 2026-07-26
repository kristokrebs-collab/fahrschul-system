import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { KOMPETENZFELDER, KOMPETENZSTATUS } from "@fahrschul/domain";
import { useSync } from "@fahrschul/ui";
import { apiMutate, ApiError, OfflineError, OfflineNotAllowedError } from "../api/client.js";
import { readDraft, writeDraft, clearDraft } from "../api/cache.js";
import { useDriveLock } from "../state/DriveLockContext.js";

/**
 * Stunde beenden – verpflichtender, geordneter 8-Schritt-Fluss (Spec):
 * 1) tatsächliche Dauer, 2) Stundenart, 3) Lernziele, 4) beobachtete
 * Kompetenzfelder, 5) Kurznotiz, 6) nächstes Ziel, 7) Schülerfeedback,
 * 8) Bestätigung. Ein Schritt kann erst betreten werden, wenn der vorherige
 * ausgefüllt ist ("wizard"-Zustand); die tatsächliche Durchsetzung, dass
 * KEIN unvollständiges Payload `lesson.completed` auslösen kann, ist
 * serverseitig über `lessonCompletionInputSchema`
 * (packages/domain/src/instructor.ts), siehe apps/api/src/routes/
 * instructor.ts. Der Berichtsentwurf (dieses Formular) ist offline
 * lesbar/entwerfbar (siehe api/cache.ts writeDraft) – das finale
 * "Stunde beenden" selbst ist NICHT offline möglich (Mutation).
 */
const STEPS = [
  "dauer",
  "stundenart",
  "lernziele",
  "kompetenz",
  "kurznotiz",
  "naechstesZiel",
  "schuelerfeedback",
  "bestaetigung",
] as const;

export function StundeBeenden() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { unlock } = useDriveLock();
  const sync = useSync();
  const draftKey = `stunde-beenden:${id}`;
  const draft = readDraft<Record<string, unknown>>(draftKey)?.data ?? {};

  const [stepIndex, setStepIndex] = useState(0);
  const [dauer, setDauer] = useState<string>(String(draft.tatsaechlicheDauerMinuten ?? ""));
  const [stundenart, setStundenart] = useState<string>((draft.stundenart as string) ?? "Übungsstunde");
  const [lernziele, setLernziele] = useState<string>((draft.lernzieleText as string) ?? "");
  const [kompetenzfeld, setKompetenzfeld] = useState(KOMPETENZFELDER[0]);
  const [kompetenzstatus, setKompetenzstatus] = useState(KOMPETENZSTATUS[0]);
  const [beobachtung, setBeobachtung] = useState("");
  const [kurznotiz, setKurznotiz] = useState<string>((draft.kurznotiz as string) ?? "");
  const [naechstesZiel, setNaechstesZiel] = useState<string>((draft.naechstesZiel as string) ?? "");
  const [schuelerfeedback, setSchuelerfeedback] = useState<string>((draft.schuelerfeedback as string) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function saveDraftAndNext() {
    writeDraft(draftKey, {
      tatsaechlicheDauerMinuten: dauer,
      stundenart,
      lernzieleText: lernziele,
      kurznotiz,
      naechstesZiel,
      schuelerfeedback,
    });
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setError(null);
    const nutzlast = {
      tatsaechlicheDauerMinuten: Number(dauer),
      stundenart,
      lernziele: lernziele.split(",").map((s) => s.trim()).filter(Boolean),
      beobachteteKompetenzfelder: [{ feld: kompetenzfeld, kompetenzstatus, beobachtung: beobachtung || null }],
      kurznotiz,
      naechstesZiel,
      schuelerfeedback,
      bestaetigung: true,
    };
    let vorgangId: string | null = null;
    try {
      /**
       * PROMPT -1 §7: "Stunde beenden" ist ein KRITISCHER Vorgang. Er wird –
       * mit seinem Idempotenzschlüssel – zuerst persistiert und erst nach der
       * Serverbestätigung als erfolgreich behandelt. Stirbt die App zwischen
       * Absenden und Antwort, fragt `resolvePendingAfterRestart` beim Server
       * mit genau diesem Schlüssel nach, statt blind zu wiederholen (was eine
       * zweite Fahrstunde abschließen könnte) oder einen Erfolg zu behaupten.
       */
      const vorgang = await sync.createCritical({
        method: "POST",
        path: `/instructor/lessons/${id}/complete`,
        body: nutzlast,
        bezeichnung: "Stunde beenden",
        target: id,
      });
      vorgangId = vorgang.operationId;
      await apiMutate(`/instructor/lessons/${id}/complete`, "POST", nutzlast, {
        idempotencyKey: vorgang.idempotencyKey,
      });
      // Serverbestätigung liegt vor -> Vorgang ist abgeschlossen.
      sync.discard(vorgang.operationId, { force: true });
      clearDraft(draftKey);
      unlock();
      navigate("/heute", { replace: true });
    } catch (err) {
      if (err instanceof OfflineNotAllowedError) {
        setError("Stunde beenden ist offline nicht möglich (Entwurf bleibt gespeichert).");
      } else if (err instanceof OfflineError) {
        setError("Stunde beenden erfordert eine Live-Verbindung (Entwurf bleibt gespeichert).");
      } else if (err instanceof ApiError) {
        setError("Unvollständige Angaben – bitte alle Schritte ausfüllen.");
      } else {
        setError("Unbekannter Fehler.");
      }
      // Der Vorgang bleibt in der Liste (Zustand `retrying`/`failed`/
      // `conflict`/`offline`) – nichts wird still verworfen. Nur ein
      // eindeutig NICHT gewirkter Vorgang (Validierungsfehler) wird entfernt,
      // damit die Liste nicht mit Formularfehlern volläuft.
      if (vorgangId && err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 409) {
        sync.discard(vorgangId, { force: true });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const step = STEPS[stepIndex];

  /**
   * Client-seitige Durchsetzung der Reihenfolge: "Weiter" ist erst
   * aktivierbar, wenn das Pflichtfeld des AKTUELLEN Schritts ausgefüllt
   * ist – der nächste Schritt ist also nicht erreichbar, solange der
   * vorherige unvollständig ist. Die eigentliche, nicht umgehbare
   * Durchsetzung bleibt serverseitig (`lessonCompletionInputSchema`).
   */
  const stepValues: Record<(typeof STEPS)[number], string> = {
    dauer,
    stundenart,
    lernziele,
    kompetenz: beobachtung || kompetenzfeld, // Auswahl ist immer gesetzt (Default), daher immer "erfüllt"
    kurznotiz,
    naechstesZiel,
    schuelerfeedback,
    bestaetigung: "true",
  };
  const currentStepFilled = stepValues[step].trim().length > 0;

  return (
    <main className="screen" data-testid="stunde-beenden">
      <h1>Stunde beenden</h1>
      <p>Schritt {stepIndex + 1} von {STEPS.length}: {step}</p>
      {error ? <p role="alert" className="form-error">{error}</p> : null}

      <form onSubmit={onSubmit}>
        {step === "dauer" ? (
          <>
            <label htmlFor="dauer">1) Tatsächliche Dauer (Minuten)</label>
            <input id="dauer" type="number" required value={dauer} onChange={(e) => setDauer(e.target.value)} />
          </>
        ) : null}
        {step === "stundenart" ? (
          <>
            <label htmlFor="stundenart">2) Stundenart</label>
            <input id="stundenart" required value={stundenart} onChange={(e) => setStundenart(e.target.value)} />
          </>
        ) : null}
        {step === "lernziele" ? (
          <>
            <label htmlFor="lernziele">3) Lernziele (kommagetrennt)</label>
            <input id="lernziele" required value={lernziele} onChange={(e) => setLernziele(e.target.value)} />
          </>
        ) : null}
        {step === "kompetenz" ? (
          <>
            <label htmlFor="feld">4) Beobachtetes Kompetenzfeld</label>
            <select id="feld" value={kompetenzfeld} onChange={(e) => setKompetenzfeld(e.target.value as typeof kompetenzfeld)}>
              {KOMPETENZFELDER.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select value={kompetenzstatus} onChange={(e) => setKompetenzstatus(e.target.value as typeof kompetenzstatus)}>
              {KOMPETENZSTATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <textarea placeholder="Beobachtung (rein beobachtbares Verhalten, keine Diagnose)" value={beobachtung} onChange={(e) => setBeobachtung(e.target.value)} />
          </>
        ) : null}
        {step === "kurznotiz" ? (
          <>
            <label htmlFor="kurznotiz">5) Kurznotiz</label>
            <textarea id="kurznotiz" required value={kurznotiz} onChange={(e) => setKurznotiz(e.target.value)} />
          </>
        ) : null}
        {step === "naechstesZiel" ? (
          <>
            <label htmlFor="naechstesZiel">6) Nächstes Ziel</label>
            <input id="naechstesZiel" required value={naechstesZiel} onChange={(e) => setNaechstesZiel(e.target.value)} />
          </>
        ) : null}
        {step === "schuelerfeedback" ? (
          <>
            <label htmlFor="schuelerfeedback">7) Schülerfeedback</label>
            <textarea id="schuelerfeedback" required value={schuelerfeedback} onChange={(e) => setSchuelerfeedback(e.target.value)} />
          </>
        ) : null}
        {step === "bestaetigung" ? (
          <>
            <p>8) Bestätigung: Bist du sicher, dass alle Angaben korrekt sind?</p>
            <button type="submit" className="fahrschul-btn fahrschul-btn--primary" disabled={submitting}>
              {submitting ? "Speichert…" : "Bestätigen & Stunde beenden"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="fahrschul-btn fahrschul-btn--primary"
            disabled={!currentStepFilled}
            onClick={saveDraftAndNext}
          >
            Weiter
          </button>
        )}
      </form>
    </main>
  );
}
