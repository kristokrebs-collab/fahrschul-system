# Betriebshandbuch

Für den Inhaber und alle, die täglich mit dem System arbeiten.
Keine Vorkenntnisse nötig.

---

## Die erste Woche

### Tag 1 — Anmelden und Fakten sortieren (30–45 Minuten)

1. Öffnen Sie die Anwendung, melden Sie sich an und **ändern Sie das
   Passwort** unter *Einstellungen*.
2. Gehen Sie zu **Einstellungen → Marken-Tatsachen**. Dort stehen Angaben in
   zwei Zuständen:
   - **Belegt** — stammt aus Ihrem Auftrag und darf verwendet werden.
   - **Unbestätigt** — aus öffentlichen Quellen recherchiert, plausibel, aber
     von Ihnen nicht bestätigt.

   Zwölf Angaben stehen auf *unbestätigt*, darunter Gründungsjahr,
   Fahrlehreranzahl und die Adressen. **Solange sie unbestätigt sind, blockiert
   das System jeden Beitrag, der sie verwendet.** Das ist Absicht.

   Gehen Sie die Liste durch. Was stimmt, bestätigen Sie. Was nicht stimmt,
   korrigieren Sie. Was Sie nicht sicher wissen, lassen Sie stehen.

3. Beantworten Sie im **Onboarding-Interview** die erste Frage. Es kommt immer
   nur eine Frage auf einmal. Antworten Sie konkret — mit Zahl, Ort oder
   Beispiel. Das System hakt bei Allgemeinplätzen nach; das ist gewollt.

### Tag 2 — Medienarchiv klären (45–60 Minuten)

Gehen Sie zu **Medien**. Dort liegen 30 importierte Objekte aus dem
Higgsfield-Archiv, alle im Sichtungsbereich.

Für jedes Asset entscheiden Sie zwei Dinge:

| Feld | Bedeutung |
|---|---|
| **Einwilligung** | *Nicht erforderlich*, wenn keine Person erkennbar ist. *Erteilt*, wenn Sie eine dokumentierte Einwilligung haben. Sonst nichts setzen. |
| **Nutzungsrechte** | *Eigenrecht* bei selbst erstelltem Material, *Lizenziert* bei gekauftem, *Plattformlizenz* bei plattformeigener Musik. |

Zusätzlich: Kennzeichen sichtbar? Minderjährige abgebildet?

> **Wichtig:** Setzen Sie nichts auf „Erteilt", wovon Sie keine Einwilligung
> haben. Das System kann das nicht prüfen — es verlässt sich auf Sie. Ein
> falsch gesetzter Haken ist der einzige Weg, wie ungeklärtes Material nach
> außen gelangen kann.

Die 30 importierten Objekte sind vollständig synthetisch erzeugtes
Markenmaterial ohne reale Personen, Fahrzeuge oder Kennzeichen. Für sie ist
in aller Regel *Einwilligung: nicht erforderlich* und *Rechte: Eigenrecht*
zutreffend — aber die Entscheidung liegt bei Ihnen.

### Tag 3 — Erster Beitrag ins Testziel

1. **Ideen → Themen recherchieren.**
2. **Kalender → Wochenplan erzeugen.**
3. Bei einer Position auf **Produzieren**.
4. Sie landen in **Produktion**. Prüfen Sie den Text. Ändern Sie, was nicht
   klingt wie Sie. Speichern.
5. **Freigaben** öffnen. Sie sehen die Freigabekarte mit allem, was
   veröffentlicht würde.
6. Solange nur das Testziel verbunden ist, geht der Beitrag an ein
   **nicht-öffentliches** Ziel. Das steht auf der Karte. Nutzen Sie das, um den
   Ablauf einmal ohne Risiko durchzuspielen.

### Tag 4–5 — Instagram verbinden

Siehe unten, Abschnitt *Konten verbinden*. Danach denselben Ablauf mit dem
echten Konto — beim ersten Mal bewusst mit einem harmlosen Beitrag.

### Tag 6–7 — Auswerten

**Analyse** öffnen. Sie sehen zwei Balken pro Beitrag:

- **Virality** — wie weit er sich verbreitet hat.
- **Business Impact** — was er tatsächlich gebracht hat.

