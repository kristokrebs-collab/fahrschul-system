/**
 * Client build env (Vite inlines `import.meta.env.VITE_*` at build time). PUBLIC values only: anything with the
 * `VITE_` prefix ends up in the bundle – server secrets never get that prefix (see `.env.example`).
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** P09: optional OAuth buttons in the login sheet, comma-separated (`google,github,apple,discord`). */
  readonly VITE_SUPABASE_OAUTH_PROVIDERS?: string;
  /** Vite: public base path of the build (`/` personal, `/teilen/` share). */
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
