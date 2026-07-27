/**
 * HTTP-API.
 *
 * Konventionen:
 *  - Jede schreibende Route deklariert die Mindestrolle. `owner` ist fuer
 *    alles reserviert, was eine Veroeffentlichung ausloesen oder eine Regel
 *    aendern kann.
 *  - Fehler werden mit Klartext-Ursache zurueckgegeben, nie als "500".
 *  - Keine Route gibt jemals ein Secret zurueck; die Integrationsuebersicht
 *    liefert nur Status und Ablaufdatum.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { all, get, run, nowIso, parseJson } from '../db/index.js';
import { config, publicConfig } from '../config/env.js';
import {
  login,
  logout,
  resolveSession,
  requireRole,
  AuthError,
  SessionUser,
  Role,
  listUsers,
  createUser,
  changePassword,
} from '../security/auth.js';
import {
  listFacts,
  upsertFact,
  listPhrases,
  addPhrase,
  listPillars,
  listSegments,
  activeBrandVoice,
  publishBrandVoice,
  onboardingQuestions,
  nextOnboardingQuestion,
  answerOnboarding,
} from '../domain/brand.js';
import {
  searchMediaNatural,
  reviewQueue,
  setClearance,
  runPrivacyReview,
  ingestAsset,
  getAsset,
  updateTags,
  publishBlockers,
} from '../domain/media.js';
import {
  listContentItems,
  getContentItem,
  updateContentItem,
  contentVersions,
  openFindings,
  publishRelevantView,
} from '../domain/content.js';
import {
  buildApprovalCard,
  approvalQueue,
  decide,
  approvalHistory,
  revokeApproval,
  ApprovalError,
} from '../domain/approval.js';
import { researchOpportunities, buildWeeklyPlan, persistPlan, pillarSaturation } from '../agents/creative.js';
import { runProductionPipeline, review, agentStatus, revalidatePending, AGENT_ROLES } from '../agents/orchestrator.js';
import { llmMode } from '../agents/llm.js';
import { promptVersions } from '../agents/prompts.js';
import {
  enqueue,
  listJobs,
  jobHistory,
  requeueDeadLetter,
  queueStats,
  tick,
} from '../queue/publisher.js';
import { integrationOverview, refreshAccountStatus, listAccounts } from '../integrations/registry.js';
import {
  ingestMetrics,
  importManualMetrics,
  getScores,
  latestMetrics,
  performanceMemory,
  setFollowerBase,
} from '../domain/analytics.js';
import {
  createExperiment,
  assign,
  analyze,
  conclude,
  listExperiments,
} from '../domain/experiments.js';
import {
  ingestMessage,
  listInbox,
  draftReply,
  approveReply,
  leadPipeline,
  leadsBySource,
  updateLead,
} from '../domain/inbox.js';
import {
  runPostmortem,
  proposeChange,
  testProposal,
  applyProposal,
  rollbackProposal,
  listProposals,
  generateLearningReport,
  listReports,
  getReport,
  runRegressionSuite,
  addBenchmarkExample,
} from '../domain/learning.js';
import { recordEvent } from '../observability/logger.js';

const COOKIE = 'fk_session';

function currentUser(req: FastifyRequest): SessionUser | null {
  const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
  return resolveSession(token);
}

/** Wrapper mit Rollenpruefung und einheitlicher Fehlerbehandlung. */
function guard(
  minimum: Role,
  handler: (req: FastifyRequest, reply: FastifyReply, user: SessionUser) => Promise<unknown> | unknown,
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = requireRole(currentUser(req), minimum);
      return await handler(req, reply, user);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.status).send({ error: err.message });
      }
      if (err instanceof ApprovalError) {
        return reply.code(409).send({ error: err.message, code: err.code });
      }
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Ungueltige Eingabe.',
          details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
      }
      req.log.error({ err }, 'Fehler in API-Handler');
      return reply.code(400).send({ error: (err as Error).message });
    }
  };
}

