#!/usr/bin/env python3
"""Fahrschule Krebs · Sync-Server für Zentrale + Schüler-App + Fahrlehrer-App.

Startet einen Webserver, der die drei Oberflächen ausliefert und ihren
Zustand zwischen allen Geräten in Echtzeit synchronisiert – 100 %
verlustfrei über ein rollenbasiertes Feld-Merge mit Versionsprüfung
(kein "letzter überschreibt alles" mehr). Nur Python-Standardbibliothek.

Rollen & Besitz je Datensatz:
  · STUDENT (App)  schreibt: Wunschzeiten, Simulator-Buchungen, Klasse,
                             Dokument-Uploads (Bild + Einreichung)
  · OFFICE  (Zentrale/Fahrlehrer) schreibt: Fahrlehrer, Termine, Fahrstunden,
                             Sonderfahrten, Historie, Bewertung, Prüfungs-GO,
                             Theorie-Stand, Dokument-Verifizierung, Zahlungen
Jede Seite überschreibt ausschließlich ihre eigenen Felder; die Felder der
anderen Seite bleiben immer erhalten. Gleichzeitige OFFICE-Schreibvorgänge
werden über eine Revisionsnummer (baseRev) erkannt und der Client wiederholt
seine Mutation auf dem frischen Stand.

Start:   python3 server.py            (Port 8000)
         python3 server.py 8080       (eigener Port)
"""
import json
import os
import socket
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, 'sync-data.json')
_lock = threading.Lock()


