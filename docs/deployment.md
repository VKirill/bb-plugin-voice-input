---
title: Deployment
type: deployment
created: 2026-10-01
updated: 2026-10-01
status: active
confidence: medium
tags: [deployment, installation, build]
sources:
  - package.json
  - server.ts
  - host.ts
  - app.tsx
  - src/setup.ts
  - src/download.ts
  - src/secret-store.ts
  - src/frontend/global-voice-session.ts
  - python/download.py
  - src/paths.ts
  - scripts/embed-assets.mjs
  - skills/voice-input/SKILL.md
---
# Deployment

TL;DR: Install package dependencies, build the BB plugin bundle, install the local plugin, select `local-voice` for the BB voice service, and set up a local engine on its recognition host (`package.json:31-36`, `server.ts:534-558`).

## Prerequisites

- Node.js/npm and a BB runtime meeting the package engine requirements (`package.json:6-10`).
- For local Whisper or GigaAM: Python 3 and `ffmpeg` on the recognition host (`src/setup.ts:54-60`, `src/setup.ts:79-97`). The engine requirement comment identifies MLX Whisper as Apple Silicon-only, while UI support checks only whether the host platform is Darwin (`src/paths.ts:24-29`, `server.ts:802-808`).
- For cloud engines: a provider API key entered in plugin settings or made available through a configured environment variable on the recognition host (`host.ts:96-101`, `host.ts:293-321`).

## Deploy procedure

1. Install locked JavaScript dependencies:

   ```sh
   npm ci
   ```

2. Build the plugin. `npm run build` first embeds `python/*.py`, then calls `bb plugin build` (`package.json:31-36`, `scripts/embed-assets.mjs:8-29`):

   ```sh
   npm run build
   ```

3. Install this package into BB and select its registered voice service (`package.json:9-20`, `server.ts:534-558`; see [Overview](overview.md) and [API](api.md)):

   ```sh
   bb plugin install .
   bb settings ai-services set voice local-voice
   ```

4. For local recognition, install the selected engine on the configured recognition machine and inspect readiness (`server.ts:560-590`, `src/setup.ts:62-123`):

   ```sh
   bb voice-input setup
   bb voice-input status
   ```

   `setup` installs Python packages into an engine-specific virtual environment. The model is downloaded on first transcription or by the separate download command (`src/setup.ts:99-123`, `src/download.ts:15-31`).

5. Configure engine, recognition machine, provider endpoints, keys, language, vocabulary, cleanup, retention, and hotkey in the plugin settings page. Ordinary settings are server-side; API keys are stored on the recognition host (`server.ts:160-169`, `server.ts:474-493`, `src/secret-store.ts:36-53`).

## Build and maintenance commands

The project scripts define the following checks (`package.json:31-36`):

```sh
npm run typecheck
npm test
npm run build
```

`npm run embed` regenerates `src/embedded-assets.generated.ts` after edits to the embedded Python assets (`package.json:31-36`, `scripts/embed-assets.mjs:8-29`).

## Verify

1. Run `bb voice-input status` and confirm Python/ffmpeg and the desired engine are reported ready (`server.ts:610-629`).
2. In BB, open the Voice Input plugin page and confirm it loads host, engine, and settings state (`app.tsx:448-469`, `server.ts:353-419`).
3. Select `local-voice` as BB's voice service and submit a short browser recording (`skills/voice-input/SKILL.md:10-21`, `server.ts:534-558`).
4. Confirm the transcript appears in the originating BB draft and inspect history with `bb voice-input history 5` (`src/frontend/global-voice-session.ts:511-565`, `server.ts:712-730`).

## Rollback

1. Select the previous BB voice service ID with `bb settings ai-services set voice <previous-service-id>`; the previous service ID is specific to the host configuration (`skills/voice-input/SKILL.md:10-21`).
2. Reinstall the previous plugin checkout with its existing `bb plugin install <path>` procedure. This repository defines no version-pinning or uninstall script (`package.json:31-36`).
3. Keep the plugin host data directory until recordings/history or keys have been intentionally migrated; its files are separate from the installed bundle (`src/paths.ts:8-21`).

## Troubleshooting

| Symptom | Check and response | Evidence |
|---|---|---|
| Local engine setup says Python is missing | Install Python 3 on the recognition host, then repeat `bb voice-input setup`. | `src/setup.ts:79-85` |
| Local engine setup says ffmpeg is missing | Install `ffmpeg` on the recognition host, then repeat setup. | `src/setup.ts:89-96` |
| Cloud engine reports `needs-key` | Add a manual key, link an Env Catalog entry, or set the configured environment variable on the recognition host. | `src/setup.ts:129-153`, `host.ts:293-321` |
| Model download has no percentage | GigaAM reports unknown byte totals; Whisper progress can also lack a repository total. | `python/download.py:105-123`, `python/download.py:94-103` |
| Recognition timeout | The plugin host RPC timeout is 10 minutes for transcription; the browser fallback request has a 60-second abort. | `server.ts:31-37`, `src/frontend/global-voice-session.ts:390-410` |

<!-- lane-pilot:backlinks -->
## Referenced by

- [BB Voice Input — Overview](overview.md)
