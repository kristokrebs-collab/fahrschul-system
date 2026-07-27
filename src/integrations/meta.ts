/**
 * Instagram und Facebook ueber die offizielle Meta Graph API.
 *
 * Instagram-Veroeffentlichung ist zweistufig:
 *   1. Container anlegen (`POST /{ig-user-id}/media`)
 *   2. Bei Video/Reel warten, bis der Container FINISHED ist
 *   3. Container veroeffentlichen (`POST /{ig-user-id}/media_publish`)
 *
 * Schritt 2 ist der haeufigste Grund fuer "es hat nicht geklappt": Meta
 * verarbeitet Videos asynchron und liefert IN_PROGRESS oder ERROR. Der
 * Adapter wartet begrenzt und meldet den echten Statuscode zurueck, statt
 * blind weiterzumachen.
 *
 * Voraussetzung: Instagram-Professional-Konto, verknuepfte Facebook-Seite und
 * ein Token mit instagram_basic, instagram_content_publish,
 * instagram_manage_insights, pages_read_engagement.
 */
import { config } from '../config/env.js';
import { log } from '../observability/logger.js';
import {
  PublishAdapter,
  PublishInput,
  PublishOutput,
  VerifyOutput,
  MetricsOutput,
  IntegrationError,
  httpJson,
} from './types.js';

function graphUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://graph.facebook.com/${config.meta.graphVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function requireToken(): string {
  if (!config.meta.accessToken) {
    throw new IntegrationError(
      'META_ACCESS_TOKEN ist nicht gesetzt. Ohne Token kann nichts auf Instagram oder Facebook ' +
        'veroeffentlicht werden. Token in der .env hinterlegen und den Dienst neu starten.',
      'missing_credentials',
      false,
    );
  }
  return config.meta.accessToken;
}

