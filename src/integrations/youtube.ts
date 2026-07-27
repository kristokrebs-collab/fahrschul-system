/**
 * YouTube Shorts ueber die Data API v3.
 *
 * Anders als Meta und TikTok laedt YouTube die Datei nicht selbst von einer
 * URL. Der Adapter holt das Medium daher ab und schiebt es ueber einen
 * resumable Upload hoch. Das ist der einzige unterstuetzte Weg.
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

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

function token(): string {
  if (!config.youtube.accessToken) {
    throw new IntegrationError(
      'YOUTUBE_ACCESS_TOKEN ist nicht gesetzt. Ohne Token kann nichts auf YouTube veroeffentlicht werden.',
      'missing_credentials',
      false,
    );
  }
  return config.youtube.accessToken;
}

export class YouTubeAdapter implements PublishAdapter {
  readonly platform = 'youtube';
  readonly isPublic = true;

  isConfigured(): boolean {
    return !!config.youtube.accessToken;
  }

  async checkConnection() {
    if (!this.isConfigured()) {
      return { ok: false, detail: 'Nicht konfiguriert: YOUTUBE_ACCESS_TOKEN fehlt.', expiresAt: null };
    }
    const res = await httpJson(`${API}/channels?part=snippet,statistics&mine=true`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const ch = res?.items?.[0];
    return {
      ok: !!ch,
      detail: ch
        ? `Verbunden mit Kanal "${ch.snippet.title}" (${ch.statistics?.subscriberCount ?? '?'} Abonnenten).`
        : 'Token gueltig, aber kein Kanal zugeordnet.',
      expiresAt: null,
    };
  }

  async publish(input: PublishInput): Promise<PublishOutput> {
    const asset = input.assets[0];
    if (!asset || asset.kind !== 'video') {
      throw new IntegrationError('YouTube akzeptiert hier nur Videos.', 'unsupported', false);
    }
    if (!asset.url?.startsWith('https://')) {
      throw new IntegrationError(
        `Asset ${asset.id} hat keine abrufbare HTTPS-URL.`,
        'validation',
        false,
      );
    }

    // 1. Medium abholen. YouTube laedt nicht selbst von einer URL.
    const mediaRes = await fetch(asset.url);
    if (!mediaRes.ok) {
      throw new IntegrationError(
        `Medium konnte nicht abgerufen werden (${mediaRes.status}).`,
        'network',
        true,
      );
    }
    const bytes = Buffer.from(await mediaRes.arrayBuffer());
    const contentType = mediaRes.headers.get('content-type') ?? 'video/mp4';

    const tags = (JSON.parse(input.item.hashtags_json || '[]') as string[]).map((t) =>
      t.replace(/^#/, ''),
    );
    const metadata = {
      snippet: {
        title: input.item.title.slice(0, 100),
        description: input.item.caption.slice(0, 5000),
        tags: tags.slice(0, 10),
        categoryId: '22',
        defaultLanguage: 'de',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    };

    // 2. Resumable-Session eroeffnen.
    const initRes = await fetch(
      `${UPLOAD}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token()}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': contentType,
          'x-upload-content-length': String(bytes.length),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new IntegrationError(
        `YouTube lehnte die Upload-Session ab (${initRes.status}): ${body.slice(0, 300)}`,
        initRes.status === 401 || initRes.status === 403 ? 'auth_expired' : 'validation',
        initRes.status >= 500,
      );
    }
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new IntegrationError('YouTube lieferte keine Upload-URL.', 'provider_error', true);
    }

    // 3. Bytes hochladen.
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
      body: bytes,
    });
    if (!putRes.ok) {
      const body = await putRes.text();
      throw new IntegrationError(
        `Upload fehlgeschlagen (${putRes.status}): ${body.slice(0, 300)}`,
        putRes.status >= 500 ? 'provider_error' : 'validation',
        putRes.status >= 500,
      );
    }
    const video = (await putRes.json()) as any;

    return {
      externalPostId: video.id,
      externalUrl: `https://www.youtube.com/shorts/${video.id}`,
      raw: { uploadStatus: video.status?.uploadStatus },
    };
  }

  async verify(externalPostId: string): Promise<VerifyOutput> {
    const res = await httpJson(`${API}/videos?part=snippet,status&id=${externalPostId}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const v = res?.items?.[0];
    return {
      exists: !!v,
      url: v ? `https://www.youtube.com/shorts/${v.id}` : null,
      publishedAt: v?.snippet?.publishedAt ?? null,
      detail: v
        ? `Video vorhanden, Status: ${v.status?.uploadStatus}/${v.status?.privacyStatus}.`
        : 'YouTube kennt diese Video-ID nicht.',
    };
  }

  async fetchMetrics(externalPostId: string): Promise<MetricsOutput> {
    const res = await httpJson(`${API}/videos?part=statistics&id=${externalPostId}`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    const s = res?.items?.[0]?.statistics;
    if (!s) return { source: 'platform_api', metrics: {}, missing: ['statistics'] };
    return {
      source: 'platform_api',
      metrics: {
        impressions: Number(s.viewCount ?? 0),
        reach: Number(s.viewCount ?? 0),
        likes: Number(s.likeCount ?? 0),
        comments: Number(s.commentCount ?? 0),
        saved: Number(s.favoriteCount ?? 0),
      },
      // Retention und Zuschauerbindung liegen in der YouTube Analytics API,
      // die eine eigene Autorisierung braucht. Ehrlich als fehlend gemeldet.
      missing: ['avg_watch_time', 'retention_curve', 'shares', 'profile_visits'],
    };
  }
}
