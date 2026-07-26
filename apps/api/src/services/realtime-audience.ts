import {
  benutzer,
  dokumente,
  fahrlehrer,
  fahrstundenFeedback,
  fahrzeugmaengel,
  finanzExporte,
  kompetenzbeobachtungen,
  leads,
  nachrichten,
  pruefungen,
  pruefungsfreigaben,
  rechnungen,
  schueler,
  sprachprotokolle,
  stornoAngebote,
  stornoEvents,
  terminangebote,
  terminbuchungen,
  verfuegbarkeiten,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import {
  benutzerAudience,
  fahrlehrerAudience,
  resolveSyncDataType,
  rolleAudience,
  schuelerAudience,
  standortRoleAudience,
  type SyncDataType,
} from "@fahrschul/domain";
import type { OutboxEnvelope } from "@fahrschul/events";
import { and, eq, isNull } from "drizzle-orm";

/**
 * PROMPT -1 §6 – WER darf erfahren, DASS ein Ereignis passiert ist?
 *
 * Das ist der heikelste Teil des Realtime-Kanals. Ein Kanal, der einfach
 * `event_outbox` weiterreicht, ist ein Informationsleck: schon die REINE
 * EXISTENZ einer Ereignis-ID verrät, dass es einen Datensatz gibt, den der
 * Abonnent gar nicht lesen darf ("Schüler A erfährt, dass Schüler B gerade
 * gebucht hat"). Deshalb:
 *
 *  1. Die Zustellzeile wird PRO EMPFÄNGER geschrieben (`realtime_deliveries`),
 *     nie global gelesen. Ein Abonnent liest ausschließlich Zeilen, deren
 *     `audience_key` er laut Sitzung besitzt.
 *  2. Die Empfängermenge wird aus den FACHTABELLEN aufgelöst – nicht aus dem
 *     Ereignis geraten. `event_outbox` kennt nur `standort_id` und
 *     `aggregate_id`; ob ein Schüler einen Termin lesen darf, steht dort nicht.
 *  3. Die Zeile trägt KEINE Nutzlast, nur `event_id` + grobes `data_type`.
 *     Selbst wenn ein Schlüssel falsch aufgelöst würde, wäre der Schaden auf
 *     "weiß, dass sich etwas geändert hat" begrenzt – die anschließende
 *     Neuabfrage läuft durch die normale, unveränderte Autorisierung.
 *     Das ist Verteidigung in der Tiefe, KEINE Entschuldigung für Punkt 2.
 *  4. Unbekanntes Aggregat = FAIL CLOSED. Kein Schüler-, kein
 *     Fahrlehrer-Schlüssel; nur Büro (Standort) und Geschäftsführung, die
 *     ohnehin `*:read:any` besitzen. Ein Test prüft, dass JEDER in
 *     `event_schema_versions` eingetragene Ereignistyp eine explizite
 *     Auflösung hat, damit dieser Fall nicht stillschweigend eintritt.
 *
 * `systemdienst` erhält bewusst KEINEN fachlichen Schlüssel – das
 * Non-Negotiable "systemdienst hat keinen Zugriff auf Schülerdaten" gilt auch
 * für die Metadaten "es hat sich etwas bei Schüler X geändert".
 */

export interface AudienceResolution {
  dataType: SyncDataType;
  audienceKeys: string[];
  /** true, wenn das Aggregat unbekannt war und fail-closed aufgelöst wurde. */
  fallback: boolean;
}

/** Rolle der Fahrlehrer als Standort-Zielgruppe (z. B. "mein Fahrzeug ist gesperrt"). */
const ROLLE_FAHRLEHRER = "fahrlehrer";
const ROLLE_BUERO = "buero";
const ROLLE_SCHUELER = "schueler";

function unique(keys: Array<string | null | undefined>): string[] {
  return [...new Set(keys.filter((k): k is string => typeof k === "string" && k.length > 0))];
}

/**
 * Löst die Empfänger eines Outbox-Ereignisses auf. Gibt `null` zurück, wenn
 * der Ereignistyp gar kein Realtime-Thema hat (z. B. `job.*`-Läufe) – dann
 * wird nichts zugestellt.
 */
export async function resolveAudience(
  db: Database,
  envelope: OutboxEnvelope,
): Promise<AudienceResolution | null> {
  const dataType = resolveSyncDataType(envelope.eventType, envelope.aggregateType);
  if (!dataType) return null;

  const standortId = envelope.standortId;
  const payload = envelope.payload as { akteurBenutzerId?: string | null } | undefined;
  const akteur = payload?.akteurBenutzerId ?? null;

  // Geschäftsführung besitzt organisationsweite Leserechte (students/
  // appointments/documents/invoices :read:any) und ist deshalb bei JEDEM
  // fachlichen Ereignis Empfänger. Büro nur an seinem Standort.
  const basis = [rolleAudience("geschaeftsfuehrung"), standortRoleAudience(standortId, ROLLE_BUERO)];

  const aggregateId = envelope.aggregateId;
  const aggregateType = envelope.aggregateType ?? "";

  switch (aggregateType) {
    case "terminbuchung": {
      if (!aggregateId) break;
      const [row] = await db
        .select({
          schuelerId: terminbuchungen.schuelerId,
          fahrlehrerId: terminbuchungen.fahrlehrerId,
          standortId: terminbuchungen.standortId,
        })
        .from(terminbuchungen)
        .where(eq(terminbuchungen.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        schuelerAudience(row.schuelerId),
        fahrlehrerAudience(row.fahrlehrerId),
      ]);
    }

    case "terminangebot": {
      // Ein offenes Terminangebot ist ein POOL: `GET /appointment-offers`
      // liefert es jedem angemeldeten Nutzer (erste gültige Annahme gewinnt).
      // Deshalb ist "alle Schüler des Standorts" hier KEINE Ausweitung des
      // Leserechts, sondern eine Einschränkung davon.
      if (!aggregateId) break;
      const [row] = await db
        .select({ fahrlehrerId: terminangebote.fahrlehrerId, standortId: terminangebote.standortId })
        .from(terminangebote)
        .where(eq(terminangebote.id, aggregateId))
        .limit(1);
      const sid = row?.standortId ?? standortId;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(sid, ROLLE_BUERO),
        standortRoleAudience(sid, ROLLE_SCHUELER),
        row ? fahrlehrerAudience(row.fahrlehrerId) : null,
      ]);
    }

    case "dokument": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ schuelerId: dokumente.schuelerId, standortId: dokumente.standortId })
        .from(dokumente)
        .where(eq(dokumente.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        schuelerAudience(row.schuelerId),
      ]);
    }

    case "rechnung": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ schuelerId: rechnungen.schuelerId, standortId: rechnungen.standortId })
        .from(rechnungen)
        .where(eq(rechnungen.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        rolleAudience("finanzen"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        schuelerAudience(row.schuelerId),
      ]);
    }

    case "banktransaktion": {
      // Bankdaten sind bewusst NICHT schülersichtbar – auch nicht als
      // "es hat sich etwas geändert". Nur Finanzen + Geschäftsführung.
      return ok(dataType, [rolleAudience("geschaeftsfuehrung"), rolleAudience("finanzen")]);
    }

    case "pruefung": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ schuelerId: pruefungen.schuelerId, standortId: pruefungen.standortId })
        .from(pruefungen)
        .where(eq(pruefungen.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_FAHRLEHRER),
        schuelerAudience(row.schuelerId),
      ]);
    }

    case "pruefungsfreigabe": {
      if (!aggregateId) break;
      const [row] = await db
        .select({
          schuelerId: pruefungsfreigaben.schuelerId,
          standortId: pruefungsfreigaben.standortId,
        })
        .from(pruefungsfreigaben)
        .where(eq(pruefungsfreigaben.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_FAHRLEHRER),
        schuelerAudience(row.schuelerId),
      ]);
    }

    case "fahrstunden_feedback": {
      // WICHTIG für den Redaktionsvertrag: der Schüler erfährt nur, DASS es
      // neues Feedback gibt. Den Inhalt holt er über `GET /me/feedback`, das
      // `internalNotes` nicht einmal aus der Datenbank selektiert. Der Kanal
      // trägt niemals Feedbacktext.
      if (!aggregateId) break;
      const [row] = await db
        .select({
          schuelerId: fahrstundenFeedback.schuelerId,
          fahrlehrerId: fahrstundenFeedback.fahrlehrerId,
          standortId: fahrstundenFeedback.standortId,
        })
        .from(fahrstundenFeedback)
        .where(eq(fahrstundenFeedback.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        schuelerAudience(row.schuelerId),
        fahrlehrerAudience(row.fahrlehrerId),
      ]);
    }

    case "fahrzeugmangel": {
      if (!aggregateId) break;
      const [row] = await db
        .select({
          standortId: fahrzeugmaengel.standortId,
          gemeldetVonBenutzerId: fahrzeugmaengel.gemeldetVonBenutzerId,
        })
        .from(fahrzeugmaengel)
        .where(eq(fahrzeugmaengel.id, aggregateId))
        .limit(1);
      const sid = row?.standortId ?? standortId;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(sid, ROLLE_BUERO),
        standortRoleAudience(sid, ROLLE_FAHRLEHRER),
        row?.gemeldetVonBenutzerId ? benutzerAudience(row.gemeldetVonBenutzerId) : null,
      ]);
    }

    case "fahrzeug": {
      // Eine Fahrzeugsperre betrifft jeden Fahrlehrer des Standorts (sein
      // Tagesplan kann kippen), aber keinen Schüler direkt – der erfährt es
      // über das Termin-Ereignis, das der Sperre folgt.
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(standortId, ROLLE_BUERO),
        standortRoleAudience(standortId, ROLLE_FAHRLEHRER),
      ]);
    }

    case "verfuegbarkeit": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ fahrlehrerId: verfuegbarkeiten.fahrlehrerId, standortId: verfuegbarkeiten.standortId })
        .from(verfuegbarkeiten)
        .where(eq(verfuegbarkeiten.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        fahrlehrerAudience(row.fahrlehrerId),
      ]);
    }

    case "schueler_verfuegbarkeit": {
      // entitaetId IST hier die Schüler-ID (siehe routes/student.ts).
      if (!aggregateId) break;
      return ok(dataType, [...basis, schuelerAudience(aggregateId)]);
    }

    case "flex_opt_in": {
      // entitaetId IST hier die Schüler-ID (siehe routes/flex.ts).
      if (!aggregateId) break;
      return ok(dataType, [...basis, schuelerAudience(aggregateId)]);
    }

    case "schueler": {
      if (!aggregateId) break;
      return ok(dataType, [...basis, schuelerAudience(aggregateId)]);
    }

    case "storno_event": {
      // Der Storno-Retter bietet gezielt ausgewählten Schülern an. Nur DIESE
      // dürfen erfahren, dass es etwas gibt – nicht der ganze Standort.
      if (!aggregateId) break;
      const [event] = await db
        .select({ terminbuchungId: stornoEvents.terminbuchungId, standortId: stornoEvents.standortId })
        .from(stornoEvents)
        .where(eq(stornoEvents.id, aggregateId))
        .limit(1);
      const angebote = await db
        .select({ schuelerId: stornoAngebote.schuelerId })
        .from(stornoAngebote)
        .where(eq(stornoAngebote.stornoEventId, aggregateId));
      const keys: Array<string | null> = [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(event?.standortId ?? standortId, ROLLE_BUERO),
        ...angebote.map((a) => schuelerAudience(a.schuelerId)),
      ];
      if (event?.terminbuchungId) {
        const [booking] = await db
          .select({
            schuelerId: terminbuchungen.schuelerId,
            fahrlehrerId: terminbuchungen.fahrlehrerId,
          })
          .from(terminbuchungen)
          .where(eq(terminbuchungen.id, event.terminbuchungId))
          .limit(1);
        if (booking) {
          keys.push(schuelerAudience(booking.schuelerId), fahrlehrerAudience(booking.fahrlehrerId));
        }
      }
      return ok(dataType, keys);
    }

    case "nachricht": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ schuelerId: nachrichten.schuelerId, standortId: nachrichten.standortId })
        .from(nachrichten)
        .where(eq(nachrichten.id, aggregateId))
        .limit(1);
      // Der Schüler bekommt seine Nachricht in der App zu sehen; das
      // Sende-Log selbst bleibt Büro/Geschäftsführung.
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row?.standortId ?? standortId, ROLLE_BUERO),
        row?.schuelerId ? schuelerAudience(row.schuelerId) : null,
      ]);
    }

    case "lead": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ standortId: leads.standortId })
        .from(leads)
        .where(eq(leads.id, aggregateId))
        .limit(1);
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row?.standortId ?? standortId, ROLLE_BUERO),
      ]);
    }

    case "kompetenzbeobachtung": {
      // Kompetenzraster ist FAHRLEHRER-Material (`competency:read:own` hat nur
      // der Fahrlehrer). Der Schüler erfährt hiervon NICHTS.
      if (!aggregateId) break;
      const [row] = await db
        .select({
          fahrlehrerId: kompetenzbeobachtungen.fahrlehrerId,
          standortId: kompetenzbeobachtungen.standortId,
        })
        .from(kompetenzbeobachtungen)
        .where(eq(kompetenzbeobachtungen.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        standortRoleAudience(row.standortId ?? standortId, ROLLE_BUERO),
        fahrlehrerAudience(row.fahrlehrerId),
      ]);
    }

    case "sprachprotokoll": {
      // Rohes Sprachprotokoll ist interne Dokumentation des Fahrlehrers.
      // Ausschließlich er selbst (nicht einmal das Büro-Sammelthema).
      if (!aggregateId) break;
      const [row] = await db
        .select({
          fahrlehrerId: sprachprotokolle.fahrlehrerId,
          standortId: sprachprotokolle.standortId,
        })
        .from(sprachprotokolle)
        .where(eq(sprachprotokolle.id, aggregateId))
        .limit(1);
      if (!row) break;
      return ok(dataType, [fahrlehrerAudience(row.fahrlehrerId)]);
    }

    case "finanz_export": {
      if (!aggregateId) break;
      const [row] = await db
        .select({ angefordertVonBenutzerId: finanzExporte.angefordertVonBenutzerId })
        .from(finanzExporte)
        .where(eq(finanzExporte.id, aggregateId))
        .limit(1);
      return ok(dataType, [
        rolleAudience("geschaeftsfuehrung"),
        rolleAudience("finanzen"),
        row ? benutzerAudience(row.angefordertVonBenutzerId) : null,
      ]);
    }

    default:
      break;
  }

  // FAIL CLOSED: unbekanntes oder nicht auflösbares Aggregat -> nur Rollen mit
  // ohnehin organisationsweitem/standortweitem Leserecht. Zusätzlich der
  // Akteur selbst, der die Änderung ausgelöst hat.
  return {
    dataType,
    audienceKeys: unique([...basis, akteur ? benutzerAudience(akteur) : null]),
    fallback: true,
  };
}

