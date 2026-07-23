import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@fahrschul/ui";
import { ApiError } from "../api/client.js";
import { useSession } from "../state/SessionContext.js";

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, totpToken || undefined);
      navigate("/heute", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
        const code = (err.body as { error: string }).error;
        if (code === "mfa_setup_required" || code === "mfa_required_or_invalid") {
          setNeedsTotp(true);
          setError("Bitte gib deinen Bestätigungscode ein.");
        } else {
          setError("E-Mail oder Passwort ist falsch.");
        }
      } else {
        setError("Anmeldung aktuell nicht möglich. Bitte versuche es erneut.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen login-screen">
      <h1>Fahrlehrer-App – Fahrschule Krebs</h1>
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="email">E-Mail</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">Passwort</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {needsTotp ? (
          <>
            <label htmlFor="totp">Bestätigungscode</label>
            <input id="totp" type="text" inputMode="numeric" autoComplete="one-time-code" value={totpToken} onChange={(e) => setTotpToken(e.target.value)} />
          </>
        ) : null}

        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Anmelden…" : "Anmelden"}
        </Button>
      </form>
    </main>
  );
}
