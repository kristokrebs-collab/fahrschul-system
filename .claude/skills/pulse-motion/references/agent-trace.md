# Agent Trace (agent-trace)
> Dunkle Gantt-/Trace-Karte eines Agent-Laufs mit scrubbarer Timeline: Beim Ziehen des Reglers fuellen sich Balken, Token- und Zeitwerte laufen live mit, Zeilen "wachen auf".

## Wann einsetzen
- Agent-/LLM-Observability, Run-Replay, Tracing-Dashboards (Langfuse/Datadog-Stil)
- CI-/Build-Pipelines, Deploy-Timelines, Waterfall (Netzwerk, Render-Phasen)
- Produkt-Tour "so arbeitet unsere KI": Hero-Mockup mit Auto-Play-Loop
- Video-/Audio-Editor-Timelines, Projekt-Gantt, Incident-Zeitleisten
- Scrubbing-Interaktion: Zustand = reine Funktion der Zeit t (replay-faehig)
- Dark-Tech-Look, monospace, sehr ruhig, kein Spring

## Anatomie & Zeitleiste
Karte 892x552, Radius 12, Rahmen #424242. Header 44 / Ruler 27 / 12 Zeilen x 34.7 / Footer 55.
Alles haengt an einer Zeit t (0..10.4 s); es gibt keine Eintritts-Choreografie, nur Reaktion auf t.

