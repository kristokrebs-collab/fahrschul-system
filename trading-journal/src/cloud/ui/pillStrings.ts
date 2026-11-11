/**
 * Strings of the header's account / sync pill (P09) – a module of their own, so the pill (part of the first load) does
 * not pull every cloud string into the app chunk (P14 bundle). `strings.ts` re-exports `PILL`.
 */
export const PILL = {
  signIn: "Anmelden",
  live: "Sync · live",
  connecting: "Verbinde …",
  syncing: "Synchronisiert …",
  offline: "Offline",
  error: "Sync-Fehler",
  paused: "Sync pausiert",
  locked: "2FA-Code fehlt",
  signedIn: "Angemeldet",
  accountLabel: (email: string | null) => (email ? `Konto: ${email}` : "Konto"),
} as const;