def _load():
    try:
        with open(DATA_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    except Exception:
        return {}


# _store[cid] = {profile:str, state:str, ts:int, src:str, rev:int, _auth:dict}
# _auth ist der dekodierte, gemergte Zustand (Autorität); state ist sein JSON.
_store = _load()


def _save():
    try:
        # _auth nicht mit persistieren – wird beim Laden aus state rekonstruiert
        slim = {}
        for cid, rec in _store.items():
            slim[cid] = {k: v for k, v in rec.items() if k != '_auth'}
        with open(DATA_FILE, 'w', encoding='utf-8') as fh:
            json.dump(slim, fh)
    except Exception:
        pass


# ── Feld-Besitz ───────────────────────────────────────────────────────
# Alles, was das Büro (Zentrale/Fahrlehrer) verwaltet:
OFFICE_KEYS = {
    'fahrlehrerId', 'fahrlehrerName', 'naechsteFahrstunde', 'uebungsstunden',
    'simulator', 'sonderfahrten', 'history', 'fahrstil', 'fahrlehrerGo',
    'theorie', 'theoriePruefung', 'themeSessions', 'examTermine',
    'restSonderfahrtenGebucht', 'grundausbildungAbgeschlossen',
}
# 'dokumente' und 'finanzen' werden gesondert gemergt (gemischter Besitz).
SPECIAL_KEYS = {'dokumente', 'finanzen'}


def _ensure_posten_ids(fin):
    if isinstance(fin, dict) and isinstance(fin.get('posten'), list):
        for p in fin['posten']:
            if isinstance(p, dict) and not p.get('id'):
                p['id'] = 'p-' + uuid.uuid4().hex[:10]


def _merge_docs(auth, inc, writer):
    if not isinstance(auth, dict):
        return inc if isinstance(inc, dict) else auth
    if not isinstance(inc, dict):
        return auth
    out = dict(auth)
    for k, dv in inc.items():
        if not isinstance(dv, dict):
            continue
        av = auth.get(k) if isinstance(auth.get(k), dict) else {}
        if writer == 'office':
            out[k] = dv  # Büro ist autoritativ (verifizieren / zurücksetzen)
        else:  # student
            newd = dict(av)
            if 'thumb' in dv:
                newd['thumb'] = dv['thumb']         # Bild-Upload immer übernehmen
            if dv.get('status') == 'pruefung' and av.get('status') in (None, 'ausstehend'):
                newd['status'] = 'pruefung'          # Einreichung erlauben
            out[k] = newd
    return out


def _merge_fin(auth, inc, writer):
    a = dict(auth) if isinstance(auth, dict) else {}
    a.setdefault('posten', [])
    a.setdefault('bezahlt', 0)
    a.setdefault('_removed', [])
    if not isinstance(inc, dict):
        return a
    _ensure_posten_ids(inc)
    removed = set(a.get('_removed') or [])
    if writer == 'office':
        inc_ids = {p.get('id') for p in inc.get('posten', []) if isinstance(p, dict)}
        for p in a['posten']:
            pid = p.get('id')
            if pid and pid not in inc_ids:
                removed.add(pid)            # vom Büro entfernt = bezahlt
        a['posten'] = [p for p in inc.get('posten', []) if p.get('id') not in removed]
        if 'bezahlt' in inc:
            a['bezahlt'] = inc.get('bezahlt')
    else:  # student fügt Posten hinzu (z. B. Simulator-Rechnung)
        have = {p.get('id') for p in a['posten'] if isinstance(p, dict)}
        for p in inc.get('posten', []):
            pid = p.get('id')
            if pid and pid not in have and pid not in removed:
                a['posten'].append(p)
                have.add(pid)
    a['_removed'] = list(removed)
    return a


def _merge_state(auth, inc, writer):
    """Mergt inc in auth entsprechend der Feld-Besitzrechte des Schreibers."""
    if not isinstance(inc, dict):
        return auth
    if not isinstance(auth, dict):
        _ensure_posten_ids(inc.get('finanzen'))
        return inc  # Erstanlage
    out = dict(auth)
    for k, v in inc.items():
        if k in SPECIAL_KEYS:
            continue
        is_office = k in OFFICE_KEYS
        if writer == 'office' and is_office:
            out[k] = v
        elif writer == 'student' and not is_office:
            out[k] = v
        # sonst: autoritativen Wert behalten
    out['dokumente'] = _merge_docs(auth.get('dokumente'), inc.get('dokumente'), writer)
    out['finanzen'] = _merge_fin(auth.get('finanzen'), inc.get('finanzen'), writer)
    return out


def _auth_of(rec):
    if rec.get('_auth') is not None:
        return rec['_auth']
    try:
        rec['_auth'] = json.loads(rec.get('state') or 'null')
    except Exception:
        rec['_auth'] = None
    return rec['_auth']


def _apply_write(cid, incoming_state_str, profile, writer, base_rev):
    """Wendet einen Schreibvorgang an. Gibt (ok, record_public) zurück.
    ok=False + code 409 bei Revisionskonflikt (nur relevant für writer=office)."""
    rec = _store.get(cid) or {}
    cur_rev = rec.get('rev', 0)
    if writer == 'office' and base_rev is not None and cur_rev != base_rev:
        pub = {k: v for k, v in rec.items() if k != '_auth'}
        return False, pub
    # Meta-Datensätze (Dienstpläne, Abwesenheiten) ohne Rollen-Merge speichern
    if cid.startswith('__'):
        rec = dict(rec)
        rec['state'] = incoming_state_str
        rec['_auth'] = None
        rec['ts'] = int(time.time() * 1000)
        rec['src'] = 'admin' if writer == 'office' else 'app'
        rec['rev'] = cur_rev + 1
        _store[cid] = rec
        _save()
        return True, {k: v for k, v in rec.items() if k != '_auth'}
    try:
        inc = json.loads(incoming_state_str) if incoming_state_str else None
    except Exception:
        inc = None
    auth = _auth_of(rec) if rec else None
    merged = _merge_state(auth, inc, writer)
    new_state = json.dumps(merged) if merged is not None else incoming_state_str
    rec = dict(rec)
    rec['_auth'] = merged
    rec['state'] = new_state
    if profile is not None:
        rec['profile'] = profile          # Profil ist student-eigen
    elif writer == 'student' and 'profile' not in rec:
        rec['profile'] = None
    rec['ts'] = int(time.time() * 1000)
    rec['src'] = 'admin' if writer == 'office' else 'app'
    rec['rev'] = cur_rev + 1
    _store[cid] = rec
    _save()
    pub = {k: v for k, v in rec.items() if k != '_auth'}
    return True, pub


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=BASE, **kw)

    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            return json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            return {}

    def end_headers(self):
        if not self.path.startswith('/sync/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/sync/all':
            with _lock:
                pub = {c: {k: v for k, v in r.items() if k != '_auth'}
                       for c, r in _store.items()}
            self._json(pub)
        elif parsed.path == '/sync/pull':
            cid = (parse_qs(parsed.query).get('id') or [''])[0]
            with _lock:
                rec = _store.get(cid) or {}
                pub = {k: v for k, v in rec.items() if k != '_auth'}
            self._json(pub)
        elif parsed.path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/dashboard.html')
            self.end_headers()
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        data = self._body()
        cid = str(data.get('id') or '')
        if not cid:
            self._json({'error': 'id fehlt'}, 400)
            return
        base_rev = data.get('baseRev')
        if parsed.path == '/sync/push':          # App (Schüler) meldet ihren Stand
            with _lock:
                ok, pub = _apply_write(cid, data.get('state'), data.get('profile'),
                                       'student', None)
            # gemergten Stand zurückgeben, damit die App sofort konvergiert
            self._json({'ok': True, 'rev': pub.get('rev'), 'state': pub.get('state')})
        elif parsed.path == '/sync/admin':       # Zentrale/Fahrlehrer ändern den Stand
            with _lock:
                ok, pub = _apply_write(cid, data.get('state'), None, 'office', base_rev)
            if not ok:
                self._json({'conflict': True, 'rev': pub.get('rev'),
                            'state': pub.get('state')}, 409)
            else:
                self._json({'ok': True, 'rev': pub.get('rev'), 'state': pub.get('state')})
        else:
            self._json({'error': 'unbekannter Endpunkt'}, 404)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    ip = lan_ip()
    print('══════════════════════════════════════════════════════')
    print('  Fahrschule Krebs · Sync-Server läuft')
    print(f'  Zentrale (Admin):  http://localhost:{port}/dashboard.html')
    print(f'  Schüler-App:       http://{ip}:{port}/app.html')
    print(f'  Fahrlehrer-App:    http://{ip}:{port}/fahrlehrer.html')
    print('  (Handy im gleichen WLAN: die zweite Adresse öffnen)')
    print('  Beenden mit Strg+C')
    print('══════════════════════════════════════════════════════')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
