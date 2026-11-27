export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
}

export class YouTubeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
  }
}

type YouTubeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
}

/**
 * Searches public, embeddable videos. The key is supplied by a server/Worker secret,
 * never by a browser request or a Vite-prefixed environment variable.
 */
export async function searchYouTubeVideos(
  apiKey: string | undefined,
  rawQuery: string,
  fetcher: YouTubeFetch = fetch
): Promise<YouTubeVideo[]> {
  const query = rawQuery.trim();
  if (!query) throw new YouTubeApiError('Enter a search term first.', 400);
  if (query.length > 120) throw new YouTubeApiError('Search terms must be 120 characters or fewer.', 400);
  if (!apiKey?.trim()) {
    throw new YouTubeApiError(
      'YouTube search is not configured. Add YOUTUBE_API_KEY to your local .env or Worker secrets.',
      503
    );
  }

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '12');
  url.searchParams.set('safeSearch', 'moderate');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('key', apiKey.trim());

  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new YouTubeApiError('Could not reach YouTube. Check the server connection and try again.', 502);
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new YouTubeApiError(
        'YouTube API access was denied. Check that YouTube Data API v3 is enabled, the API key is valid, and project quota is available.',
        502
      );
    }
    throw new YouTubeApiError('YouTube returned an error (' + response.status + '). Please try again.', 502);
  }

  let payload: YouTubeSearchResponse;
  try {
    payload = (await response.json()) as YouTubeSearchResponse;
  } catch {
    throw new YouTubeApiError('YouTube returned an unreadable response.', 502);
  }

  return (payload.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId ?? '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return [];
    const snippet = item.snippet ?? {};
    const candidateThumbnail =
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url ??
      '';
    const thumbnailUrl = candidateThumbnail.startsWith('https://i.ytimg.com/')
      ? candidateThumbnail
      : '';

    return [{
      videoId,
      title: String(snippet.title ?? 'Untitled video').slice(0, 180),
      description: String(snippet.description ?? '').slice(0, 500),
      channelTitle: String(snippet.channelTitle ?? '').slice(0, 120),
      publishedAt: String(snippet.publishedAt ?? ''),
      thumbnailUrl,
    }];
  });
}
