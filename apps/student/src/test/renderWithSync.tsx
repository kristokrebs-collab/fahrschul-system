import { SyncProvider } from "@fahrschul/ui";
import { memoryKeyValueStore, type RealtimeTransport, type SyncTransport } from "@fahrschul/sync";
import type { ReactNode } from "react";

/**
 * PROMPT -1 Phase 2 – Testhülle für Ansichten, die den Synchronisationskern
 * benutzen.
 *
 * Bewusst mit `autoStart={false}` und einem Transport, der NICHTS tut: ein
 * Komponententest soll die Ansicht prüfen, nicht den Kanal (der hat eigene
 * Tests in `packages/sync` und `apps/api`). `queueIntervalMs: 0` schaltet den
 * Hintergrundlauf ab, damit ein Test keine Zeitgeber hinterlässt.
 *
 * Der Speicher ist ein In-Memory-Speicher – kein Test schreibt in das echte
 * `localStorage` der Suite und beeinflusst damit einen anderen.
 */
export function stillerRealtimeTransport(): RealtimeTransport {
  return {
    online: () => true,
    openStream: () => ({ close() {} }),
    async poll(cursor) {
      return {
        changes: [],
        cursor,
        latestCursor: cursor,
        resyncRequired: false,
        resyncReason: null,
        hasMore: false,
      };
    },
  };
}

export function stillerSyncTransport(overrides: Partial<SyncTransport> = {}): SyncTransport {
  return {
    online: () => true,
    async send() {
      return { status: 200, ok: true, body: {}, outcomeUnknown: false };
    },
    async identity() {
      return { benutzerId: "test-benutzer" };
    },
    async lookupOperation() {
      return { status: "unknown" as const };
    },
    ...overrides,
  };
}

export function WithSync({
  children,
  syncTransport,
  benutzerId = "test-benutzer",
}: {
  children: ReactNode;
  syncTransport?: SyncTransport;
  benutzerId?: string | null;
}) {
  return (
    <SyncProvider
      apiBase="http://localhost:4000"
      benutzerId={benutzerId}
      storagePrefix="test:"
      store={memoryKeyValueStore()}
      realtimeTransport={stillerRealtimeTransport()}
      syncTransport={syncTransport ?? stillerSyncTransport()}
      autoStart={false}
      queueIntervalMs={0}
    >
      {children}
    </SyncProvider>
  );
}
