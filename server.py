#!/usr/bin/env python3
"""Fahrschule Krebs · Mini-Server für Zentrale + Schüler-App.

Startet einen Webserver, der dashboard.html und app.html ausliefert und
zusätzlich die Live-Kopplung zwischen Geräten übernimmt (z. B. Handy →
Admin-PC). Es wird nur die Python-Standardbibliothek benutzt.

Start:      python3 server.py            (Port 8000)
            python3 server.py 8080       (eigener Port)
Admin-PC:   http://localhost:8000/dashboard.html
Handy:      http://<IP-des-PCs>:8000/app.html   (gleiches WLAN)
"""
import json
import os
import socket
import sys
import threading
import time
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


_store = _load()  # {clientId: {profile,state,ts,src}}


def _save():
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as fh:
            json.dump(_store, fh)
    except Exception:
        pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=BASE, **kw)

    def log_message(self, *args):  # ruhige Konsole
        pass

    # ── Hilfen ────────────────────────────────────────────────────────
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
        # Statische Dateien nie cachen – beim Testen immer frisch
        if not self.path.startswith('/sync/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    # ── Routen ────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/sync/all':
            with _lock:
                self._json(_store)
        elif parsed.path == '/sync/pull':
            cid = (parse_qs(parsed.query).get('id') or [''])[0]
            with _lock:
                self._json(_store.get(cid) or {})
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
        if parsed.path == '/sync/push':      # App meldet ihren Stand
            with _lock:
                cur = _store.get(cid) or {}
                # Einen neueren Admin-Stand nicht mit altem App-Stand überschreiben
                if not (cur.get('src') == 'admin' and cur.get('ts', 0) > data.get('ts', 0)):
                    _store[cid] = {
                        'profile': data.get('profile'),
                        'state': data.get('state'),
                        'ts': data.get('ts') or int(time.time() * 1000),
                        'src': 'app',
                    }
                    _save()
            self._json({'ok': True})
        elif parsed.path == '/sync/admin':   # Zentrale ändert den Stand
            with _lock:
                cur = _store.get(cid) or {}
                cur['state'] = data.get('state')
                cur['ts'] = data.get('ts') or int(time.time() * 1000)
                cur['src'] = 'admin'
                _store[cid] = cur
                _save()
            self._json({'ok': True, 'ts': cur['ts']})
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
    print('  Fahrschule Krebs · Server läuft')
    print(f'  Zentrale (Admin):  http://localhost:{port}/dashboard.html')
    print(f'  Schüler-App:       http://{ip}:{port}/app.html')
    print(f'  Fahrlehrer-App:    http://{ip}:{port}/fahrlehrer.html')
    print(f'  Cockpit-Pro-Site:  http://localhost:{port}/cockpit-pro.html')
    print('  (Handy im gleichen WLAN: die zweite Adresse öffnen)')
    print('  Beenden mit Strg+C')
    print('══════════════════════════════════════════════════════')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
