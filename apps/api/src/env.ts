import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  port: Number(process.env.API_PORT ?? 4000),
  sessionSecret: () => required("SESSION_SECRET", "dev-only-insecure-secret-change-me"),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  totpIssuer: process.env.TOTP_ISSUER ?? "Fahrschule Krebs",
  documentStorageMode: (process.env.DOCUMENT_STORAGE_MODE ?? "mock") as "mock" | "sandbox" | "live",
};