Wenn ein Beitrag den Hinweis *„viel gesehen, nichts bewirkt"* trägt, war er
unterhaltsam, aber kein Akquiseerfolg. Das ist eine nützliche Information,
kein Fehler.

---

## Der tägliche Ablauf (5–10 Minuten)

1. **Heute** öffnen. Ganz oben steht, was Ihre Aufmerksamkeit braucht.
2. Freigaben durchgehen: freigeben, ändern oder ablehnen.
3. Posteingang: Antwortentwürfe prüfen. **Nichts wird automatisch gesendet.**
4. Alarme quittieren, wenn erledigt.

---

## Die Freigabekarte lesen

| Abschnitt | Worauf achten |
|---|---|
| **Ziel** | Steht dort „Testziel"? Dann wird nichts öffentlich. Steht dort ein echtes Konto, ist der Beitrag nach der Freigabe für alle sichtbar. |
| **Medien** | Rot umrandete Vorschau = gesperrt. |
| **Text** | Genau das wird veröffentlicht. Nichts wird nachträglich verändert. |
| **Rechte und Fakten** | ✓ bedeutet geprüft und in Ordnung. ✗ nennt den Grund. |
| **Offene Risiken** | *blockierend* verhindert die Freigabe. Andere sind Hinweise, über die Sie entscheiden. |
| **Inhalts-Hash** | Der Fingerabdruck. Ändern Sie danach irgendetwas, verfällt die Freigabe automatisch und Sie müssen erneut entscheiden. |

**Ihre Möglichkeiten:**

| Schaltfläche | Wirkung |
|---|---|
| Einmalig freigeben | Freigegeben, Versand zum geplanten Zeitpunkt |
| Einplanen | Freigegeben mit festem Termin |
| Jetzt senden | Sofortiger Versand |
| Zurück zum Konzept | Zurück in die Produktion |
| Ablehnen | Verworfen, bleibt dokumentiert |
| Abbrechen | Endgültig gestoppt |

---

## Konten verbinden

Zugangsdaten liegen **ausschließlich serverseitig** in der Datei `.env`. Sie
tauchen nie in der Oberfläche, nie in Protokollen, nie in einer API-Antwort auf.

### Instagram und Facebook

Benötigt: Instagram-Professional-Konto, verknüpfte Facebook-Seite, ein
Meta-App-Zugangstoken mit den Berechtigungen `instagram_basic`,
`instagram_content_publish`, `instagram_manage_comments`,
`instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`.

```bash
# in .env
META_ACCESS_TOKEN=EAA...
INSTAGRAM_BUSINESS_ACCOUNT_ID=17841...
FACEBOOK_PAGE_ID=1234...
```

Dienst neu starten, dann **Einstellungen → Verbindungen jetzt prüfen**. Der
Status muss auf *Verbunden* springen. Das System warnt automatisch, wenn ein
Token in weniger als sieben Tagen abläuft.

> **Wichtig:** Instagram lädt die Mediendatei selbst von einer öffentlich
> erreichbaren HTTPS-Adresse. Ein Asset ohne solche URL kann nicht
> veröffentlicht werden — der Adapter sagt das im Klartext.

### TikTok

```bash
TIKTOK_ACCESS_TOKEN=act...
TIKTOK_OPEN_ID=...
```

> **Achtung:** Ohne bestandenes TikTok-App-Audit dürfen Beiträge nur als
> *SELF_ONLY* (nur für Sie sichtbar) veröffentlicht werden. Der Adapter liest
> die erlaubten Sichtbarkeiten beim Anbieter aus und sagt es Ihnen bei der
> Verbindungsprüfung — er stellt einen Beitrag nicht stillschweigend privat.

### YouTube

```bash
YOUTUBE_ACCESS_TOKEN=ya29...
YOUTUBE_CHANNEL_ID=UC...
```

---

## Wenn etwas schiefgeht

### „Freigabe nicht möglich"

Die Karte nennt die Gründe im Klartext. Die häufigsten:

