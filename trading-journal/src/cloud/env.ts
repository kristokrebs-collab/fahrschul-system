/**
 * Cloud availability (Wave-0 contract, moved here from `index.ts` unchanged so light modules can import it without the
 * barrel). Re-exported by `@/cloud`.
 */
import { IS_FILE_BUILD, isFileProtocol } from "@/edition";

// P09's extra build variables, merged into the shared `ImportMetaEnv` (`src/env.d.ts`) from here so that file stays as is.
declare global {
  interface ImportMetaEnv {
    /** Optional OAuth buttons in the login sheet, comma-separated (`google,github,apple,discord`). */
    readonly VITE_SUPABASE_OAUTH_PROVIDERS?: string;
    /** Vite: public base path of the build (`/` personal, `/teilen/` share). */
    readonly BASE_URL: string;
  }
}

export interface CloudConfig {
  /** Supabase project URL without trailing slash, e.g. `https://<ref>.supabase.co`. */
  url: string;
  /** Publishable (browser) key `sb_publishable_…` – public by design. */
  publishableKey: string;
}

/** The two public client variables (tests pass their own object). */
export type CloudEnv = Partial<Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY", string | undefined>>;

// `import.meta.env.VITE_*` must be spelled out literally so Vite can inline it.
const BUILD_ENV: CloudEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

/** Supabase config of this build, or `null` when either variable is missing / not an http(s) URL. */
export function cloudConfig(env: CloudEnv = BUILD_ENV): CloudConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!/^https?:\/\/[^/\s]+/i.test(url) || !publishableKey) return null;
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

/**
 * True when login / sync / billing / exchange features may be shown: a web build served over http(s) with both
 * `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` set. Always false in the single-file builds and on file://.
 */
export function isCloudAvailable(env: CloudEnv = BUILD_ENV): boolean {
  if (IS_FILE_BUILD || isFileProtocol()) return false;
  return cloudConfig(env) !== null;
}

let enabledOverride: boolean | null = null;

/** `isCloudAvailable()` of this page, unless a test pinned it (`setCloudEnabledForTests`). The UI asks this. */
export function cloudEnabled(): boolean {
  return enabledOverride ?? isCloudAvailable();
}

/** Tests / the dev harness: pretend the cloud is (not) configured; `null` restores the build's answer. */
export function setCloudEnabledForTests(v: boolean | null): void {
  enabledOverride = v;
}

/** Optional OAuth providers of this build (`VITE_SUPABASE_OAUTH_PROVIDERS="google,github"`), enabled in Supabase Auth. */
export const OAUTH_PROVIDERS = ["google", "github", "apple", "discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function oauthProviders(raw: string | undefined = import.meta.env.VITE_SUPABASE_OAUTH_PROVIDERS): OAuthProvider[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(s))
    .filter((s, i, all) => all.indexOf(s) === i);
}
