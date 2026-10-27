---
title: BB Voice Input — Overview
type: overview
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: medium
tags: [voice-input, overview, bb-plugin]
sources:
  - package.json
  - server.ts
  - host.ts
  - app.tsx
  - src/contract.ts
  - src/frontend/global-voice-session.ts
  - src/frontend/words.ts
  - src/i18n/index.ts
  - src/settings-store.ts
  - src/paths.ts
  - python/voiced.py
  - python/download.py
  - scripts/embed-assets.mjs
---
# BB Voice Input — Overview

TL;DR: BB Voice Input is a BB plugin that records speech in the browser and sends it to a selected BB host for local or cloud transcription, optional text processing, and insertion into the composer (`server.ts:534-558`, `src/frontend/global-voice-session.ts:338-443`).

## What it is

The package registers a BB AI service named `local-voice`, a plugin settings page, and the `bb voice-input` CLI command group (`package.json:1-27`, `server.ts:534-591`). The browser owns microphone capture and draft insertion; transcription runs on the selected host through the host contract (`src/frontend/global-voice-session.ts:212-260`, `src/contract.ts:89-210`). The interface has eight dictionaries, follows BB's document language in `auto` mode, and resolves regional language codes to their base language (`src/i18n/index.ts:13-35`, `src/frontend/words.ts:7-10`).

Transcription engines are local Whisper and GigaAM, or cloud Groq, OpenAI, and Google. Local engines use isolated Python virtual environments on the recognition host. Cloud engines send audio to the selected provider (`src/paths.ts:24-38`, `host.ts:278-351`). Vocabulary prompting, deterministic cleanup, and an optional constrained AI pass run in the host transcription pipeline (`host.ts:192-229`, `host.ts:273-275`).

## Stack

- TypeScript with Node.js APIs; the package is an ES module (`package.json:1-5`).
- BB Plugin SDK `0.4.87` (`package.json:22-28`).
- Zod `^4.6.7` for RPC and settings validation (`package.json:22-28`).
- React UI and Radix components; TypeScript `^5.7.0` is a development dependency (`package.json:22-40`).
- Python transcription workers: `mlx-whisper` or GigaAM with Torch for local engines (`src/paths.ts:24-38`).

## Main parts

| Part | Responsibility |
|---|---|
| `server.ts` | Registers the settings RPC, CLI commands, AI service, and pushes settings to connected recognition hosts (`server.ts:353-558`, `server.ts:560-738`). |
| `host.ts` | Handles provider keys, settings files, engine setup/status, transcription, history, and model operations (`host.ts:432-629`). |
| `app.tsx` and `src/frontend/` | Render settings and manage microphone triggers, global recording state, and composer insertion (`app.tsx:431-519`, `src/frontend/global-voice-session.ts:105-164`). |
| `src/` | Defines shared contracts, provider calls, settings normalization, cleanup, vocabulary repair, secrets, and model storage (`src/contract.ts:8-228`, `src/settings-store.ts:12-143`). |
| `python/` | Runs local models in a socket-based daemon and downloads model assets (`python/voiced.py:1-9`, `python/download.py:1-9`). |
| `scripts/embed-assets.mjs` | Embeds Python files into a generated TypeScript asset module before plugin build (`scripts/embed-assets.mjs:1-29`). |

## Quick start

The package scripts and CLI expose the build, checks, installation, and local-engine setup commands (`package.json:31-36`, `server.ts:560-590`). Full host prerequisites and deployment steps live in [Deployment](deployment.md).

```sh
npm ci
npm run build
bb plugin install .
bb settings ai-services set voice local-voice
bb voice-input setup
```

## Where to look next

- System boundaries and call paths: [Architecture](architecture.md).
- User-visible behavior: [Dictation](features/dictation.md), [Transcription](features/transcription.md), and [Settings and engine management](features/settings-and-engine-management.md).
- BB RPC, host RPC, and CLI contract: [API](api.md).
- Persisted files and browser drafts: [Data model](data-model.md).
- Installation and configuration: [Deployment](deployment.md).
- Sharp edges: [Gotchas](gotchas.md).
- Code facts for agents: [PROJECT.md](../PROJECT.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Deployment](deployment.md)
