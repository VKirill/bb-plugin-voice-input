---
title: Settings and engine management
type: component
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: medium
tags: [settings, engines, models]
sources:
  - app.tsx
  - server.ts
  - src/settings-store.ts
  - src/contract.ts
  - src/setup.ts
  - src/paths.ts
  - host.ts
  - src/download.ts
  - src/model-store.ts
  - src/secret-store.ts
  - src/i18n/index.ts
  - src/frontend/words.ts
  - src/frontend/global-voice-session.ts
  - python/engines.py
---
# Settings and engine management

TL;DR: The settings page edits typed plugin settings, selects the recognition machine and provider keys, and invokes RPC methods for engine setup, model downloads, disk cleanup, and status refresh (`app.tsx:431-519`, `server.ts:353-512`).

## Purpose

The page groups settings under General, Dictation, Vocabulary, Cloud, and Data tabs (`app.tsx:69-79`). It also presents machine/engine status, setup and download actions, model files, recording count, and history-related configuration (`server.ts:49-99`, `app.tsx:431-519`).

## How it works

1. On mount, `VoiceInputSettings` requests page state, disk models, and available Env Catalog keys (`app.tsx:440-469`).
2. The server resolves the configured recognition host and combines host status, identity, config, secret-presence flags, and plugin settings in the `state` response (`server.ts:353-419`).
3. Editing a setting optimistically updates the page and calls `updateSettings`; the server writes keys separately, sanitizes ordinary settings, pushes config to connected hosts, and publishes `state-changed` (`app.tsx:482-501`, `server.ts:474-493`).
4. Engine setup, model download, and model deletion call their corresponding RPC operations and refresh state/models after completion (`app.tsx:504-519`, `server.ts:450-472`, `server.ts:495-503`).
5. Model progress arrives over realtime signals; page state is updated without polling while a download runs (`server.ts:189-192`, `app.tsx:471-480`).

### Settings page state and saves

`VoiceInputSettings` requests settings state, model inventory, and Env Catalog data on mount. A state response updates the page only if no save began and no newer refresh superseded it. Model-list failure clears the displayed list; catalog failure hides catalog choices. Saves optimistically merge a patch, serialize RPC calls through a promise queue, and publish changed hotkey configuration only after a successful save. Errors show a toast; the final pending save triggers a refresh. Realtime progress updates state without polling, and `state-changed` refreshes state and model inventory (`app.tsx:432-495`, `app.tsx:498-524`).

### Recognition machine listing

`listMachines` asks BB for hosts. A failure to list hosts returns an empty array; disconnected hosts are filtered out. For each connected host it requests identity, keeps the platform as `null` if that call fails, and derives `localEnginesPossible` from the platform. The result keeps host ID/name even when platform identification fails (`server.ts:782-808`, `server.ts:814-817`).

### Recording retention write

`keepRecording` creates a UTC-date directory and writes audio under a time plus random suffix. It returns the saved path on success; any directory/write error is swallowed and returns `null`, which makes the caller fall back to a temporary audio file (`host.ts:165-176`, `host.ts:408-417`).

## Modes

| Setting/action | Inputs and limits | Result | Evidence |
|---|---|---|---|
| Recognition engine | `whisper`, `gigaam`, `openai`, `google`, `groq`; local engines need Python 3 and ffmpeg, and source marks MLX Whisper as Apple Silicon-only (`src/contract.ts:8-9`, `src/setup.ts:70-97`, `src/paths.ts:24-29`). | Local engines install Python packages; cloud setup installs no packages, and GigaAM can fall back from MPS to CPU (`src/setup.ts:70-123`, `python/engines.py:85-108`). | `server.ts:386-399`, `server.ts:802-808` |
| Recognition machine | Empty means BB server host; otherwise a configured machine identifier/name (`src/settings-store.ts:24-30`). | The selected host gets config and performs recognition (`server.ts:238-255`, `server.ts:450-503`). | `server.ts:810-853` |
| Whisper model | One of the configured values in `WHISPER_MODELS`; default is the 4-bit large-v3 repository (`src/settings-store.ts:12-19`). | Model downloads to Hugging Face cache; the selected model is reported as active (`src/model-store.ts:10-18`, `host.ts:595-607`). | `src/settings-store.ts:12-19` |
| API key | Manual secret or Env Catalog link; host environment variable name is another setting (`server.ts:41-46`, `server.ts:474-490`). | Secret is stored on the recognition host; UI receives configured booleans and key source only (`host.ts:438-455`, `server.ts:410-416`). | `src/secret-store.ts:36-53` |
| `keepDays` | Integer from 0 to 3650 inclusive (`src/settings-store.ts:54-56`). | `0` disables pruning; positive values remove older dated recording directories after successful transcription (`host.ts:176-190`, `host.ts:374-384`). | `host.ts:176-190` |
| UI language | `auto` or one of eight language codes; `auto` follows the BB document language (`src/settings-store.ts:20-23`, `src/i18n/index.ts:13-33`). | Regional codes such as `pt-BR` resolve by their base code; unsupported codes use English. The browser loads the saved choice through `uiLanguage`, and recording requests carry the resolved language (`src/i18n/index.ts:29-35`, `src/frontend/words.ts:7-10`, `src/frontend/words.ts:36-51`, `src/frontend/global-voice-session.ts:35-41`). | `src/i18n/index.ts:13-35` |

