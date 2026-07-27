/**
 * Testhilfen: jede Testdatei bekommt eine eigene Datenbankdatei, damit
 * Laeufe sich nicht gegenseitig beeinflussen.
 */
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../config/env.js';
import { config } from '../config/env.js';
import { migrate, closeDb, run, nowIso, get } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { createUser, User } from '../security/auth.js';
import { ingestAsset, setClearance, MediaAsset } from '../domain/media.js';
import { createContentItem, ContentItem } from '../domain/content.js';
import { ensureDefaultPrompts } from '../agents/prompts.js';
import { upsertFact, addPhrase, publishBrandVoice } from '../domain/brand.js';
import { ensureAccount } from '../integrations/registry.js';

const TEST_DIR = resolve(PROJECT_ROOT, 'data', 'test');

export interface TestContext {
  dbPath: string;
  accountId: string;
  cleanup: () => void;
}

let ctx: TestContext | null = null;

export function withTestDb(name: string): TestContext {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  const dbPath = resolve(TEST_DIR, `${name}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${dbPath}${suffix}`)) rmSync(`${dbPath}${suffix}`);
  }
  closeDb();
  // config.databasePath ist readonly typisiert, zur Testzeit aber umschaltbar.
  (config as any).databasePath = dbPath;
  migrate();

  ctx = {
    dbPath,
    accountId: '',
    cleanup: () => {
      closeDb();
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(`${dbPath}${suffix}`)) rmSync(`${dbPath}${suffix}`);
      }
    },
  };
  return ctx;
}

/** Minimale, aber realistische Markendaten fuer die Pruefer. */
export function seedMinimal(): void {
  ensureDefaultPrompts('test');

  upsertFact({
    category: 'standort', factKey: 'hauptregion', value: 'Fulda',
    status: 'VERIFIED', source: 'Test', actor: 'test',
  });
  upsertFact({
    category: 'standort', factKey: 'zweitstandort', value: 'Bad Hersfeld',
    status: 'VERIFIED', source: 'Test', actor: 'test',
  });
  upsertFact({
    category: 'team', factKey: 'anzahl_fahrlehrer', value: '18 Fahrlehrer',
    status: 'NEEDS_OWNER_CONFIRMATION', source: 'Test', actor: 'test',
  });

  addPhrase('forbidden', 'Partner fuer Mobilitaet', 'Agenturdeutsch', 'test');
  addPhrase('forbidden', 'garantiert bestehen', 'Unzulaessig', 'test');
  addPhrase('local_term', 'Fahrstunde', null, 'test');

  run(
    `INSERT INTO content_pillars (id, pillar_key, name, description, target_share, active)
     VALUES (?,?,?,?,?,1) ON CONFLICT(pillar_key) DO NOTHING`,
    newId('pil'), 'ablauf', 'Ablauf und Erwartung', 'Was konkret passiert', 0.5,
  );
  run(
    `INSERT INTO audience_segments (id, segment_key, name, description, objections_json, active)
     VALUES (?,?,?,?,?,1) ON CONFLICT(segment_key) DO NOTHING`,
    newId('seg'), 'fahranfaenger', 'Fahranfaenger', 'Erstfuehrerschein',
    JSON.stringify(['Ich habe Angst vor der ersten Fahrstunde']),
  );

  publishBrandVoice('# Brand Voice\nDirekt, konkret, ruhig.', 'Test', 'test');

  const account = ensureAccount({
    platform: 'sandbox',
    handle: 'testziel',
    displayName: 'Testziel',
    isPublic: false,
  });
  run(`UPDATE platform_accounts SET status = 'connected' WHERE id = ?`, account.id);
  if (ctx) ctx.accountId = account.id;
}

let userCounter = 0;

export function makeOwner(): User {
  const existing = get<User>(`SELECT * FROM users WHERE role = 'owner' LIMIT 1`);
  if (existing) return existing;
  return createUser({
    email: `owner${userCounter++}@test.local`,
    password: 'test-passwort-mindestens-12',
    role: 'owner',
    displayName: 'Test-Inhaber',
    actor: 'test',
  });
}

export function makeEditor(): User {
  const existing = get<User>(`SELECT * FROM users WHERE role = 'editor' LIMIT 1`);
  if (existing) return existing;
  return createUser({
    email: `editor${userCounter++}@test.local`,
    password: 'test-passwort-mindestens-12',
    role: 'editor',
    displayName: 'Test-Redaktion',
    actor: 'test',
  });
}

let assetCounter = 0;

/** Ein Asset, das alle Rechtepruefungen besteht. */
export function publishableAsset(owner: User): MediaAsset {
  const asset = ingestAsset({
    source: 'test',
    sourceRef: `asset-${assetCounter++}`,
    kind: 'video',
    url: 'https://example.invalid/clip.mp4',
    width: 1080,
    height: 1920,
    tags: ['lkw', 'depot', 'nacht'],
    searchText: 'Lkw auf dem Betriebshof bei Nacht',
    actor: 'test',
  });
  return setClearance({
    assetId: asset.id,
    consent: 'NOT_REQUIRED',
    rights: 'OWNED',
    platesVisible: 'NO',
    minorsPresent: 'NO',
    facesPresent: 'NO',
    actorUserId: owner.id,
    actor: 'test',
  });
}

/** Ein Beitrag, der alle inhaltlichen Pruefungen besteht. */
export function draftItem(opts: { assetIds: string[]; overrides?: Record<string, unknown> } ): ContentItem {
  const account = get<{ id: string }>(`SELECT id FROM platform_accounts WHERE platform = 'sandbox' LIMIT 1`);
  return createContentItem({
    platform: 'sandbox',
    accountId: account?.id ?? null,
    format: 'reel',
    title: 'Rangieren mit dem Lkw in Fulda',
    hookVariants: [
      'Rangieren mit dem Lkw sieht einfacher aus, als es ist.',
      'Was in der ersten Fahrstunde auf dem Uebungsplatz wirklich passiert.',
      'Der Fehler, den fast jeder CE-Anfaenger in Fulda macht.',
    ],
    script: 'Wir gehen die Standardsituationen auf dem Uebungsplatz durch, bevor du auf die Strasse gehst.',
    shotList: [],
    edl: [],
    onScreenText: ['Rangieren Klasse CE', 'Uebungsplatz Fulda'],
    subtitlesSrt: '1\n00:00:00,000 --> 00:00:03,000\nRangieren mit dem Lkw.\n',
    caption:
      'Klasse CE in Fulda: Viele unterschaetzen, wie viel Zeit das Rangieren am Anfang frisst. ' +
      'Wir gehen die Standardsituationen mit dir durch, bevor du auf die Strasse gehst.\n\n' +
      'Schreib uns deine Wunschklasse und ob Fulda oder Bad Hersfeld besser passt.',
    altText: 'Dunkle Aufnahme eines Lkw auf dem Betriebshof, seitliches Licht auf Grill und Reifen.',
    cta: 'Schreib uns deine Wunschklasse und deinen Standort.',
    hashtags: ['#fahrschulekrebs', '#fulda', '#badhersfeld', '#klassece', '#lkwführerschein'],
    storyFollowup: [],
    assetIds: opts.assetIds,
    actor: 'test',
    ...(opts.overrides ?? {}),
  } as any);
}

export { nowIso };
