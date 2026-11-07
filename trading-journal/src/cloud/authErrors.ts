/**
 * Supabase Auth errors → short German sentences (P09). Pure. `field` says which input the sheet shakes.
 * Codes: https://supabase.com/docs/guides/auth/debugging/error-codes (`error.code`), with message fallbacks for older
 * servers that only send a message.
 */

export type AuthField = "email" | "password" | "code" | null;

export interface AuthErrorText {
  message: string;
  field: AuthField;
}

const BY_CODE: Record<string, AuthErrorText> = {
  invalid_credentials: { message: "E-Mail oder Passwort stimmt nicht.", field: "password" },
  email_not_confirmed: { message: "Bitte bestätige zuerst deine E-Mail. Wir können den Link erneut senden.", field: "email" },
  user_already_exists: { message: "Zu dieser E-Mail gibt es schon ein Konto. Melde dich an.", field: "email" },
  email_exists: { message: "Zu dieser E-Mail gibt es schon ein Konto. Melde dich an.", field: "email" },
  weak_password: { message: "Das Passwort ist zu schwach. Nimm mindestens 10 Zeichen, gern mit Zahlen und Zeichen.", field: "password" },
  same_password: { message: "Das neue Passwort muss sich vom alten unterscheiden.", field: "password" },
  email_address_invalid: { message: "Diese E-Mail-Adresse sieht nicht gültig aus.", field: "email" },
  validation_failed: { message: "Bitte prüfe deine Eingaben.", field: "email" },
  signup_disabled: { message: "Neue Konten sind gerade nicht möglich.", field: null },
  email_provider_disabled: { message: "Anmelden per E-Mail ist hier abgeschaltet.", field: null },
  over_email_send_rate_limit: { message: "Zu viele E-Mails in kurzer Zeit. Warte bitte eine Minute.", field: "email" },
  over_request_rate_limit: { message: "Zu viele Versuche. Warte bitte einen Moment.", field: null },
  otp_expired: { message: "Der Link ist abgelaufen. Fordere einfach einen neuen an.", field: null },
  flow_state_expired: { message: "Der Link ist abgelaufen. Fordere einfach einen neuen an.", field: null },
  flow_state_not_found: { message: "Öffne den Link bitte im selben Browser, in dem du ihn angefordert hast.", field: null },
  bad_code_verifier: { message: "Öffne den Link bitte im selben Browser, in dem du ihn angefordert hast.", field: null },
  mfa_verification_failed: { message: "Der Code stimmt nicht. Nimm den aktuellen aus deiner App.", field: "code" },
  mfa_challenge_expired: { message: "Der Code ist abgelaufen. Gib den aktuellen ein.", field: "code" },
  mfa_factor_name_conflict: { message: "Diese App ist schon eingerichtet.", field: null },
  mfa_verification_rejected: { message: "Der Code wurde abgelehnt. Versuch es erneut.", field: "code" },
  insufficient_aal: { message: "Bitte bestätige zuerst mit deinem 2FA-Code.", field: "code" },
  session_not_found: { message: "Deine Sitzung ist abgelaufen. Melde dich erneut an.", field: null },
  session_expired: { message: "Deine Sitzung ist abgelaufen. Melde dich erneut an.", field: null },
  refresh_token_not_found: { message: "Deine Sitzung ist abgelaufen. Melde dich erneut an.", field: null },
  reauthentication_needed: { message: "Bitte melde dich zur Sicherheit erneut an.", field: "password" },
  user_banned: { message: "Dieses Konto ist gesperrt.", field: null },
  provider_disabled: { message: "Dieser Anbieter ist nicht eingerichtet.", field: null },
  captcha_failed: { message: "Die Sicherheitsprüfung hat nicht geklappt.", field: null },
};

const BY_MESSAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/already registered|already exists/i, "user_already_exists"],
  [/password should be|weak password/i, "weak_password"],
  [/rate limit/i, "over_request_rate_limit"],
  [/expired/i, "otp_expired"],
  [/invalid totp|invalid code/i, "mfa_verification_failed"],
];

export const NETWORK_ERROR: AuthErrorText = { message: "Keine Verbindung zum Server. Prüfe dein Internet.", field: null };
export const GENERIC_ERROR: AuthErrorText = { message: "Das hat nicht geklappt. Bitte versuch es erneut.", field: null };

/** Maps any thrown / returned auth error to German text. */
export function authErrorText(e: unknown): AuthErrorText {
  const err = (e && typeof e === "object" ? e : {}) as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  if (code && BY_CODE[code]) return BY_CODE[code];
  const message = typeof err.message === "string" ? err.message : typeof e === "string" ? e : "";
  if (err.name === "AuthRetryableFetchError" || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) return NETWORK_ERROR;
  for (const [re, c] of BY_MESSAGE) if (re.test(message)) return BY_CODE[c]!;
  if (err.status === 429) return BY_CODE.over_request_rate_limit!;
  return GENERIC_ERROR;
}

/** Simple client-side checks before a request (the server decides in the end). */
export function emailProblem(email: string): string | null {
  const v = email.trim();
  if (!v) return "Bitte gib deine E-Mail ein.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Diese E-Mail-Adresse sieht nicht gültig aus.";
  return null;
}

export const MIN_PASSWORD = 10;

export function passwordProblem(pw: string): string | null {
  if (!pw) return "Bitte gib ein Passwort ein.";
  if (pw.length < MIN_PASSWORD) return `Mindestens ${MIN_PASSWORD} Zeichen.`;
  return null;
}

/** 0–4 rough strength for the meter (length + character classes). */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = pw.length >= MIN_PASSWORD ? 1 : 0;
  if (pw.length >= 14) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes >= 3) score++;
  if (classes === 4 && pw.length >= 12) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}
