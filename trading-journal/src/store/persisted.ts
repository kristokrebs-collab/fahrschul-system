import { useJournal } from "@/store/journalStore";

/** Thrown when a write went through but nothing keeps it (session-only store): the UI must not call that "gespeichert". */
export class NotPersistedError extends Error {
  constructor(message = "Dieser Browser speichert nichts dauerhaft – die Änderung gilt nur bis zum Neuladen.") {
    super(message);
    this.name = "NotPersistedError";
  }
}

/**
 * The honest end of a save: runs `write` (the promise of the journal store / server call), waits for it, and only then
 * checks that the journal really persists (`storage !== "unavailable"` – a store that runs in memory resolves too, but keeps
 * nothing across a reload). Returns what `write` returned; a rejection or a memory-only store throws, so `SaveMorph` shows
 * the failure with „Erneut versuchen“ instead of a ✓. Nothing is reported as saved because a button was clicked.
 */
export async function persisted<T>(write: () => Promise<T> | T): Promise<T> {
  const result = await write();
  if (useJournal.getState().storage === "unavailable") throw new NotPersistedError();
  return result;
}