function ok(dataType: SyncDataType, keys: Array<string | null | undefined>): AudienceResolution {
  return { dataType, audienceKeys: unique(keys), fallback: false };
}

/**
 * ZWEITE SCHICHT: Auflösung der Fach-Zielgruppen ("Schüler S", "Büro am
 * Standort X") auf KONKRETE Benutzer.
 *
 * Warum zwei Schichten? Weil der Client EINEN einzigen, dichten Cursor
 * braucht. Läge die Zustellzeile auf `standort:X:buero`, hätte jeder
 * Abonnent mehrere Cursor (einen je Zielgruppe) und müsste sie als Vektor
 * verwalten – fehleranfällig und schwer wiederaufzunehmen. Deshalb ist die
 * ZUSTELLADRESSE immer `benutzer:<id>`: ein Abonnent liest ausschließlich
 * seine eigene, lückenlose Folge 1, 2, 3, … Die Fach-Zielgruppen aus
 * `resolveAudience` sind die AUTORISIERUNGSREGEL, diese Funktion ist die
 * Adressumsetzung.
 *
 * `systemdienst` wird bewusst NIE als Empfänger einer Fach-Zielgruppe
 * aufgelöst – das Non-Negotiable "systemdienst hat keinen Zugriff auf
 * Schülerdaten" gilt auch für die Metainformation "bei Schüler X hat sich
 * etwas geändert". Nur sein eigener `benutzer:<id>`-Schlüssel (z. B. ein von
 * ihm selbst ausgelöster Export) erreicht ihn.
 */
