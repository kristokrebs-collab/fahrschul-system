import { featureFlags } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import type { FeatureFlagState } from "@fahrschul/domain";
import { and, eq, isNull, or } from "drizzle-orm";

/**
 * Einfacher Feature-Flag-Mechanismus (siehe packages/domain/src/curriculum.ts
 * featureFlagSchema). Ein standortspezifischer Eintrag überschreibt den
 * organisationsweiten Default (standort_id = null). Fehlt der Key komplett,
 * ist der Default "hidden" (fail closed, nie versehentlich live).
 */
export async function getFlagState(
  db: Database,
  key: string,
  standortId: string | null,
): Promise<FeatureFlagState> {
  const scopeFilter = standortId
    ? or(isNull(featureFlags.standortId), eq(featureFlags.standortId, standortId))
    : isNull(featureFlags.standortId);

  const rows = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.key, key), scopeFilter));

  const specific = standortId ? rows.find((r) => r.standortId === standortId) : undefined;
  const fallback = rows.find((r) => r.standortId === null);
  return (specific ?? fallback)?.state as FeatureFlagState | undefined ?? "hidden";
}
