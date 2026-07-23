import { Link } from "react-router-dom";
import { Button, Card } from "@fahrschul/ui";
import { useSession } from "../state/SessionContext.js";

export function Mehr() {
  const { user, logout } = useSession();

  return (
    <main className="screen">
      <h1>Mehr</h1>
      <Card title={`${user?.vorname ?? ""} ${user?.nachname ?? ""}`}>
        <p>{user?.email}</p>
      </Card>
      <nav aria-label="Weitere Bereiche">
        <ul className="mehr-list">
          <li><Link to="/mehr/dokumente">Dokumente</Link></li>
          <li><Link to="/mehr/rechnungen">Rechnungen</Link></li>
          <li><Link to="/mehr/feedback">Fahrstundenfeedback</Link></li>
          <li><Link to="/mehr/flex">Krebs Flex</Link></li>
        </ul>
      </nav>
      <Button variant="secondary" onClick={() => logout()}>
        Abmelden
      </Button>
    </main>
  );
}
