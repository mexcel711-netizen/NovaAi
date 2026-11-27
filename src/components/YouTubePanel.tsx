import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, Play, Search, Youtube } from 'lucide-react';
import type { YouTubeVideo } from '../lib/youtube';

interface YouTubePanelProps {
  requestedSearch?: { query: string; id: number } | null;
}

export function YouTubePanel({ requestedSearch }: YouTubePanelProps) {
  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async (rawQuery: string) => {
    const term = rawQuery.trim();
    if (!term) {
      setError('Enter a topic or video title to search.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/youtube/search?q=' + encodeURIComponent(term), {
        method: 'GET',
        cache: 'no-store',
      });
      const data = (await response.json()) as { items?: YouTubeVideo[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'YouTube search failed.');
      const results = Array.isArray(data.items) ? data.items : [];
      setVideos(results);
      setSelectedVideoId(results[0]?.videoId ?? '');
      if (results.length === 0) setError('No embeddable videos found for this search.');
    } catch (caught) {
      setVideos([]);
      setSelectedVideoId('');
      setError(caught instanceof Error ? caught.message : 'YouTube search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requestedSearch?.query) return;
    setQuery(requestedSearch.query);
    void search(requestedSearch.query);
  }, [requestedSearch?.id, requestedSearch?.query, search]);

  const selectedVideo = videos.find((video) => video.videoId === selectedVideoId);

  return (
    <section className="space-y-3" aria-label="YouTube video search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="sr-only" htmlFor="youtube-search-query">Search YouTube videos</label>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-[#081321] px-3">
          <Search className="h-4 w-4 shrink-0 text-cyan-300" />
          <input
            id="youtube-search-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={120}
            placeholder="Search videos, tutorials, music..."
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/90 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
          Search YouTube
        </button>
      </form>

      {error && (
        <p role="status" className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {error}
        </p>
      )}

      {selectedVideo && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
          <div className="aspect-video">
            <iframe
              className="h-full w-full"
              src={'https://www.youtube-nocookie.com/embed/' + selectedVideo.videoId}
              title={selectedVideo.title}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-white">{selectedVideo.title}</h4>
              <p className="mt-1 text-xs text-slate-400">{selectedVideo.channelTitle}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{selectedVideo.description}</p>
            </div>
            <a
              href={'https://www.youtube.com/watch?v=' + selectedVideo.videoId}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
            >
              Open YouTube <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div className="grid max-h-[330px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {videos.map((video) => (
            <button
              key={video.videoId}
              type="button"
              onClick={() => setSelectedVideoId(video.videoId)}
              aria-pressed={selectedVideoId === video.videoId}
              className={
                'flex min-w-0 gap-2 rounded-xl border p-2 text-left transition-colors ' +
                (selectedVideoId === video.videoId
                  ? 'border-cyan-400/60 bg-cyan-500/10'
                  : 'border-white/[0.08] bg-[#0A1322] hover:border-white/20')
              }
            >
              {video.thumbnailUrl ? (
                <img src={video.thumbnailUrl} alt="" loading="lazy" className="h-16 w-28 shrink-0 rounded-lg bg-black object-cover" />
              ) : (
                <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-black text-slate-500">
                  <Play className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0">
                <span className="line-clamp-2 block text-xs font-medium text-slate-100">{video.title}</span>
                <span className="mt-1 line-clamp-1 block text-[11px] text-slate-400">{video.channelTitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!loading && videos.length === 0 && !error && (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-slate-500">
          Search YouTube here, or ask your voice assistant: “YouTube search for Python tutorials”.
        </p>
      )}
    </section>
  );
}