function captionFor(item: PublishInput['item']): string {
  const tags = JSON.parse(item.hashtags_json || '[]') as string[];
  return [item.caption, tags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
}

/** Erste oeffentlich erreichbare Medien-URL. Meta laedt die Datei selbst. */
function mediaUrl(input: PublishInput): string {
  const asset = input.assets[0];
  if (!asset) {
    throw new IntegrationError('Kein Medium am Beitrag hinterlegt.', 'validation', false);
  }
  if (!asset.url || !asset.url.startsWith('https://')) {
    throw new IntegrationError(
      `Asset ${asset.id} hat keine oeffentlich erreichbare HTTPS-URL. Meta laedt die Datei selbst ` +
        'von der angegebenen Adresse - eine lokale Datei ist fuer die Graph API nicht erreichbar.',
      'validation',
      false,
    );
  }
  return asset.url;
}

const VIDEO_FORMATS = ['reel', 'video', 'story'];

export class InstagramAdapter implements PublishAdapter {
  readonly platform = 'instagram';
  readonly isPublic = true;

  isConfigured(): boolean {
    return !!config.meta.accessToken && !!config.meta.igBusinessAccountId;
  }

  async checkConnection() {
    if (!this.isConfigured()) {
      return {
        ok: false,
        detail:
          'Nicht konfiguriert: META_ACCESS_TOKEN und/oder INSTAGRAM_BUSINESS_ACCOUNT_ID fehlen.',
        expiresAt: null,
      };
    }
    const token = requireToken();
    const me = await httpJson(
      graphUrl(config.meta.igBusinessAccountId!, {
        fields: 'id,username,name,followers_count',
        access_token: token,
      }),
    );
    // Ablaufdatum des Tokens ermitteln, damit wir vorher warnen koennen.
    let expiresAt: string | null = null;
    try {
      const debug = await httpJson(
        graphUrl('debug_token', { input_token: token, access_token: token }),
      );
      const exp = debug?.data?.expires_at;
      if (exp && exp > 0) expiresAt = new Date(exp * 1000).toISOString();
    } catch {
      // debug_token braucht ggf. ein App-Token. Kein Grund, die Pruefung scheitern zu lassen.
    }
    return {
      ok: true,
      detail: `Verbunden mit @${me.username} (${me.followers_count ?? '?'} Follower).`,
      expiresAt,
    };
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    const token = requireToken();
    const igUser = config.meta.igBusinessAccountId;
    if (!igUser) {
      throw new IntegrationError(
        'INSTAGRAM_BUSINESS_ACCOUNT_ID ist nicht gesetzt.',
        'missing_credentials',
        false,
      );
    }

    const isVideo = VIDEO_FORMATS.includes(input.item.format);
    const isCarousel = input.item.format === 'carousel';
    const caption = captionFor(input.item);

    let creationId: string;

    if (isCarousel) {
      if (input.assets.length < 2) {
        throw new IntegrationError(
          'Eine Bildstrecke braucht mindestens zwei Medien.',
          'validation',
          false,
        );
      }
      // Kinder-Container anlegen, dann den Sammelcontainer.
      const childIds: string[] = [];
      for (const asset of input.assets.slice(0, 10)) {
        if (!asset.url) {
          throw new IntegrationError(`Asset ${asset.id} hat keine URL.`, 'validation', false);
        }
        const child = await httpJson(graphUrl(`${igUser}/media`), {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            [asset.kind === 'video' ? 'video_url' : 'image_url']: asset.url,
            is_carousel_item: 'true',
            ...(asset.kind === 'video' ? { media_type: 'VIDEO' } : {}),
            access_token: token,
          }),
        });
        childIds.push(child.id);
      }
      const container = await httpJson(graphUrl(`${igUser}/media`), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          caption,
          access_token: token,
        }),
      });
      creationId = container.id;
    } else {
      const params = new URLSearchParams({ caption, access_token: token });
      if (isVideo) {
        params.set('media_type', input.item.format === 'reel' ? 'REELS' : 'VIDEO');
        params.set('video_url', mediaUrl(input));
        if (input.item.cover_concept) {
          // Cover-Zeitpunkt in ms; ohne eigenes Coverbild nehmen wir Sekunde 1.
          params.set('thumb_offset', '1000');
        }
      } else {
        params.set('image_url', mediaUrl(input));
      }
      const container = await httpJson(graphUrl(`${igUser}/media`), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      creationId = container.id;
    }

    if (isVideo || isCarousel) {
      await this.waitForContainer(creationId, token);
    }

    const published = await httpJson(graphUrl(`${igUser}/media_publish`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    });

    const detail = await httpJson(
      graphUrl(published.id, { fields: 'permalink,timestamp', access_token: token }),
    ).catch(() => null);

    return {
      externalPostId: published.id,
      externalUrl: detail?.permalink ?? null,
      raw: { creationId, publishedAt: detail?.timestamp ?? null },
    };
  }

  /**
   * Meta verarbeitet Videos asynchron. Ohne dieses Warten wuerde
   * media_publish mit einem irrefuehrenden Fehler abbrechen.
   */
  private async waitForContainer(creationId: string, token: string): Promise<void> {
    const deadline = Date.now() + 5 * 60_000;
    let delay = 3000;
    while (Date.now() < deadline) {
      const status = await httpJson(
        graphUrl(creationId, { fields: 'status_code,status', access_token: token }),
      );
      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR') {
        throw new IntegrationError(
          `Meta konnte das Medium nicht verarbeiten: ${status.status ?? 'ERROR'}. ` +
            'Haeufige Ursachen: falsches Seitenverhaeltnis, zu lange Laufzeit, nicht unterstuetzter Codec.',
          'media_processing',
          false,
        );
      }
      if (status.status_code === 'EXPIRED') {
        throw new IntegrationError(
          'Der Medien-Container ist abgelaufen, bevor veroeffentlicht wurde.',
          'media_processing',
          true,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 15_000);
    }
    throw new IntegrationError(
      'Meta hat das Medium nicht innerhalb von 5 Minuten fertig verarbeitet.',
      'media_processing',
      true,
    );
  }

  async verify(externalPostId: string): Promise<VerifyOutput> {
    const token = requireToken();
    try {
      const media = await httpJson(
        graphUrl(externalPostId, { fields: 'id,permalink,timestamp,media_type', access_token: token }),
      );
      return {
        exists: true,
        url: media.permalink ?? null,
        publishedAt: media.timestamp ?? null,
        detail: `Beitrag existiert bei Instagram (${media.media_type ?? 'unbekannter Typ'}).`,
      };
    } catch (err) {
      if (err instanceof IntegrationError && err.errorClass === 'validation') {
        return { exists: false, url: null, publishedAt: null, detail: err.message };
      }
      throw err;
    }
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsOutput> {
    const token = requireToken();
    // Metriknamen unterscheiden sich je nach Medientyp; wir fragen breit an
    // und behandeln Ablehnungen einzelner Metriken als "nicht verfuegbar".
    const wanted = [
      'reach',
      'impressions',
      'saved',
      'likes',
      'comments',
      'shares',
      'plays',
      'total_interactions',
      'profile_visits',
      'follows',
      'ig_reels_avg_watch_time',
      'ig_reels_video_view_total_time',
    ];
    const metrics: Record<string, number> = {};
    const missing: string[] = [];

    for (const metric of wanted) {
      try {
        const res = await httpJson(
          graphUrl(`${externalPostId}/insights`, { metric, access_token: token }),
        );
        const value = res?.data?.[0]?.values?.[0]?.value;
        if (typeof value === 'number') metrics[metric] = value;
        else missing.push(metric);
      } catch {
        missing.push(metric);
      }
    }
    if (Object.keys(metrics).length === 0) {
      log.warn('Instagram lieferte keine einzige Metrik.', { externalPostId });
    }
    return { source: 'platform_api', metrics, missing };
  }
}