export async function expandAudienceToBenutzer(
  db: Database,
  audienceKeys: readonly string[],
): Promise<string[]> {
  const benutzerIds = new Set<string>();

  for (const key of audienceKeys) {
    const teile = key.split(":");
    if (teile[0] === "benutzer" && teile[1]) {
      benutzerIds.add(teile[1]);
      continue;
    }
    if (teile[0] === "schueler" && teile[1]) {
      const [row] = await db
        .select({ benutzerId: schueler.benutzerId })
        .from(schueler)
        .where(eq(schueler.id, teile[1]))
        .limit(1);
      if (row?.benutzerId) benutzerIds.add(row.benutzerId);
      continue;
    }
    if (teile[0] === "fahrlehrer" && teile[1]) {
      const [row] = await db
        .select({ benutzerId: fahrlehrer.benutzerId })
        .from(fahrlehrer)
        .where(eq(fahrlehrer.id, teile[1]))
        .limit(1);
      if (row?.benutzerId) benutzerIds.add(row.benutzerId);
      continue;
    }
    if (teile[0] === "standort" && teile[1] && teile[2]) {
      const rows = await db
        .select({ id: benutzer.id })
        .from(benutzer)
        .where(
          and(
            eq(benutzer.rolle, teile[2]),
            eq(benutzer.status, "aktiv"),
            teile[1] === "unbekannt"
              ? isNull(benutzer.standortId)
              : eq(benutzer.standortId, teile[1]),
          ),
        );
      for (const r of rows) benutzerIds.add(r.id);
      continue;
    }
    if (teile[0] === "rolle" && teile[1]) {
      const rows = await db
        .select({ id: benutzer.id })
        .from(benutzer)
        .where(and(eq(benutzer.rolle, teile[1]), eq(benutzer.status, "aktiv")));
      for (const r of rows) benutzerIds.add(r.id);
      continue;
    }
  }

  return [...benutzerIds];
}

/**
 * Die EINE Zustelladresse eines Abonnenten. Wird ausschließlich aus der
 * serverseitig geladenen Sitzung gebildet – ein Client kann sie nicht wählen.
 */
export function subscriberDeliveryKey(benutzerId: string): string {
  return benutzerAudience(benutzerId);
}
