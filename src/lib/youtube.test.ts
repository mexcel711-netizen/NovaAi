import test from 'node:test';
import assert from 'node:assert/strict';
import { searchYouTubeVideos, YouTubeApiError } from './youtube';

test('YouTube search rejects empty queries and missing server-side API keys', async () => {
  await assert.rejects(
    () => searchYouTubeVideos('test-key', '   '),
    (error: unknown) => error instanceof YouTubeApiError && error.status === 400
  );
  await assert.rejects(
    () => searchYouTubeVideos(undefined, 'cats'),
    (error: unknown) => error instanceof YouTubeApiError && error.status === 503
  );
});

test('YouTube search calls the Data API and returns only safe, embeddable video fields', async () => {
  let requestedUrl = '';
  const videos = await searchYouTubeVideos('server-secret', '  Urdu programming  ', async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      items: [{
        id: { videoId: 'abcdefghijk' },
        snippet: {
          title: 'Urdu programming course',
          description: 'Learn to code.',
          channelTitle: 'Example channel',
          publishedAt: '2026-11-01T00:00:00Z',
          thumbnails: { high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' } },
        },
      }, {
        id: { videoId: 'not-a-valid-id' },
        snippet: { title: 'Invalid video' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const url = new URL(requestedUrl);
  assert.equal(url.origin, 'https://www.googleapis.com');
  assert.equal(url.pathname, '/youtube/v3/search');
  assert.equal(url.searchParams.get('q'), 'Urdu programming');
  assert.equal(url.searchParams.get('type'), 'video');
  assert.equal(url.searchParams.get('videoEmbeddable'), 'true');
  assert.equal(url.searchParams.get('key'), 'server-secret');
  assert.equal(videos.length, 1);
  assert.equal(videos[0].videoId, 'abcdefghijk');
  assert.equal(videos[0].thumbnailUrl, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
});

test('YouTube API permission or quota failures return a safe actionable message', async () => {
  await assert.rejects(
    () => searchYouTubeVideos('test-key', 'music', async () => new Response('{}', { status: 403 })),
    (error: unknown) => error instanceof YouTubeApiError && error.status === 502 && error.message.includes('quota')
  );
});
