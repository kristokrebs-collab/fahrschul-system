<#
  Fahrschule Krebs - Einrichtung der Produktionsplattform fuer lokale Tests.

    .\setup.ps1              einrichten (ueberspringt, was schon da ist)
    .\setup.ps1 -Reset       Datenbanken vorher loeschen und neu aufbauen
    .\setup.ps1 -Start       nach dem Einrichten API + alle vier Apps starten

  Das Skript installiert KEINE Systemsoftware. Fehlen Node, pnpm oder
  PostgreSQL, sagt es das und bricht ab.

  Hinweis: Falls PowerShell die Ausfuehrung blockiert:
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

  ACHTUNG: Dieses Skript wurde nicht auf Windows getestet (die Entwicklungs-
  umgebung hatte kein PowerShell). Die bash-Variante setup.sh ist geprueft und
  laeuft auch unter Windows in Git Bash oder WSL - im Zweifel diese nutzen.
#>
[CmdletBinding()]
param(
  [switch]$Reset,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Info { param($m) Write-Host "> $m"  -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "OK $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "! $m"  -ForegroundColor Yellow }
function Die        { param($m) Write-Host "X $m"  -ForegroundColor Red; exit 1 }

# --- 1. Voraussetzungen ------------------------------------------------
Write-Info 'Voraussetzungen pruefen'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'Node.js fehlt. Noetig: Version 20 oder neuer (https://nodejs.org)'
}
$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Die "Node.js $(node -v) ist zu alt. Noetig: 20 oder neuer." }
Write-Ok "Node $(node -v)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Warn "pnpm fehlt - versuche 'corepack enable'"
  corepack enable
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Die 'pnpm fehlt. Installieren mit: npm i -g pnpm'
  }
}
Write-Ok "pnpm $(pnpm -v)"

# --- 2. .env anlegen ---------------------------------------------------
if (Test-Path '.env') {
  Write-Ok '.env vorhanden (bleibt unveraendert)'
} else {
  Write-Info '.env aus .env.example anlegen'
  Copy-Item '.env.example' '.env'
  # Echtes Secret einsetzen: der Platzhalter signiert Sessions, CSRF-Token
  # und Dokument-Links und darf nicht stehen bleiben.
  $secret = node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
  (Get-Content '.env') -replace '^SESSION_SECRET=.*', "SESSION_SECRET=$secret" |
    Set-Content '.env' -Encoding utf8
  Write-Ok '.env angelegt, SESSION_SECRET zufaellig erzeugt'
}

function Get-EnvValue {
  param([string]$Key)
  $line = Select-String -Path '.env' -Pattern "^$Key=" | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line.Line -split '=', 2)[1].Trim()
}

$dbUrl     = Get-EnvValue 'DATABASE_URL'
$dbUrlTest = Get-EnvValue 'DATABASE_URL_TEST'
if (-not $dbUrl) { Die 'DATABASE_URL fehlt in .env' }

$dbName = node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" $dbUrl
$dbNameTest = ''
if ($dbUrlTest) {
  $dbNameTest = node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" $dbUrlTest
}
$adminUrl = node -e "const u=new URL(process.argv[1]); u.pathname='/postgres'; console.log(u.toString())" $dbUrl

# --- 3. Abhaengigkeiten und PostgreSQL --------------------------------
Write-Info 'Abhaengigkeiten installieren'
pnpm install
if ($LASTEXITCODE -ne 0) { Die 'pnpm install fehlgeschlagen' }
Write-Ok 'Abhaengigkeiten installiert'

Write-Info 'PostgreSQL pruefen'
function Test-PgReachable {
  param([string]$Url)
  # Reiner TCP-Test, braucht kein npm-Modul.
  $u = [System.Uri]$Url
  $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync($u.Host, $port)
    $done = $task.Wait(3000)
    $client.Close()
    return $done -and -not $task.IsFaulted
  } catch { return $false }
}

if (Test-PgReachable $adminUrl) {
  Write-Ok 'PostgreSQL erreichbar'
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Info 'Postgres-Container starten (docker compose up -d)'
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Die 'Container-Start fehlgeschlagen. Laeuft Docker Desktop?' }
  $reachable = $false
  foreach ($i in 1..30) {
    if (Test-PgReachable $adminUrl) { $reachable = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $reachable) { Die 'Container laeuft, Postgres antwortet nicht. Log: docker compose logs postgres' }
  Write-Ok 'PostgreSQL erreichbar (Container)'
} else {
  Die @'
PostgreSQL nicht erreichbar und Docker nicht nutzbar.
  Entweder Docker Desktop starten (dann macht dieses Skript den Rest),
  oder PostgreSQL 16 lokal installieren - Rolle, Passwort und Port wie in .env.
'@
}

# --- 4. Datenbanken ---------------------------------------------------
# SQL laeuft ueber @fahrschul/database, weil dort der Treiber (postgres.js)
# liegt; aus dem Repo-Root ist er im pnpm-Workspace nicht aufloesbar.
$sqlRunner = @'
import postgres from "postgres";
const sql = postgres(process.argv[1], { max: 1, onnotice: () => {} });
try {
  const rows = await sql.unsafe(process.argv[2]);
  if (rows.length) console.log("ROWS:" + JSON.stringify(rows));
} finally {
  await sql.end();
}
'@