export class FacebookAdapter implements PublishAdapter {
  readonly platform = 'facebook';
  readonly isPublic = true;

  isConfigured(): boolean {
    return !!config.meta.accessToken && !!config.meta.facebookPageId;
  }

  async checkConnection() {
    if (!this.isConfigured()) {
      return {
        ok: false,
        detail: 'Nicht konfiguriert: META_ACCESS_TOKEN und/oder FACEBOOK_PAGE_ID fehlen.',
        expiresAt: null,
      };
    }
    const page = await httpJson(
      graphUrl(config.meta.facebookPageId!, {
        fields: 'id,name,fan_count',
        access_token: requireToken(),
      }),
    );
    return { ok: true, detail: `Verbunden mit Seite "${page.name}".`, expiresAt: null };
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    const token = requireToken();
    const pageId = config.meta.facebookPageId;
    if (!pageId) {
      throw new IntegrationError('FACEBOOK_PAGE_ID ist nicht gesetzt.', 'missing_credentials', false);
    }
    const asset = input.assets[0];
    const message = captionFor(input.item);

    let endpoint: string;
    const params = new URLSearchParams({ access_token: token });

    if (asset?.kind === 'video') {
      endpoint = `${pageId}/videos`;
      params.set('file_url', mediaUrl(input));
      params.set('description', message);
    } else if (asset?.kind === 'image') {
      endpoint = `${pageId}/photos`;
      params.set('url', mediaUrl(input));
      params.set('caption', message);
    } else {
      endpoint = `${pageId}/feed`;
      params.set('message', message);
    }

    const res = await httpJson(graphUrl(endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const id = res.post_id ?? res.id;
    return {
      externalPostId: id,
      externalUrl: `https://www.facebook.com/${id}`,
      raw: res,
    };
  }

  async verify(externalPostId: string): Promise<VerifyOutput> {
    const token = requireToken();
    try {
      const post = await httpJson(
        graphUrl(externalPostId, { fields: 'id,created_time,permalink_url', access_token: token }),
      );
      return {
        exists: true,
        url: post.permalink_url ?? null,
        publishedAt: post.created_time ?? null,
        detail: 'Beitrag existiert auf der Facebook-Seite.',
      };
    } catch (err) {
      if (err instanceof IntegrationError && err.errorClass === 'validation') {
        return { exists: false, url: null, publishedAt: null, detail: err.message };
      }
      throw err;
    }
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsOutput> {
    const token = requireToken();
    const metrics: Record<string, number> = {};
    const missing: string[] = [];
    const wanted = [
      'post_impressions',
      'post_impressions_unique',
      'post_engaged_users',
      'post_clicks',
      'post_reactions_by_type_total',
      'post_video_views',
    ];
    for (const metric of wanted) {
      try {
        const res = await httpJson(
          graphUrl(`${externalPostId}/insights`, { metric, access_token: token }),
        );
        const value = res?.data?.[0]?.values?.[0]?.value;
        if (typeof value === 'number') metrics[metric] = value;
        else missing.push(metric);
      } catch {
        missing.push(metric);
      }
    }
    return { source: 'platform_api', metrics, missing };
  }
}
