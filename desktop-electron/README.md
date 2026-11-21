# ZARA AI Desktop (Windows)

This is the native Electron desktop shell for the existing ZARA AI application. It keeps the current React/Cloudflare app and D1 data intact; the shell loads the hosted ZARA app and starts the existing loopback-only desktop companion automatically.

## Development

Requirements: Windows 10/11, Node.js 20+ and npm.

From the repository root:

```powershell
cd desktop-electron
npm install
npm start
```

The desktop shell opens `https://novaai.mexcel711.workers.dev`. If the app is protected by Cloudflare Access, sign in through the normal Access flow.

## Build a Windows installer

```powershell
cd desktop-electron
npm run dist:win
```

Installer output is written to `desktop-electron/release`.

To publish a GitHub Release that the built-in updater can use, set a GitHub token with release permissions in `GH_TOKEN`, then run:

```powershell
$env:GH_TOKEN = "YOUR_GITHUB_TOKEN"
npm run release:win
```

Do not commit the token. Automatic updates run only in packaged builds and check on startup, then every four hours. A downloaded update is installed after the user confirms a restart.

## Runtime behaviour

- One app instance; later launches focus the existing window.
- Main process writes `Documents/ZARA AI/logs/zara_main.log`.
- Bootstrap creates `Documents/ZARA AI/SOUL.md`, an empty `MEMORY.md` placeholder, and `media`, `exports`, and `logs` directories. Existing user files are never overwritten.
- The local desktop agent runs as an Electron utility process and binds only to `127.0.0.1:3210`.
- The renderer uses a context-isolated preload bridge. It receives only named desktop actions; no raw shell, arbitrary IPC, Node.js integration, or filesystem API is exposed to the webpage.
- Desktop actions are allowlisted by the existing companion and additionally gated to the trusted ZARA application origin.
- The existing web/PWA and Cloudflare Worker deployment remain available independently.

## Memory file

The `MEMORY.md` placeholder is deliberately empty. Attach your real MEMORY.md later and it can be imported into ZARA's existing memory system without inventing or overwriting personal memories.
