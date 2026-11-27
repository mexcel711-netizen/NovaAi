# ZARA AI

A bilingual Pakistani Urdu, Roman Urdu and English AI voice assistant built with React, TypeScript, Cloudflare Workers AI and D1.

## Production architecture
- Cloudflare Worker serves the Vite SPA and API routes.
- Cloudflare D1 stores conversations, memories, skills, notes, reminders, app configuration, living characters and the study library.
- Workers AI is the production AI provider through the `AI` binding, with Gemma as the primary conversational model and Llama fallbacks. If `GEMINI_API_KEY` is configured, Gemini can be selected or used as an additional fallback for chat, study/vision analysis and transcription.
- Chat uses the active character, saved memories, notes, reminders and study-library summaries as context. Provider failures trigger model/provider failover before the API returns a recoverable unavailable response.
- Production access is restricted by the Cloudflare Access policy. Keep its allow rule limited to trusted identities.
- The local Express/SQLite runtime and production Worker/D1 runtime share the browser API contract. The Worker-specific route handlers live in `worker/features.ts`.

## Database migrations and deployment
Apply database migrations **before deploying Worker code that depends on a new table or column**. The migration files are ordered and safe to re-run; they do not delete existing user data.

```bash
bun install --frozen-lockfile
bun run db:check
bun run db:migrate
bun run lint
bun run test
bun run build
bun run deploy
```

`bun run db:migrate` targets the configured remote D1 database `nova-ai-production`; only run it while authenticated to the intended Cloudflare account. GitHub Actions validates migration SQL against an in-memory SQLite database, then runs type checks, tests and the production build. It does not change the live D1 database.

## Local development
- Copy .env.example to .env; add GEMINI_API_KEY for Google AI Studio and YOUTUBE_API_KEY for YouTube search.
- Run bun install then bun run dev.

## YouTube Data API integration
The Home screen's **YouTube** hub tab searches public videos through the YouTube Data API v3 and embeds the selected result. Voice commands such as "YouTube search for Python tutorials", "youtube par Python tutorials search karo", or "یوٹیوب پر Python tutorials تلاش کرو" open the same in-app search panel.

### Create and configure the YouTube API key
1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. In **APIs & Services → Library**, find **YouTube Data API v3** and enable it.
3. In **APIs & Services → Credentials**, create an API key. Restrict the key to **YouTube Data API v3** and keep it private.
4. For local development, put the key in your uncommitted .env file as YOUTUBE_API_KEY=your-key.
5. For the deployed Worker, run **bunx wrangler secret put YOUTUBE_API_KEY** from the repository root and enter the key in Wrangler's prompt. This secret is not stored in Git. Setting a Worker secret publishes a new deployment.
6. Gemini is already implemented. Set GEMINI_API_KEY locally for Express, or run **bunx wrangler secret put GEMINI_API_KEY** for the deployed Worker when you are ready to enable Google AI Studio.

The API key is read only by the server/Worker. The browser calls the same-origin /api/youtube/search endpoint and never receives the key.
- The local Express server uses Node SQLite; production uses Cloudflare D1.

## Security and privacy
- Production is behind Cloudflare Access; keep the allow policy limited to trusted email identities.
- The current deployment is a single-user assistant, not a multi-tenant service.
- Never commit API keys, `.env` files, local SQLite databases, or Wrangler state.


## ZARA AI holographic command centre and desktop companion
The Home screen includes a holographic command-centre layout and an optional local Desktop Bridge panel.

### Windows desktop install and automatic startup
1. Open Settings → Laptop & Installer and download Windows Installer (.bat).
2. Run the installer on the Windows laptop. It installs the companion under the current user's Local AppData folder and creates a ZARA AI desktop shortcut.
3. When asked, choose whether ZARA and its companion should start automatically when that Windows user signs in. The installer generates a private pairing token for this PC, so the browser does not need a manual token copy.
4. The desktop shortcut opens ZARA in its app window. The startup URL carries the local pairing token only in its URL fragment; the app stores it in local browser storage and removes the fragment from the address bar.
5. With ?autostart=1, ZARA greets the saved nickname with a spoken "Hello Boss" welcome. Automatic audio still depends on the installed browser's playback and permission settings.

The Windows installer requires Node.js 18+ and Microsoft Edge for the preferred app-window experience (the system's default browser is used if Edge is not found). The local companion binds to loopback only, checks the ZARA origin and a random per-install pairing token, and exposes only explicit app-launch, known-folder, file-list/read, and system-information actions. It does not expose arbitrary shell or administrator access.

For manual development, start the companion from the repository root with bun run desktop:companion, then paste the one-time token into the Desktop Bridge panel. See desktop-companion/README.md for details.

### Login and access boundary
The in-app first-run setup wizard has been removed; the assistant opens directly into its workspace. The production deployment's Cloudflare Access identity gate is separate from this repository's UI and remains enabled. Keep it restricted to trusted identities: removing that external gate would expose the single-user assistant's chat history, memories, notes, and reminders to anyone who can reach the deployment.

### Pakistani Urdu neural female voice
ZARA uses one fixed Microsoft Edge neural speaker, `ur-PK-UzmaNeural`, for Urdu, Roman Urdu and English. Character, mood, language and device settings do not switch the speaker. The local Node server and Cloudflare Worker use the same Sec-MS-GEC v2 Read Aloud handshake. Browser SpeechSynthesis and the old Google Translate TTS fallback are disabled so a provider failure never silently changes the voice. If synthesis is temporarily unavailable, the written reply remains visible and ZARA retries the same fixed voice once. The app unlocks Web Audio on the first user gesture so delayed TTS responses can play under browser autoplay policies.
