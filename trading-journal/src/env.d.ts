/**
 * Client build env (Vite inlines `import.meta.env.VITE_*` at build time). PUBLIC values only: anything with the
 * `VITE_` prefix ends up in the bundle – server secrets never get that prefix (see `.env.example`).
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