| Phase | Verhalten | Dauer |
|---|---|---|
| Scrub (Finger/Maus) | Playhead, Daumen, Balken, Zahlen folgen 1:1 dem Zeiger (kein Nachlaufen messbar, Schritte = Finger-Samples) | 0 ms |
| Span noch nicht gestartet | Zeile Opacity .45, Geisterbalken sehr dunkel, kein Meta | Fade ~160 ms (geschaetzt) |
| Span laeuft (0<p<1) | Balken scaleX(p), Geisterbalken bis Ende, Zeilenband dunkler; Meta = Tokens*p + Dauer*p (z.B. "992 tk 700ms") | p = (t-start)/dauer |
| Span fertig | Meta final (Ergebnis + Dauer), Fehler rot (Balken #a90001, Icon, Text) | - |
| t = 10.4 | Badge "Running" -> "Completed" | sofort |
| Play | t += dt*speed, am Ende Loop (t % total) | 10.4 s bei Speed 1 |
Spans (Start/Dauer s): plan 0/.74, search_docs .79/1.18, read_file 1.13/.36 und 1.19/.43, reviewer 2.0/3.4, grep 2.06/.28, model.review 2.38/2.52, write_note 4.95/.38, run_tests 5.47/1.72 (fail), repair 7.23/1.38, run_tests x2 8.67/1.26, commit 9.94/.46.
Startposition im Video 5.18 s. Hover ueber Label: Pille rgba(255,255,255,.13), 22 px hoch, Breite = Label Width.

## Motion-Tokens
- Kein Spring, kein Easing beim Scrub (direkte Kopplung); Fades --dur-dim 160 ms, --dur-hover 120 ms, --ease-out cubic-bezier(.22,.8,.3,1)
- Zeitachse: 49.5 px/s bei 892 px Karte (domain 10.6 s ueber Plotbreite)
- Optional follow (1/s) = exp. Glaettung a = 1-exp(-k*dt); Standard 0
- Dauerformat: <1 s "NNNms", sonst "X.XXs"; Tokens "1,240 tk"

## Look-Tokens
Buehne/Karte #1f1f1f, Rahmen #424242, Raster #353535-#3d3d3d, Text #f0f0f0, Meta #9a9a9a, Balken #030303, leichte Balken (cache/grep/write_note) #666, Fehler-Balken #a90001, Fehlertext #e5575b, Geister rgba(0,0,0,.16/.28), Play-Button #282828 (28 px Kreis), Daumen #eee 12 px, Playhead = Raute 7 px + 1 px Linie. Schrift: Labels/Meta mono (ui-monospace/Geist Mono) 13/11.5 px, Subline Inter 12 px. Badge: Pille 22 px, Rahmen #444. Row Height 34.7, Label Width 200, Balken 8 px hoch, Radius 4.

## Interaktion & Barrierefreiheit
- Pointer Events (Maus+Touch) auf der Spur, setPointerCapture, touch-action:none; pointermove wird nur gespeichert (getCoalescedEvents) und im naechsten rAF angewendet
- Track = role="slider" (aria-valuenow/-text), Pfeile +-0.1 s (Shift 1 s), Home/End; Play-Button mit aria-label, Space/Enter
- prefers-reduced-motion: kein Auto-Play, Fades aus (Scrubben bleibt, ist nutzergetrieben)
- Controls aus dem Video (Loop, Speed, Start At, Auto Play, Row Height, Show Ruler, Label Width, Show Tokens, Show Transport) = Optionen

## 120 Hz
rAF mit Zeitstempel, dt=min(dt,50); Play-Zeit aus dt; Loop nur laufend, sonst Leerlauf ohne rAF. Animiert werden nur transform (Playhead, Daumen, Balken scaleX, Rail), Breiten per ResizeObserver gecacht, DOM-Text nur bei Wertaenderung, will-change nur waehrend Bewegung, contain: layout paint.
check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (4x: p95 4.4 ms, p99 7.1 ms, script 0.12 ms/Frame). Verbleibendes WARN "style.left/top": nur einmaliges Setup (Baumlinie), nicht pro Frame.

## Einbindung
`assets/agent-trace.html`: Block COMPONENT CSS + `initAgentTrace(root, opts)` (Rueckgabe: seek(s), play(), pause(), time). Optionen: spans[] ({l,k:'model|tool|file|agent',d:0|1,s,u,tk?,r?,fail?,light?,cache?,badge?}), total, domain, loop, speed, startAt (0..1), autoPlay, rowHeight, labelWidth, showRuler/showTokens/showTransport, follow, title, subline. CSS-Variablen oben im :root.

## Vermuteter Original-Stack -> React/Framer-Motion
Zustand `time` (useState/useMotionValue), Spans als Array; Balken `width = clamp((time-start)/dur)` bzw. `scaleX`, Tokens `Math.round(tk*p)`. Playhead `x = useTransform(time,[0,total],[0,plotW])`; Slider = Pointer-Drag (kein Spring). Hover/Opacity per `transition={{duration:.15}}`; Loop via `useAnimationFrame`. Kein spring im Scrub (stiffness-Aequivalent: unendlich).

## Kreativ remixen
1. Live-Modus: Spans wachsen in Echtzeit (SSE), Fehler-Balken pulsieren rot + Haptik, Auto-Retry-Zeile gleitet ein
2. Zwei Runs uebereinander (Diff-Ghost): Vorlauf als Geisterbalken, neuer Lauf faerbt Abweichungen
3. Playhead mit Motion-Blur-Schweif + Zeilen leuchten kurz auf, wenn er sie kreuzt (Scrub-Sound/Click bei Span-Start)
4. Speed 8x + Loop als Hero-Hintergrund, Tokenzaehler als riesige Display-Ziffer ("Herzrasen"-Zahl)
5. Kontexte: CI-Pipeline, Netzwerk-Waterfall, Schicht-/Fahrplan, Mini-Karte der Spans unter dem Slider

## Bekannte Abweichungen (ehrlich)
- Nicht erkennbar: Fade-Dauer der Zeilen, ob Klick auf Label seeken soll (hier nein), Verhalten Play/Loop (im Video nie gestartet), genaue Icons (hier Lucide-aehnliche Eigenzeichnungen)
- Schrift: Original wirkt etwas schmaler/kleiner mono; Meta-Farbe leicht anders
- Control "Start At 0.62" passt nicht zu den 5.18 s im Video; ich nutze 0.498
- Balken per scaleX (Rundung der Enden leicht gestaucht bei sehr kurzem Fortschritt)
- Frame 14 des Videos zeigt ein rotes Icon bei run_tests vor dessen Start; nicht nachgebaut
- Meta-Texte laufender nicht-Token-Spans zeigen nur die Dauer (aus Frames abgeleitet)
