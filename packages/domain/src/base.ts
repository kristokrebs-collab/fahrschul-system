import { z } from "zod";

/**
 * Felder, die laut Prompt-0-Spezifikation jede Entität besitzen muss:
 * id (uuid), status, version, created_at, updated_at, standort_id (wo zutreffend).
 */
export const baseEntitySchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type BaseEntity = z.infer<typeof baseEntitySchema>;

export const baseEntityWithStandortSchema = baseEntitySchema.extend({
  standortId: z.string().uuid().nullable(),
});

export type BaseEntityWithStandort = z.infer<typeof baseEntityWithStandortSchema>;