### GigaAM execution modes and outcomes

`GigaamEngine` lazily loads the fixed `v3_e2e_rnnt` model. It prefers MPS when Torch reports it available and enables fp16 only there; any load failure on MPS retries on CPU, while a CPU load failure propagates. Transcription converts non-WAV input to 16 kHz mono WAV, then keeps short audio as one piece or splits longer audio at Silero VAD boundaries, with fixed 22-second chunks when VAD is unavailable and hard cuts for any overlong speech segment. Each chunk is transcribed and non-empty results are joined with spaces. A `RuntimeError` or `NotImplementedError` on MPS reloads the model on CPU and retries that chunk once; errors on CPU propagate. Temporary WAV pieces are removed in `finally`; ffmpeg conversion failure raises `EngineError` (`python/engines.py:67-108`, `python/engines.py:110-154`, `python/engines.py:156-192`, `python/engines.py:195-222`).

## Business rules

- Settings use per-field validation and merge with defaults, so one malformed or obsolete field does not erase other valid settings (`src/settings-store.ts:105-143`).
- `sanitizePatch` drops unknown keys, then rejects the entire patch if any accepted key has an invalid type/value (`src/settings-store.ts:133-143`).
- Writing a manual key clears that provider's catalog link; selecting a non-empty catalog key loads the value and stores it on the selected host (`server.ts:474-490`).
- Secret values are not included in the settings page `state` response; status is represented by booleans and an AI-pass key source (`server.ts:410-416`, `src/contract.ts:81-86`).
- Local engines are marked unsupported when the selected host platform does not support them; cloud engines remain supported (`server.ts:386-399`).
- Setup requires Python 3 and ffmpeg for local engines. The plugin searches known executable paths and then `which`; cloud setup returns ready without installing packages (`src/setup.ts:16-60`, `src/setup.ts:70-97`).
- Model deletion stops the engine daemon before removing the requested model and returning the freed byte count (`host.ts:616-620`).

## Public API

| RPC operation | File | Purpose |
|---|---|---|
| `state`, `catalogKeys`, `envKeys` | `server.ts:353-449` | Load settings, engine/host state, catalog key names, and environment variable names. |
| `setupEngine`, `downloadEngineModel`, `diskModels`, `deleteEngineModel` | `server.ts:450-472`, `server.ts:495-503` | Install engines, download/list/delete model assets. |
| `updateSettings` | `server.ts:474-493` | Save validated settings and synchronize host config/secrets. |

## Failures

- If no recognition host can be resolved, page state reports the resolution error, lists available machines, and omits engine status (`server.ts:353-378`).
- If Env Catalog is missing or unavailable, the catalog RPC catches the call failure and returns `available: false` with no names (`server.ts:427-439`).
- If the selected platform cannot run a local engine, the state marks that engine unsupported and includes the platform reason (`server.ts:386-399`).
- The local-engine UI support check tests only `platform === "darwin"`; the page's setup RPC does not repeat that check, while the source comment identifies MLX Whisper as Apple Silicon-only (`server.ts:386-399`, `server.ts:450-458`, `server.ts:802-808`, `src/paths.ts:24-29`).
- If Python or ffmpeg is missing, local setup returns `ready: false` with the missing prerequisite in `detail` (`src/setup.ts:79-97`).
- If a download or RPC call throws, the settings page shows an error toast; model download state also emits an error signal (`app.tsx:504-519`, `host.ts:568-593`).

## Gotchas

- A cloud engine can report `needs-key`; local engine readiness is based on Python package import, not on the presence of a downloaded model (`src/setup.ts:129-153`).
- Model caches are in the user's home directory, not under the plugin host data directory (`src/model-store.ts:9-18`).
- Settings are stored on the server but recognition runs on the selected host; secrets and runtime config have separate locations (`server.ts:160-175`, `server.ts:238-255`, `src/paths.ts:8-21`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](../architecture.md)
- [BB Voice Input — Overview](../overview.md)