| Grund | Lösung |
|---|---|
| `FACT_*` | Eine Zahl oder Behauptung ist nicht belegt. Entweder aus dem Text nehmen oder unter *Einstellungen → Marken-Tatsachen* als *belegt* bestätigen. |
| `RIGHTS_ASSET` | Ein Medium ist nicht freigegeben. In *Medien* die Rechte setzen. |
| `A11Y_ALT_TEXT` | Alternativtext fehlt. In *Produktion* ergänzen. |
| `A11Y_SUBTITLES` | Untertitel fehlen bei einem Video. |
| `VOICE_GENERIC` | Der Beitrag enthält kein einziges Detail, das nur zu Ihnen passt. Ortsbezug, Klasse oder konkrete Situation ergänzen. |
| `PLATFORM_TOO_MANY_HASHTAGS` | Mehr als fünf Hashtags. |
| `PLATFORM_NO_ACCOUNT` | Kein Zielkonto zugeordnet. |

### Ein Beitrag ist nicht rausgegangen

**Versand** öffnen. Der Job zeigt Zustand, Versuchszahl und die letzte Ursache.

| Zustand | Bedeutung | Was tun |
|---|---|---|
| *In Warteschlange* | Wartet auf Termin oder Wiederholung | Nichts |
| *Zustellung wird geprüft* | Abgesetzt, Bestätigung steht aus | Wenige Minuten warten |
| *Endgültig fehlgeschlagen* | Nach mehreren Versuchen aufgegeben | Ursache lesen, beheben, **Erneut versuchen** |
| *Abgebrochen* | Inhalt oder Rechte haben sich nach der Freigabe geändert | Beitrag erneut prüfen und freigeben |

Eine Wiederaufnahme umgeht das Freigabe-Gate **nicht**. Ist die Freigabe
inzwischen entwertet, verlangt das System eine neue.

### Häufige Fehlerursachen

| Meldung | Bedeutung |
|---|---|
| `META_ACCESS_TOKEN ist nicht gesetzt` | Zugangsdaten fehlen in `.env`. |
| `Zugriff verweigert (401/403)` | Token abgelaufen oder Berechtigung fehlt. Neu erzeugen. |
| `Meta konnte das Medium nicht verarbeiten` | Falsches Seitenverhältnis, zu lange Laufzeit oder nicht unterstützter Codec. |
| `Ratenlimit erreicht` | Wird automatisch wiederholt. |
| `Der Beitrag wurde abgesetzt, ist aber nicht auffindbar` | Ernst nehmen. Manuell beim Anbieter nachsehen, bevor erneut gesendet wird. |

---

## Sicherung und Wiederherstellung

```bash
npm run backup                              # erstellt Sicherung mit Prüfsumme
npm run restore -- data/backups/autopilot-<zeitstempel>.db
```

Die Sicherung nutzt `VACUUM INTO` und ist auch während des laufenden Betriebs
konsistent. Neben jeder `.db` liegt eine `.json` mit Prüfsumme und Zeilenzahlen.

Die Wiederherstellung prüft **zuerst die Prüfsumme** und bricht bei Abweichung
ab. Der vorherige Stand wird vorher als `.pre-restore-<zeit>` gesichert.

**Empfehlung:** täglich per Cron sichern und die Sicherungen auf ein anderes
Medium kopieren.

```cron
0 3 * * * cd /pfad/zum/projekt && npm run backup >> /var/log/fk-backup.log 2>&1
```

**Die Wiederherstellung mindestens einmal im Quartal üben.** Eine ungeprüfte
Sicherung ist eine Hoffnung, keine Sicherung.

---

## Rollen

| Rolle | Darf |
|---|---|
| **owner** | Alles, insbesondere freigeben, Rechte setzen, Fakten bestätigen, Änderungen anwenden |
| **editor** | Recherchieren, planen, produzieren, bearbeiten, ablehnen — **nicht freigeben** |
| **viewer** | Nur lesen |

Weitere Konten unter *Einstellungen* (nur als owner).

---

## Was das System nie ohne Sie tut

- Etwas veröffentlichen
- Eine Antwort senden
- Rechte oder Einwilligungen setzen
- Eine Tatsache als belegt markieren
- Eine eigene Regel ändern
- Ein Konto verbinden oder trennen