function Invoke-SqlAdmin {
  param([string]$Sql)
  $out = pnpm --filter @fahrschul/database exec node --input-type=module -e $sqlRunner $adminUrl $Sql 2>$null
  return ($out | Select-String -Pattern '^ROWS:' | Select-Object -First 1)
}

function Test-DbExists {
  param([string]$Name)
  return $null -ne (Invoke-SqlAdmin "select 1 from pg_database where datname='$Name'")
}

$allDbs = @($dbName)
if ($dbNameTest) { $allDbs += $dbNameTest }

if ($Reset) {
  Write-Warn "-Reset loescht: $($allDbs -join ', ')"
  $answer = Read-Host 'Wirklich loeschen? Alle lokalen Testdaten gehen verloren [j/N]'
  if ($answer -notmatch '^[jJyY]$') { Die 'Abgebrochen.' }
  foreach ($d in $allDbs) {
    Invoke-SqlAdmin "select pg_terminate_backend(pid) from pg_stat_activity where datname='$d'" | Out-Null
    Invoke-SqlAdmin "drop database if exists ""$d""" | Out-Null
    Write-Ok "Datenbank '$d' geloescht"
  }
}

foreach ($d in $allDbs) {
  if (Test-DbExists $d) {
    Write-Ok "Datenbank '$d' vorhanden"
  } else {
    Invoke-SqlAdmin "create database ""$d""" | Out-Null
    Write-Ok "Datenbank '$d' angelegt"
  }
}

# --- 5. Migrationen ---------------------------------------------------
Write-Info 'Migrationen anwenden'
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Die 'Migration fehlgeschlagen' }
if ($dbNameTest) {
  $prev = $env:DATABASE_URL
  $env:DATABASE_URL = $dbUrlTest
  pnpm db:migrate | Out-Null
  $env:DATABASE_URL = $prev
  Write-Ok 'Test-Datenbank migriert'
}

# --- 6. Seed, nur wenn noch leer --------------------------------------
# db:seed ist nicht wiederholbar: ein zweiter Lauf bricht mit einer
# Unique-Verletzung ab. Deshalb vorher zaehlen.
$countRunner = @'
import postgres from "postgres";
const sql = postgres(process.argv[1], { max: 1, onnotice: () => {} });
try {
  const rows = await sql`select count(*)::int as n from benutzer`;
  console.log("N:" + rows[0].n);
} catch {
  console.log("N:0");
} finally {
  await sql.end();
}
'@
$countOut = pnpm --filter @fahrschul/database exec node --input-type=module -e $countRunner $dbUrl 2>$null
$match = $countOut | Select-String -Pattern 'N:(\d+)' | Select-Object -Last 1
$userCount = if ($match) { [int]$match.Matches[0].Groups[1].Value } else { 0 }

if ($userCount -gt 0) {
  Write-Ok "Testdaten vorhanden ($userCount Konten) - Seed uebersprungen"
} else {
  Write-Info 'Testdaten anlegen'
  pnpm db:seed
  if ($LASTEXITCODE -ne 0) { Die 'Seed fehlgeschlagen' }
  Write-Ok 'Testdaten angelegt'
}

# --- 7. Zusammenfassung -----------------------------------------------
Write-Host @'

----------------------------------------------------------------
  Einrichtung fertig.

  Starten (fuenf Terminals, API zuerst):

    pnpm dev:api          -> http://localhost:4000
    pnpm dev:student      -> http://localhost:5173   Schueler
    pnpm dev:office       -> http://localhost:5174   Buero
    pnpm dev:instructor   -> http://localhost:5175   Fahrlehrer
    pnpm dev:finance      -> http://localhost:5176   Finanzen

  Oder alles zusammen:  .\setup.ps1 -Start

  Passwort fuer alle Konten:  Test-Passwort-123!

    schueler@example.test     Schueler           :5173
    buero@example.test        Buero              :5174
    fahrlehrer@example.test   Fahrlehrer         :5175
    finanzen@example.test     Finanzen           :5176
    leitung@example.test      Geschaeftsfuehrung :5176

  Alle ausser dem Schueler brauchen zusaetzlich einen 6-stelligen Code:

    pnpm dev:totp --watch

  Meldet der Login "mfa_required_or_invalid", fehlt nur dieser Code.

  Tests:  pnpm test        (erwartet 794 gruen)
----------------------------------------------------------------
'@

if ($Start) {
  Write-Info 'API und alle vier Apps starten (je ein eigenes Fenster)'
  Start-Process pnpm -ArgumentList 'dev:api'
  Start-Sleep -Seconds 4
  foreach ($s in 'dev:student', 'dev:office', 'dev:instructor', 'dev:finance') {
    Start-Process pnpm -ArgumentList $s
  }
  Write-Ok 'Gestartet. Die Fenster einzeln mit Strg+C beenden.'
}