function actorOf(user: SessionUser): string {
  return `${user.email} (${user.role})`;
}

export async function registerApi(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- Auth
  // Anmeldeversuche werden deutlich strenger begrenzt als der Rest der API:
  // 10 Versuche pro 5 Minuten je IP. Das bremst Rateversuche wirksam aus,
  // ohne einen Mitarbeiter zu sperren, der sich zweimal vertippt.
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    try {
      const result = login(body.email, body.password, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      reply.setCookie(COOKIE, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
        maxAge: 12 * 3600,
      });
      return { user: result.user, expiresAt: result.expiresAt };
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    logout((req.cookies as Record<string, string> | undefined)?.[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: 'Nicht angemeldet.' });
    return { user, config: publicConfig() };
  });

  app.get('/api/users', guard('owner', () => listUsers()));

  app.post(
    '/api/users',
    guard('owner', (req, _r, user) => {
      const body = z
        .object({
          email: z.string().email(),
          password: z.string().min(12),
          role: z.enum(['owner', 'editor', 'viewer']),
          displayName: z.string().min(1),
        })
        .parse(req.body);
      const created = createUser({ ...body, actor: actorOf(user) });
      return { id: created.id, email: created.email, role: created.role };
    }),
  );

  app.post(
    '/api/auth/password',
    guard('viewer', (req, _r, user) => {
      const body = z.object({ newPassword: z.string().min(12) }).parse(req.body);
      changePassword(user.id, body.newPassword, actorOf(user));
      return { ok: true, note: 'Passwort geaendert. Bitte neu anmelden.' };
    }),
  );

  // ------------------------------------------------------------- Today
  app.get(
    '/api/today',
    guard('viewer', () => {
      const queue = approvalQueue();
      const jobs = queueStats();
      const alerts = all(
        'SELECT * FROM system_alerts WHERE acknowledged_at IS NULL ORDER BY at DESC LIMIT 20',
      );
      const mediaQueue = reviewQueue().length;
      const upcoming = all<any>(
        `SELECT id, title, platform, format, scheduled_for, state FROM content_items
         WHERE state IN ('scheduled','approved') AND scheduled_for IS NOT NULL
         ORDER BY scheduled_for ASC LIMIT 10`,
      );
      const inbox = listInbox({ status: 'new', limit: 10 });
      const unverifiedFacts = listFacts({ status: 'NEEDS_OWNER_CONFIRMATION' }).length;

      return {
        needsAttention: {
          approvalsWaiting: queue.length,
          approvalsBlocked: queue.filter((c) => !c.canApprove).length,
          mediaAwaitingClearance: mediaQueue,
          openAlerts: alerts.length,
          deadLetterJobs: jobs.dead_letter,
          newMessages: inbox.length,
          unverifiedFacts,
        },
        upcoming,
        alerts,
        queue: jobs,
        approvals: queue.slice(0, 5),
        inbox,
        llmMode: llmMode(),
      };
    }),
  );

  // ------------------------------------------------------------- Brand
  app.get('/api/brand', guard('viewer', () => ({
    voice: activeBrandVoice() ?? null,
    facts: listFacts(),
    phrases: listPhrases(),
    pillars: listPillars(),
    segments: listSegments(),
    onboarding: onboardingQuestions(),
    nextQuestion: nextOnboardingQuestion() ?? null,
  })));

  app.post(
    '/api/brand/facts',
    guard('owner', (req, _r, user) => {
      const body = z
        .object({
          category: z.string().min(1),
          factKey: z.string().min(1),
          value: z.string().min(1),
          status: z.enum(['VERIFIED', 'NEEDS_OWNER_CONFIRMATION', 'EXPIRED', 'REJECTED']),
          source: z.string().min(1),
          sourceUrl: z.string().optional().nullable(),
          expiresAt: z.string().optional().nullable(),
          notes: z.string().optional().nullable(),
        })
        .parse(req.body);
      return upsertFact({ ...body, actor: actorOf(user) });
    }),
  );

  app.post(
    '/api/brand/phrases',
    guard('editor', (req, _r, user) => {
      const body = z
        .object({
          kind: z.enum(['preferred', 'forbidden', 'local_term']),
          text: z.string().min(1),
          note: z.string().optional().nullable(),
        })
        .parse(req.body);
      addPhrase(body.kind, body.text, body.note ?? null, actorOf(user));
      return { ok: true };
    }),
  );

  app.post(
    '/api/brand/voice',
    guard('owner', (req, _r, user) => {
      const body = z.object({ markdown: z.string().min(20), changeSummary: z.string().min(1) }).parse(req.body);
      const version = publishBrandVoice(body.markdown, body.changeSummary, actorOf(user));
      return { version };
    }),
  );

  app.post(
    '/api/brand/onboarding',
    guard('owner', (req, _r, user) => {
      const body = z.object({ questionKey: z.string(), answer: z.string() }).parse(req.body);
      const result = answerOnboarding(body.questionKey, body.answer, actorOf(user));
      return { ...result, nextQuestion: nextOnboardingQuestion() ?? null };
    }),
  );

  // ------------------------------------------------------------- Media
  app.get(
    '/api/media/search',
    guard('viewer', (req) => {
      const q = z
        .object({
          q: z.string().default(''),
          onlyPublishable: z.enum(['true', 'false']).default('true'),
          limit: z.coerce.number().min(1).max(100).default(30),
        })
        .parse(req.query);
      const { query, hits } = searchMediaNatural(q.q, {
        onlyPublishable: q.onlyPublishable === 'true',
        limit: q.limit,
      });
      return {
        interpretedQuery: query,
        results: hits.map((h) => ({
          id: h.asset.id,
          kind: h.asset.kind,
          url: h.asset.url,
          orientation: h.asset.orientation,
          quality: h.asset.quality_score,
          consent: h.asset.consent_status,
          rights: h.asset.rights_status,
          reviewStatus: h.asset.review_status,
          tags: parseJson<string[]>(h.asset.tags_json, []),
          lastUsedAt: h.asset.last_used_at,
          useCount: h.asset.use_count,
          score: Math.round(h.score * 10) / 10,
          reasons: h.reasons,
          blockers: h.blockers,
        })),
      };
    }),
  );

  app.get('/api/media/queue', guard('viewer', () =>
    reviewQueue().map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.url,
      source: a.source,
      consent: a.consent_status,
      rights: a.rights_status,
      reviewStatus: a.review_status,
      tags: parseJson<string[]>(a.tags_json, []),
      blockers: publishBlockers(a),
    })),
  ));

  app.post(
    '/api/media/ingest',
    guard('editor', (req, _r, user) => {
      const body = z
        .object({
          source: z.string().min(1),
          sourceRef: z.string().optional().nullable(),
          kind: z.enum(['image', 'video', 'audio']),
          url: z.string().url().optional().nullable(),
          localPath: z.string().optional().nullable(),
          width: z.number().optional().nullable(),
          height: z.number().optional().nullable(),
          durationS: z.number().optional().nullable(),
          captureDate: z.string().optional().nullable(),
          captureLocation: z.string().optional().nullable(),
          tags: z.array(z.string()).default([]),
          searchText: z.string().default(''),
          qualityScore: z.number().min(0).max(100).default(50),
        })
        .parse(req.body);
      const asset = ingestAsset({ ...body, actor: actorOf(user) });
      const findings = runPrivacyReview(asset.id, actorOf(user));
      return { asset, privacyFindings: findings };
    }),
  );

  app.post(
    '/api/media/:id/clearance',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({
          consent: z.enum(['UNKNOWN', 'NOT_REQUIRED', 'PENDING', 'CLEARED', 'REFUSED', 'WITHDRAWN']),
          rights: z.enum(['UNKNOWN', 'OWNED', 'LICENSED', 'PLATFORM_AUTHORIZED', 'RESTRICTED', 'FORBIDDEN']),
          licence: z.string().optional().nullable(),
          licenceExpiresAt: z.string().optional().nullable(),
          platesVisible: z.enum(['UNKNOWN', 'YES', 'NO', 'BLURRED']).optional(),
          minorsPresent: z.enum(['UNKNOWN', 'YES', 'NO']).optional(),
          facesPresent: z.enum(['UNKNOWN', 'YES', 'NO']).optional(),
          note: z.string().optional().nullable(),
        })
        .parse(req.body);
      const asset = setClearance({ assetId: id, ...body, actorUserId: user.id, actor: actorOf(user) });
      return { asset, blockers: publishBlockers(asset) };
    }),
  );

  app.patch(
    '/api/media/:id/tags',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ tags: z.array(z.string()), searchText: z.string().default('') }).parse(req.body);
      updateTags(id, body.tags, body.searchText, actorOf(user));
      return getAsset(id);
    }),
  );

  // ------------------------------------------------------- Opportunities
  app.get('/api/opportunities', guard('viewer', () =>
    all('SELECT * FROM opportunities ORDER BY total_score DESC LIMIT 100').map((o: any) => ({
      ...o,
      evidence: parseJson<string[]>(o.evidence_json, []),
      scores: parseJson<Record<string, number>>(o.scores_json, {}),
    })),
  ));

  app.post(
    '/api/opportunities/research',
    guard('editor', async (req, _r, user) => {
      const body = z.object({ limit: z.number().min(1).max(30).default(10) }).parse(req.body ?? {});
      return researchOpportunities(body.limit, actorOf(user));
    }),
  );

  // -------------------------------------------------------------- Plan
  app.get('/api/plan', guard('viewer', () => ({
    items: all('SELECT * FROM plan_items ORDER BY proposed_publish_at ASC LIMIT 100'),
    saturation: pillarSaturation(),
    pillarTargets: listPillars().map((p) => ({ key: p.pillar_key, name: p.name, target: p.target_share })),
  })));

  app.post(
    '/api/plan/generate',
    guard('editor', (req, _r, user) => {
      const body = z.object({ count: z.number().min(1).max(30).default(7) }).parse(req.body ?? {});
      const drafts = buildWeeklyPlan(body.count, actorOf(user));
      const ids = persistPlan(drafts, null, actorOf(user));
      return { created: ids.length, ids };
    }),
  );

  app.post(
    '/api/plan/:id/produce',
    guard('editor', async (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ accountId: z.string().optional().nullable() }).parse(req.body ?? {});
      return runProductionPipeline(id, actorOf(user), { accountId: body.accountId ?? null });
    }),
  );

  // ----------------------------------------------------------- Content
  app.get(
    '/api/content',
    guard('viewer', (req) => {
      const q = z.object({ state: z.string().optional(), limit: z.coerce.number().default(50) }).parse(req.query);
      return listContentItems({ state: q.state as any, limit: q.limit });
    }),
  );

  app.get(
    '/api/content/:id',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const item = getContentItem(id);
      if (!item) throw new Error(`Content-Item ${id} nicht gefunden.`);
      return {
        item,
        preview: publishRelevantView(item),
        findings: openFindings(id),
        versions: contentVersions(id),
        approvals: approvalHistory(id),
        scores: getScores(id),
        metrics: latestMetrics(id),
      };
    }),
  );

  app.patch(
    '/api/content/:id',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({ patch: z.record(z.unknown()), changeSummary: z.string().min(1) })
        .parse(req.body);
      const result = updateContentItem(id, body.patch, body.changeSummary, actorOf(user));
      const reviewResult = review(id, actorOf(user));
      return { ...result, review: reviewResult };
    }),
  );

  app.post(
    '/api/content/:id/review',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return review(id, actorOf(user));
    }),
  );

  // --------------------------------------------------------- Approvals
  app.get('/api/approvals', guard('viewer', () => approvalQueue()));

  app.get(
    '/api/approvals/:id',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return buildApprovalCard(id);
    }),
  );

  app.post(
    '/api/approvals/:id/decide',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({
          decision: z.enum([
            'approve_once',
            'approve_with_edits',
            'reject',
            'return_to_concept',
            'schedule',
            'publish_now',
            'cancel',
          ]),
          seenHash: z.string().min(1),
          note: z.string().optional().nullable(),
          scheduledFor: z.string().optional().nullable(),
          edits: z
            .array(z.object({ field: z.string(), value: z.unknown() }).transform((e) => ({
              field: e.field,
              value: e.value ?? null,
            })))
            .optional(),
        })
        .parse(req.body);

      const result = decide({
        itemId: id,
        decision: body.decision,
        userId: user.id,
        userRole: user.role,
        actor: actorOf(user),
        note: body.note ?? null,
        scheduledFor: body.scheduledFor ?? null,
        edits: body.edits,
        seenHash: body.seenHash,
      });

      // Bei "jetzt veroeffentlichen" und "einplanen" direkt in die Warteschlange.
      let job = null;
      if (['approve_once', 'approve_with_edits', 'schedule', 'publish_now'].includes(body.decision)) {
        job = enqueue(
          id,
          actorOf(user),
          body.decision === 'publish_now' ? nowIso() : body.scheduledFor ?? undefined,
        );
      }
      return { ...result, job };
    }),
  );

  app.post(
    '/api/approvals/:id/revoke',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ reason: z.string().min(3) }).parse(req.body);
      const changed = revokeApproval(id, body.reason, actorOf(user));
      return { revoked: changed };
    }),
  );

  // -------------------------------------------------------- Publishing
  app.get(
    '/api/jobs',
    guard('viewer', (req) => {
      const q = z.object({ state: z.string().optional(), limit: z.coerce.number().default(50) }).parse(req.query);
      return { jobs: listJobs({ state: q.state, limit: q.limit }), stats: queueStats() };
    }),
  );

  app.get(
    '/api/jobs/:id/events',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return jobHistory(id);
    }),
  );

  app.post(
    '/api/jobs/:id/requeue',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return requeueDeadLetter(id, actorOf(user));
    }),
  );

  app.post(
    '/api/jobs/tick',
    guard('owner', async () => tick(10)),
  );

  // ------------------------------------------------------------- Inbox
  app.get(
    '/api/inbox',
    guard('viewer', (req) => {
      const q = z
        .object({ status: z.string().optional(), classification: z.string().optional(), limit: z.coerce.number().default(50) })
        .parse(req.query);
      return listInbox(q);
    }),
  );

  app.post(
    '/api/inbox/ingest',
    guard('editor', (req, _r, user) => {
      const body = z
        .object({
          platform: z.string(),
          externalId: z.string(),
          kind: z.enum(['comment', 'dm', 'mention']),
          authorHandle: z.string(),
          authorDisplay: z.string().optional().nullable(),
          body: z.string(),
          contentItemId: z.string().optional().nullable(),
        })
        .parse(req.body);
      return ingestMessage({ ...body, actor: actorOf(user) });
    }),
  );

  app.post(
    '/api/inbox/:id/draft',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return draftReply(id, actorOf(user));
    }),
  );

  app.post(
    '/api/replies/:id/approve',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      approveReply(id, user.id, actorOf(user));
      return { ok: true };
    }),
  );

  app.get('/api/leads', guard('viewer', () => ({
    pipeline: leadPipeline(),
    bySource: leadsBySource(),
    leads: all('SELECT * FROM leads ORDER BY updated_at DESC LIMIT 100'),
  })));

  app.patch(
    '/api/leads/:id',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({
          stage: z.enum(['new', 'qualified', 'appointment', 'registered', 'lost']).optional(),
          licence_class: z.string().optional().nullable(),
          location: z.string().optional().nullable(),
          note: z.string().optional().nullable(),
          appointment_at: z.string().optional().nullable(),
          registered_at: z.string().optional().nullable(),
          revenue_cents: z.number().optional().nullable(),
        })
        .parse(req.body);
      return updateLead(id, body, actorOf(user));
    }),
  );

  // --------------------------------------------------------- Analytics
  app.get('/api/analytics', guard('viewer', () => ({
    memory: performanceMemory(50),
    pipeline: leadPipeline(),
    bySource: leadsBySource(10),
  })));

  app.get(
    '/api/analytics/:id',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return { scores: getScores(id), metrics: latestMetrics(id) };
    }),
  );

  app.post(
    '/api/analytics/:id/collect',
    guard('editor', async (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z
        .object({ window: z.enum(['t2h', 't24h', 't72h', 't7d', 'manual']).default('t24h') })
        .parse(req.body ?? {});
      return ingestMetrics(id, body.window, actorOf(user));
    }),
  );

  app.post(
    '/api/analytics/:id/manual',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ metrics: z.record(z.number()) }).parse(req.body);
      return importManualMetrics(id, body.metrics, actorOf(user));
    }),
  );

  app.post(
    '/api/analytics/follower-base',
    guard('owner', (req) => {
      const body = z.object({ platform: z.string(), count: z.number().min(0) }).parse(req.body);
      setFollowerBase(body.platform, body.count);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------- Experiments
  app.get('/api/experiments', guard('viewer', () => listExperiments()));

  app.post(
    '/api/experiments',
    guard('editor', (req, _r, user) => {
      const body = z
        .object({
          name: z.string().min(1),
          hypothesis: z.string().min(1),
          variable: z.enum([
            'hook','opening_visual','duration','cover','caption_length','cta','publish_time','topic_framing',
          ]),
          variants: z.array(z.string()).min(2).max(4),
          minSamplePerVariant: z.number().min(2).max(100).optional(),
          primaryMetric: z.string().optional(),
        })
        .parse(req.body);
      return createExperiment({ ...body, actor: actorOf(user) });
    }),
  );

  app.post(
    '/api/experiments/:id/assign',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ contentItemId: z.string() }).parse(req.body);
      return { variant: assign(id, body.contentItemId, actorOf(user)) };
    }),
  );

  app.get(
    '/api/experiments/:id/analysis',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return analyze(id);
    }),
  );

  app.post(
    '/api/experiments/:id/conclude',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
      return conclude(id, actorOf(user), body.force);
    }),
  );

  // --------------------------------------------------------- Learning
  app.get('/api/learning', guard('viewer', () => ({
    proposals: listProposals(),
    reports: listReports(),
    prompts: promptVersions(),
    postmortems: all('SELECT * FROM postmortems ORDER BY created_at DESC LIMIT 50'),
    benchmarks: all('SELECT id, label, platform, format, reason, created_at FROM benchmark_examples'),
  })));

  app.post(
    '/api/content/:id/postmortem',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return runPostmortem(id, actorOf(user));
    }),
  );

  app.post(
    '/api/learning/proposals',
    guard('editor', (req, _r, user) => {
      const body = z
        .object({
          title: z.string().min(1),
          rationale: z.string().min(1),
          targetKind: z.enum(['prompt', 'rule', 'schedule', 'pillar_mix', 'hashtag_strategy', 'scoring_weight', 'other']),
          targetRef: z.string().min(1),
          currentValue: z.string(),
          proposedValue: z.string(),
          evidence: z.record(z.unknown()).default({}),
        })
        .parse(req.body);
      return proposeChange({ ...body, actor: actorOf(user) });
    }),
  );

  app.post(
    '/api/learning/proposals/:id/test',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return testProposal(id, actorOf(user));
    }),
  );

  app.post(
    '/api/learning/proposals/:id/apply',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return applyProposal(id, user.id, actorOf(user));
    }),
  );

  app.post(
    '/api/learning/proposals/:id/rollback',
    guard('owner', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return rollbackProposal(id, actorOf(user));
    }),
  );

  app.post('/api/learning/regression', guard('editor', () => runRegressionSuite()));

  app.post(
    '/api/learning/benchmarks',
    guard('owner', (req, _r, user) => {
      const body = z
        .object({
          label: z.enum(['strong', 'weak']),
          platform: z.string(),
          format: z.string(),
          payload: z.record(z.unknown()),
          reason: z.string().min(1),
        })
        .parse(req.body);
      return { id: addBenchmarkExample({ ...body, actor: actorOf(user) }) };
    }),
  );

  app.post(
    '/api/learning/reports',
    guard('editor', (req, _r, user) => {
      const body = z.object({ days: z.number().min(1).max(90).default(7) }).parse(req.body ?? {});
      return generateLearningReport(actorOf(user), body.days);
    }),
  );

  app.get(
    '/api/learning/reports/:id',
    guard('viewer', (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return getReport(id);
    }),
  );

  // ------------------------------------------------- Health / Settings
  app.get('/api/health', async () => {
    const dbOk = (() => {
      try {
        get('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    })();
    return {
      status: dbOk ? 'ok' : 'degraded',
      time: nowIso(),
      database: dbOk ? 'erreichbar' : 'nicht erreichbar',
      version: publicConfig().version,
    };
  });

  app.get(
    '/api/health/detail',
    guard('viewer', () => {
      const alerts = all('SELECT * FROM system_alerts WHERE acknowledged_at IS NULL ORDER BY at DESC');
      const migrations = all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
      return {
        queue: queueStats(),
        alerts,
        migrations,
        agents: agentStatus(),
        llmMode: llmMode(),
        integrations: integrationOverview(),
        counts: {
          contentItems: get<{ n: number }>('SELECT COUNT(*) AS n FROM content_items')?.n ?? 0,
          mediaAssets: get<{ n: number }>('SELECT COUNT(*) AS n FROM media_assets')?.n ?? 0,
          publishedItems: get<{ n: number }>(`SELECT COUNT(*) AS n FROM content_items WHERE state = 'published'`)?.n ?? 0,
          events: get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n ?? 0,
        },
      };
    }),
  );

  app.post(
    '/api/alerts/:id/ack',
    guard('editor', (req, _r, user) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      run('UPDATE system_alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?', nowIso(), user.email, id);
      return { ok: true };
    }),
  );

  app.get('/api/agents', guard('viewer', () => ({ roles: AGENT_ROLES, status: agentStatus() })));

  app.get('/api/integrations', guard('viewer', () => integrationOverview()));

  app.post(
    '/api/integrations/refresh',
    guard('owner', async (_req, _r, user) => {
      const accounts = await refreshAccountStatus(actorOf(user));
      return accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        status: a.status,
        lastCheckError: a.last_check_error,
      }));
    }),
  );

  app.post(
    '/api/integrations/accounts',
    guard('owner', async (req, _r, user) => {
      const body = z
        .object({
          platform: z.enum(['instagram', 'facebook', 'tiktok', 'youtube', 'sandbox']),
          handle: z.string().min(1),
          displayName: z.string().min(1),
          isPublic: z.boolean().default(true),
        })
        .parse(req.body);
      const { ensureAccount } = await import('../integrations/registry.js');
      const account = ensureAccount(body);
      recordEvent({
        kind: 'integrations.account_added',
        actor: actorOf(user),
        entityType: 'platform_account',
        entityId: account.id,
        message: `Konto ${body.platform}/@${body.handle} angelegt.`,
      });
      return account;
    }),
  );

  app.post(
    '/api/system/revalidate',
    guard('owner', (_req, _r, user) => revalidatePending(actorOf(user))),
  );

  app.get(
    '/api/events',
    guard('viewer', (req) => {
      const q = z
        .object({ limit: z.coerce.number().min(1).max(500).default(100), kind: z.string().optional() })
        .parse(req.query);
      return q.kind
        ? all('SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?', q.kind, q.limit)
        : all('SELECT * FROM events ORDER BY id DESC LIMIT ?', q.limit);
    }),
  );

  app.get('/api/accounts', guard('viewer', () => listAccounts()));
}
