/**
 * TikTok ueber die offizielle Content Posting API.
 *
 * Ablauf: `video/init` mit PULL_FROM_URL -> TikTok laedt die Datei selbst ->
 * Status ueber `publish/status/fetch` abfragen, bis PUBLISH_COMPLETE.
 *
 * Wichtige Einschraenkung, die der Betreiber kennen muss: unverifizierte Apps
 * duerfen nur nach SELF_ONLY veroeffentlichen. Der Adapter liest die
 * erlaubten Sichtbarkeiten beim Anbieter aus und meldet es, statt einen
 * Beitrag stillschweigend privat zu stellen.
 */
import { config } from '../config/env.js';
import {
  PublishAdapter,
  PublishInput,
  PublishOutput,
  VerifyOutput,
  MetricsOutput,
  IntegrationError,
  httpJson,
} from './types.js';

const API = 'https://open.tiktokapis.com/v2';

function authHeaders(): Record<string, string> {
  if (!config.tiktok.accessToken) {
    throw new IntegrationError(
      'TIKTOK_ACCESS_TOKEN ist nicht gesetzt. Ohne Token kann nichts auf TikTok veroeffentlicht werden.',
      'missing_credentials',
      false,
    );
  }
  return {
    authorization: `Bearer ${config.tiktok.accessToken}`,
    'content-type': 'application/json; charset=UTF-8',
  };
}

export class TikTokAdapter implements PublishAdapter {
  readonly platform = 'tiktok';
  readonly isPublic = true;

  isConfigured(): boolean {
    return !!config.tiktok.accessToken;
  }

  async checkConnection() {
    if (!this.isConfigured()) {
      return { ok: false, detail: 'Nicht konfiguriert: TIKTOK_ACCESS_TOKEN fehlt.', expiresAt: null };
    }
    const info = await httpJson(`${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = info?.data ?? {};
    const options: string[] = data.privacy_level_options ?? [];
    const publicAllowed = options.some((o) => o !== 'SELF_ONLY');
    return {
      ok: true,
      detail:
        `Verbunden mit @${data.creator_username ?? 'unbekannt'}. ` +
        (publicAllowed
          ? `Erlaubte Sichtbarkeiten: ${options.join(', ')}.`
          : 'ACHTUNG: Die App ist nicht auditiert - Beitraege koennen nur als SELF_ONLY (nur fuer dich sichtbar) ' +
            'veroeffentlicht werden. Fuer oeffentliche Beitraege ist ein TikTok-App-Audit erforderlich.'),
      expiresAt: null,
    };
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    const asset = input.assets[0];
    if (!asset || asset.kind !== 'video') {
      throw new IntegrationError(
        'TikTok akzeptiert ueber diesen Weg nur Videos.',
        'unsupported',
        false,
      );
    }
    if (!asset.url?.startsWith('https://')) {
      throw new IntegrationError(
        `Asset ${asset.id} hat keine oeffentlich erreichbare HTTPS-URL. TikTok laedt die Datei selbst.`,
        'validation',
        false,
      );
    }

    const info = await httpJson(`${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const options: string[] = info?.data?.privacy_level_options ?? ['SELF_ONLY'];
    const privacy = options.includes('PUBLIC_TO_EVERYONE')
      ? 'PUBLIC_TO_EVERYONE'
      : options[0] ?? 'SELF_ONLY';

    const tags = JSON.parse(input.item.hashtags_json || '[]') as string[];
    const title = [input.item.caption, tags.join(' ')].filter(Boolean).join(' ').slice(0, 2200);

    const init = await httpJson(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: { source: 'PULL_FROM_URL', video_url: asset.url },
      }),
    });

    const publishId = init?.data?.publish_id;
    if (!publishId) {
      throw new IntegrationError(
        `TikTok hat keine publish_id geliefert: ${JSON.stringify(init?.error ?? init)}`,
        'provider_error',
        true,
      );
    }

    const finalStatus = await this.waitForPublish(publishId);

    return {
      externalPostId: finalStatus.postId ?? publishId,
      externalUrl: finalStatus.shareUrl,
      raw: { publishId, privacy, publiclyVisible: privacy !== 'SELF_ONLY' },
    };
  }

  private async waitForPublish(
    publishId: string,
  ): Promise<{ postId: string | null; shareUrl: string | null }> {
    const deadline = Date.now() + 8 * 60_000;
    let delay = 4000;
    while (Date.now() < deadline) {
      const res = await httpJson(`${API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ publish_id: publishId }),
      });
      const status = res?.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        const ids: string[] = res?.data?.publicaly_available_post_id ?? res?.data?.publicly_available_post_id ?? [];
        const postId = ids[0] ?? null;
        return {
          postId,
          shareUrl: postId ? `https://www.tiktok.com/@${config.tiktok.openId ?? 'me'}/video/${postId}` : null,
        };
      }
      if (status === 'FAILED') {
        throw new IntegrationError(
          `TikTok hat die Veroeffentlichung abgelehnt: ${res?.data?.fail_reason ?? 'kein Grund angegeben'}`,
          'media_processing',
          false,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.4, 20_000);
    }
    throw new IntegrationError(
      'TikTok hat die Verarbeitung nicht innerhalb von 8 Minuten abgeschlossen.',
      'media_processing',
      true,
    );
  }

  async verify(externalPostId: string): Promise<VerifyOutput> {
    const res = await httpJson(`${API}/video/query/?fields=id,share_url,create_time`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ filters: { video_ids: [externalPostId] } }),
    });
    const video = res?.data?.videos?.[0];
    return {
      exists: !!video,
      url: video?.share_url ?? null,
      publishedAt: video?.create_time ? new Date(video.create_time * 1000).toISOString() : null,
      detail: video ? 'Video bei TikTok gefunden.' : 'TikTok kennt diese Video-ID nicht.',
    };
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsOutput> {
    const fields = 'id,like_count,comment_count,share_count,view_count';
    const res = await httpJson(`${API}/video/query/?fields=${fields}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ filters: { video_ids: [externalPostId] } }),
    });
    const v = res?.data?.videos?.[0];
    if (!v) return { source: 'platform_api', metrics: {}, missing: [fields] };
    return {
      source: 'platform_api',
      metrics: {
        impressions: v.view_count ?? 0,
        reach: v.view_count ?? 0,
        likes: v.like_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
      },
      missing: ['saved', 'profile_visits', 'avg_watch_time'],
    };
  }
}
