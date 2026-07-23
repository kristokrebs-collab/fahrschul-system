import { useState } from "react";
import { ApiError } from "../api/client.js";
import { useSession } from "../state/SessionContext.js";

export function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password, totpToken || undefined);
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
        const code = String((err.body as { error: unknown }).error);
        if (code === "mfa_setup_required" || code === "totp_required" || code === "invalid_totp") {
          setNeedsTotp(true);
        }
        setError(code);
      } else {
        setError("login_failed");
      }
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Finanz-Cockpit</h1>
        <p className="dim" style={{ marginBottom: "1rem" }}>
          Nur für Rollen Finanzen/Geschäftsführung.
        </p>
        <div className="form-field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {needsTotp ? (
          <div className="form-field">
            <label htmlFor="totp">TOTP-Code</label>
            <input id="totp" value={totpToken} onChange={(e) => setTotpToken(e.target.value)} />
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button className="fahrschul-btn fahrschul-btn--primary" type="submit">
          Anmelden
        </button>
      </form>
    </main>
  );
}
