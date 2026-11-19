/**
 * Pseudonyms (P12) – PURE and alias-free (the functions import it by relative path). People in the community appear
 * as "Stiller Falke 27", never under their e-mail or display name. The server draws the bytes (`crypto.randomBytes`)
 * and stores the result in `social_profiles` (unique, re-rollable); the client only shows it and its monogram.
 */

type Gender = "m" | "f";

/** Adjective stems; the ending follows the animal's gender ("Stiller Falke", "Stille Eule"). */
const ADJECTIVES = [
  "Still",
  "Ruhig",
  "Kühn",
  "Wach",
  "Klug",
  "Schnell",
  "Flink",
  "Gelassen",
  "Mutig",
  "Geduldig",
  "Scharf",
  "Leis",
  "Fest",
  "Klar",
  "Wendig",
  "Zäh",
  "Kühl",
  "Hell",
  "Treu",
  "Frei",
] as const;

const ANIMALS: readonly (readonly [string, Gender])[] = [
  ["Falke", "m"],
  ["Eule", "f"],
  ["Luchs", "m"],
  ["Fuchs", "m"],
  ["Wolf", "m"],
  ["Adler", "m"],
  ["Otter", "m"],
  ["Möwe", "f"],
  ["Kranich", "m"],
  ["Hirsch", "m"],
  ["Dachs", "m"],
  ["Robbe", "f"],
  ["Krähe", "f"],
  ["Elster", "f"],
  ["Biber", "m"],
  ["Specht", "m"],
  ["Habicht", "m"],
  ["Lerche", "f"],
  ["Igel", "m"],
  ["Gämse", "f"],
];

/** Possible combinations (20 × 20 × 990). */
export const PSEUDONYM_SPACE = ADJECTIVES.length * ANIMALS.length * 990;

/** The database check (`social_profiles.pseudonym`): two words and a 2–3 digit number. */
export const PSEUDONYM_RE = /^\p{L}+ \p{L}+ \d{2,3}$/u;

/** A pseudonym from 4 random bytes (more are ignored). */
export function pseudonymFrom(bytes: ArrayLike<number>): string {
  const b = (i: number) => (bytes[i] ?? 0) & 0xff;
  const adj = ADJECTIVES[b(0) % ADJECTIVES.length]!;
  const [animal, g] = ANIMALS[b(1) % ANIMALS.length]!;
  const num = 10 + (((b(2) << 8) | b(3)) % 990);
  return `${adj}${g === "m" ? "er" : "e"} ${animal} ${num}`;
}

/** Two-letter monogram for the dot-matrix avatar ("SF"); "?" for anything unexpected. */
export function monogramOf(pseudonym: string | null | undefined): string {
  const words = (pseudonym ?? "").trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("de-DE"))
    .join("");
}

/** ASCII spelling for the 5×7 dot-matrix glyphs (they have no umlauts): Ä → A, Ö → O, Ü → U. */
export function matrixSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "SS")
    .toUpperCase();
}
