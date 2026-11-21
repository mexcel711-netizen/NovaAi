# NOVA AI

A bilingual Pakistani Urdu, Roman Urdu and English AI voice assistant built with React, TypeScript, Cloudflare Workers AI and D1.

## Production architecture
- Cloudflare Worker serves the Vite SPA and API routes.
- Cloudflare D1 stores conversations, memories, skills, notes, reminders, app configuration, living characters and the study library.
- Workers AI is available through the `AI` binding. Optional `GEMINI_API_KEY` enables Gemini-backed chat, document analysis, camera vision and audio transcription.
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
- Copy `.env.example` to `.env` and add `GEMINI_API_KEY` if you want to use Gemini locally.
- Run `bun install` then `bun run dev`.
- The local Express server uses Node SQLite; production uses Cloudflare D1.

## Security and privacy
- Production is behind Cloudflare Access; keep the allow policy limited to trusted email identities.
- The current deployment is a single-user assistant, not a multi-tenant service.
- Never commit API keys, `.env` files, local SQLite databases, or Wrangler state.


## NOVA holographic command centre and desktop companion
The Home screen includes a holographic command-centre layout and an optional local Desktop Bridge panel.

### Windows desktop actions
1. Start the local companion from the repository root: `bun run desktop:companion`.
2. Copy the one-time pairing token printed in the terminal into NOVA's **Desktop Bridge** panel and press **Pair**.
3. Use the panel buttons or say/type commands such as `Chrome kholo`, `Edge kholo`, `Notepad kholo`, or `Calculator kholo`.

The companion is an optional local Node.js process. It binds to loopback only, checks the NOVA origin and pairing token, and only launches the small allowlist of applications. See [desktop-companion/README.md](desktop-companion/README.md) for setup and security details.

### Pakistani Urdu neural female voice
When the desktop companion is paired, NOVA uses Microsoft Edge neural TTS with `ur-PK-UzmaNeural` for Urdu and `en-US-JennyNeural` for English. The synthesis service is internet-backed. Without the companion, the existing hosted TTS fallback is used. Voice quality and accent should be tested on the target device.
