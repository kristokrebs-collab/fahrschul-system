/** Pure display helpers for the session list (P09). */

/** `Chrome · macOS`, `Samsung Internet · Android`, `Safari · iPhone` … from a user agent (null → "Unbekanntes Gerät"). */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unbekanntes Gerät";
  const browser = /SamsungBrowser/i.test(ua)
    ? "Samsung Internet"
    : /Edg\//i.test(ua)
      ? "Edge"
      : /OPR\/|Opera/i.test(ua)
        ? "Opera"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/i.test(ua)
            ? "Chrome"
            : /Safari\//i.test(ua)
              ? "Safari"
              : /node|undici|supabase|curl|okhttp/i.test(ua)
                ? "App / Skript"
                : "Browser";
  const os = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? /Mobile/i.test(ua)
          ? "Android"
          : "Android-Tablet"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Windows/i.test(ua)
            ? "Windows"
            : /CrOS/i.test(ua)
              ? "ChromeOS"
              : /Linux/i.test(ua)
                ? "Linux"
                : null;
  return os ? `${browser} · ${os}` : browser;
}

/** Device class for the row glyph. */
export function deviceKind(ua: string | null | undefined): "phone" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  if (/iPad|Tablet|SM-X|SM-T/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/iPhone|Mobile|Android/i.test(ua)) return "phone";
  return "desktop";
}

/** `gerade eben`, `vor 5 Min`, `vor 3 Std`, `vor 2 Tagen` (German, short). */
export function agoLabel(iso: string | null | undefined, now: number): string {
  if (!iso) return "unbekannt";
  const t = Date.parse(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (!Number.isFinite(t)) return "unbekannt";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}
