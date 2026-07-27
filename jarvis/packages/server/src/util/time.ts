export function nowIso(d: Date | number = Date.now()): string {
  return new Date(d).toISOString()
}

export function plus(ms: number, from: number = Date.now()): string {
  return new Date(from + ms).toISOString()
}

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export function isPast(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return !Number.isNaN(t) && t <= now
}

export function ageDays(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now - t) / DAY
}

/** German-language relative time, for briefings and task lists. */
export function relDe(iso: string | null, now = Date.now()): string {
  if (!iso) return 'ohne Termin'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unbekannt'
  const diff = t - now
  const abs = Math.abs(diff)
  const d = Math.round(abs / DAY), h = Math.round(abs / HOUR), m = Math.round(abs / MINUTE)
  const unit = d >= 1 ? `${d} Tag${d === 1 ? '' : 'en'}` : h >= 1 ? `${h} Std.` : `${m} Min.`
  return diff < 0 ? `vor ${unit}` : `in ${unit}`
}
