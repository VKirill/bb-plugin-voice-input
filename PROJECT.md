---
title: BB Voice Input — Project Facts
updated: 2026-10-01
sources:
  - package.json
  - README.md
  - server.ts
  - host.ts
  - app.tsx
  - src/contract.ts
  - src/settings-store.ts
  - src/paths.ts
  - src/secret-store.ts
  - src/setup.ts
  - src/frontend/voice-interceptor.ts
  - src/frontend/global-voice-session.ts
  - python/voiced.py
  - scripts/embed-assets.mjs
  - docs/architecture.md
  - docs/gotchas.md
---
# BB Voice Input — Project Facts

## Identity

- BB plugin package `bb-plugin-voice-input`, version `0.2.8` (`package.json:1-5`).
- Registers the `local-voice` AI service, plugin page, and `voice-input` CLI group (`package.json:17-27`, `server.ts:534-591`).
- Recognition engines: local Whisper/GigaAM; cloud Groq/OpenAI/Google (`src/contract.ts:8-9`).

## Entry points

- Plugin server: `server.ts`; registers settings RPC, AI service, CLI (`server.ts:353-591`).
- Host entry: `host.ts`; handles management RPC and voice transcription (`host.ts:432-557`).
- Settings page: `app.tsx`; uses `rpcContract` (`app.tsx:431-469`).
- Browser dictation: `src/frontend/voice-interceptor.ts`, `src/frontend/global-voice-session.ts` (`src/frontend/voice-interceptor.ts:187-249`, `src/frontend/global-voice-session.ts:105-164`).
- Local daemon: `python/voiced.py`; JSON-line requests over per-engine Unix sockets (`python/voiced.py:1-9`, `src/paths.ts:15-18`).

## Critical invariants

- User settings are stored in BB plugin KV; host configuration and secrets are separate files (`server.ts:160-169`, `src/paths.ts:8-21`).
- API key values are excluded from server-pushed config and stored on the recognition host with mode `0600` (`server.ts:194-230`, `src/secret-store.ts:36-53`).
- Config changes stop local daemons no longer matching the selected engine/model (`host.ts:465-481`).
- Transcription output is vocabulary-repaired, cleaned, optionally guarded after an AI pass, then recorded in JSONL history (`host.ts:192-229`, `host.ts:363-384`).
- Details and rationale: [Architecture](docs/architecture.md), [Data model](docs/data-model.md).

## Conventions

- Shared contracts and settings validation live in `src/contract.ts` and `src/settings-store.ts` (`src/contract.ts:8-210`, `src/settings-store.ts:20-143`).
- Python assets are embedded by `scripts/embed-assets.mjs` before `bb plugin build` (`package.json:31-36`, `scripts/embed-assets.mjs:8-29`).
- Keep API keys out of settings RPC responses; expose configured flags only (`server.ts:410-416`, `src/contract.ts:81-86`).
- Project docs are in `docs/`; feature behavior belongs in the relevant `docs/features/` page.

## Common gotchas

- Local setup requires Python 3 and ffmpeg on the recognition host (`src/setup.ts:79-97`).
- Browser fallback times out at 60 seconds; server-to-host transcription timeout is 10 minutes (`src/frontend/global-voice-session.ts:390-410`, `server.ts:31-37`).
- Recording cleanup does not prune JSONL history (`host.ts:176-190`, `host.ts:527-544`).
- More: [Gotchas](docs/gotchas.md).

## Useful commands

| Command | Purpose |
|---|---|
| `npm ci` | Install locked package dependencies. |
| `npm run build` | Embed Python assets and build BB plugin bundles (`package.json:31-36`). |
| `npm run typecheck` | Run TypeScript compiler without emitting output (`package.json:31-36`). |
| `npm test` | Run `node --test tests/*.test.ts` (`package.json:31-36`). |
| `bb plugin install .` | Install this checkout in BB (`README.md:7-15`). |
| `bb voice-input status` | Inspect recognition host and engine state (`server.ts:610-629`). |
| `bb voice-input setup` | Set up the configured engine (`server.ts:632-645`). |
| `bb voice-input history 5` | Read recent successful transcriptions (`server.ts:712-730`). |

## Where to look next

- [Overview](docs/overview.md) — product shape and package parts.
- [Architecture](docs/architecture.md) — component boundaries and runtime paths.
- [Dictation](docs/features/dictation.md) — browser recording and draft insertion.
- [Transcription](docs/features/transcription.md) — providers and text pipeline.
- [Settings and engine management](docs/features/settings-and-engine-management.md) — configuration, keys, and model operations.
- [API and commands](docs/api.md) — plugin RPC, host RPC, AI service, and CLI.
- [Data model](docs/data-model.md) — persistent records and retention.
- [Deployment](docs/deployment.md) — install and operation procedure.
