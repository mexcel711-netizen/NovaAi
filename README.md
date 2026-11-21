# NOVA AI

A bilingual Pakistani Urdu, Roman Urdu and English AI voice assistant built with React, TypeScript, Cloudflare Workers AI and D1.

## Production architecture
- Cloudflare Worker serves the Vite SPA and API routes.
- Cloudflare D1 stores conversations, memories, skills, notes, reminders and app configuration.
- Workers AI is the default inference provider through the `AI` binding.
- Optional `GEMINI_API_KEY` enables Gemini chat routing and audio transcription.
- The Worker is protected by Cloudflare Access. Sign-in is restricted to the account owner's email policy.

## Deployment
Cloudflare Workers Builds is connected to this GitHub repository and deploys from `main`. Each relevant push runs:
1. `bun install --frozen-lockfile`
2. TypeScript checks, unit tests and Vite production build
3. Idempotent remote D1 migration
4. `bunx wrangler deploy`

For a manual deploy:
```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run db:migrate
bun run deploy
```

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
