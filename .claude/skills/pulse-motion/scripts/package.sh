#!/usr/bin/env bash
# package.sh [out.zip] - packt den Skill fuer den Upload in claude.ai (Einstellungen > Faehigkeiten/Skills > Hochladen).
# Oberste Ebene im ZIP = Ordner "pulse-motion/" mit SKILL.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:-$HERE/../pulse-motion.zip}"
TMP="$(mktemp -d)"; mkdir "$TMP/pulse-motion"; cp -r "$HERE"/SKILL.md "$HERE"/assets "$HERE"/references "$HERE"/scripts "$TMP/pulse-motion/"
( cd "$TMP" && rm -f "$OUT" && zip -qr "$OUT" pulse-motion ); rm -rf "$TMP"
echo "-> $OUT ($(du -h "$OUT" | cut -f1))"
