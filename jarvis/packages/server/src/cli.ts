import { randomBytes } from 'node:crypto'
import { getDb, makeBackup, restoreFrom, closeDb } from './db/index.js'
import { config } from './config.js'
import { createUser, changePassword } from './auth/service.js'
import { ingestRoots, indexStats } from './knowledge/indexer.js'
import { systemStatus } from './http/status.js'
import { buildBriefing, briefingToText } from './projects/service.js'
import { runEval, seedRegressionCases } from './eval/runner.js'
import { verifyAuditChain } from './core/audit.js'
import { applyRetention } from './memory/service.js'
import { seedPrompts } from './llm/prompts.js'
import { errText } from './core/logger.js'

/**
 * Operator CLI. Everything an owner needs to run the system without the UI —
 * which matters most exactly when the UI is the thing that is broken.
 */

const [, , cmd, ...args] = process.argv

function usage(): void {
  process.stdout.write(`
JARVIS – Verwaltung

  user:create <name> <passwort> [owner|guest]   Benutzerkonto anlegen
  user:password <name> <alt> <neu>              Passwort ändern
  index [--force]                               Quellen einlesen und indexieren
  index:stats                                   Indexgröße anzeigen
  status                                        Systemzustand anzeigen
  briefing                                      Tagesbriefing ausgeben
  eval [retrieval|full]                         Regressionslauf starten
  audit:verify                                  Hash-Kette des Audit-Logs prüfen
  retention                                     Aufbewahrungsregeln anwenden
  backup                                        Sicherung erstellen
  restore <datei>                               Sicherung einspielen (Server vorher stoppen!)
  keygen                                        Master-Key erzeugen

`)
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return }

  if (cmd === 'keygen') {
    process.stdout.write(
      `JARVIS_MASTER_KEY=${randomBytes(32).toString('hex')}\n` +
      `JARVIS_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`,
    )
    return
  }

  const db = getDb()
  seedPrompts(db)
  seedRegressionCases(db)

  switch (cmd) {
    case 'user:create': {
      const [name, password, role = 'owner'] = args
      if (!name || !password) { process.stderr.write('Aufruf: user:create <name> <passwort> [owner|guest]\n'); process.exitCode = 1; return }
      const u = createUser(db, name, password, role === 'guest' ? 'guest' : 'owner')
      process.stdout.write(`Benutzer angelegt: ${u.username} (${u.role})\n`)
      break
    }
    case 'user:password': {
      const [name, current, next] = args
      if (!name || !current || !next) { process.stderr.write('Aufruf: user:password <name> <alt> <neu>\n'); process.exitCode = 1; return }
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(name.toLowerCase()) as { id: string } | undefined
      if (!row) { process.stderr.write('Benutzer nicht gefunden\n'); process.exitCode = 1; return }
      process.stdout.write(changePassword(db, row.id, current, next) ? 'Passwort geändert\n' : 'Aktuelles Passwort falsch\n')
      break
    }
    case 'index': {
      const force = args.includes('--force')
      process.stdout.write(`Indexiere ${config.sourceRoots.join(', ')} …\n`)
      const stats = await ingestRoots(db, config.sourceRoots, { force })
      process.stdout.write(JSON.stringify(stats, null, 2) + '\n')
      break
    }
    case 'index:stats':
      process.stdout.write(JSON.stringify(indexStats(db), null, 2) + '\n')
      break
    case 'status':
      process.stdout.write(JSON.stringify(await systemStatus(db), null, 2) + '\n')
      break
    case 'briefing':
      process.stdout.write(briefingToText(buildBriefing(db)) + '\n')
      break
    case 'eval': {
      const tier = args[0] === 'full' ? 'full' : 'retrieval'
      const run = await runEval(db, { tier, actor: 'cli' })
      process.stdout.write(`${run.passed}/${run.passed + run.failed} bestanden (Score ${run.score})\n`)
      for (const c of run.cases.filter((x) => !x.passed)) {
        process.stdout.write(`  ✗ ${c.name}: ${c.failures.join('; ')}\n`)
      }
      process.exitCode = run.failed > 0 ? 1 : 0
      break
    }
    case 'audit:verify': {
      const r = verifyAuditChain(db)
      process.stdout.write(r.valid
        ? `Hash-Kette intakt (${r.entries} Einträge)\n`
        : `KETTE GEBROCHEN ab ${r.brokenAt} (${r.entries} Einträge)\n`)
      process.exitCode = r.valid ? 0 : 1
      break
    }
    case 'retention':
      process.stdout.write(JSON.stringify(applyRetention(db), null, 2) + '\n')
      break
    case 'backup': {
      const b = makeBackup(db)
      process.stdout.write(`Sicherung: ${b.path} (${Math.round(b.bytes / 1024)} KB)\n`)
      break
    }
    case 'restore': {
      const file = args[0]
      if (!file) { process.stderr.write('Aufruf: restore <datei>\n'); process.exitCode = 1; return }
      restoreFrom(file)
      process.stdout.write(`Wiederhergestellt aus ${file}\n`)
      break
    }
    default:
      process.stderr.write(`Unbekannter Befehl: ${cmd}\n`)
      usage()
      process.exitCode = 1
  }

  closeDb()
}

main().catch((e) => {
  process.stderr.write(`Fehler: ${errText(e)}\n`)
  process.exit(1)
})
