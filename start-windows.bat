@echo off
REM Fahrschul-Cockpit - lokaler Start (Windows)
REM Einfach per Doppelklick im Explorer oeffnen.
cd /d "%~dp0"
set PORT=8099

echo Starte Fahrschul-Cockpit auf http://localhost:%PORT% ...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/index.html"

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -m http.server %PORT%
  ) else (
    echo Python wurde nicht gefunden. Bitte installiere Python 3 von python.org und starte diese Datei erneut.
    pause
  )
)
