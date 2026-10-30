---
title: Settings and engine management
type: component
created: 2026-10-01
updated: 2026-10-30
status: active
confidence: medium
tags: [settings, engines, models]
sources:
  - app.tsx
  - server.ts
  - src/settings-store.ts
  - src/frontend/hotkey.ts
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

1. On mount, `VoiceInputSettings` requests page state, disk models, and available Env Catalog keys (`app.tsx:464-503`).
2. The server resolves the configured recognition host and combines host status, identity, config, secret-presence flags, and plugin settings in the `state` response (`server.ts:353-419`).
3. Editing a setting optimistically updates the page and calls `updateSettings`; the server writes keys separately, sanitizes ordinary settings, pushes config to connected hosts, and publishes `state-changed` (`app.tsx:516-547`, `server.ts:481-500`).
4. Engine setup, model download, and model deletion call their corresponding RPC operations and refresh state/models after completion (`app.tsx:550-566`, `app.tsx:980-998`, `server.ts:457-479`, `server.ts:502-510`).
5. Model progress arrives over realtime signals; page state is updated without polling while a download runs (`server.ts:189-197`, `app.tsx:505-514`).

### Settings page state and saves

`VoiceInputSettings` starts with empty state, model, and catalog values, then loads `state`, `diskModels`, and `catalogKeys` on mount. A state response is accepted only if no save is pending and no later refresh or settings revision superseded it. State RPC errors show a toast; model RPC errors clear the model list; catalog errors set catalog unavailable. Loaded UI language updates frontend language, and loaded settings publish the selected platform hotkey (`app.tsx:450-503`).

A save increments the pending counter and settings revision, optimistically merges the patch into page state, and queues `updateSettings` behind earlier saves. Success publishes hotkey configuration only for hotkey patches. Failure shows a toast; every completion decrements the counter, and the last pending save triggers refresh (`app.tsx:516-547`). Realtime model progress updates the progress field without polling, while `state-changed` refreshes page state and model inventory (`app.tsx:505-514`).

Setup and download actions set a busy marker and call their respective RPC methods. A ready result produces a success toast; a not-ready result or thrown RPC produces an error toast. Successful completion refreshes state, and the busy marker clears in `finally` (`app.tsx:550-566`).

### Recognition machine listing

`listMachines` calls BB's host list and returns `[]` if that call throws. It filters to `status === "connected"`, then requests identity for each remaining host in parallel. Identity failure leaves `platform` null but preserves that host's ID and name. `localEnginesPossible` is true only for `darwin` (`server.ts:782-817`).

### Recording retention write

`keepRecording` takes the decoded audio buffer and an extension already derived from the caller filename or MIME type. It uses the current UTC date for a subdirectory and a UTC time-of-day plus six UUID characters for the filename, creates the date directory recursively, and returns the path after writing. Directory creation or file write failure is caught and represented as `null`; `executeAudioTranscription` then writes the bytes into its temporary directory instead (`host.ts:156-177`, `host.ts:403-417`).

### Plugin entry and RPC contract

`plugin(bb)` reads/writes non-secret settings through BB KV using key `settings`, builds a host client for the management contract, and retains the latest model-progress signal before relaying it to the settings page. `currentConfig` maps saved settings into host config while leaving secret values blank. `pushConfig` iterates connected hosts, applies that config to each, and returns delivered and failed host names (`server.ts:159-175`, `server.ts:177-197`, `server.ts:199-237`, `server.ts:244-260`).

After a two-second registration delay, startup migrates legacy secrets where possible, syncs Env Catalog-linked keys, and pushes config. Migration exits when host resolution or secret status is unavailable; already-present keys are skipped. Catalog lookup/write failures are logged per key, and initial push failures are logged unless the plugin context has gone stale. Disposal clears a push that has not started (`server.ts:269-296`, `server.ts:314-355`).

The `rpcContract` validates each settings-page method's input and result with Zod: state and status payloads, environment/catalog lists, setup/download results, model inventory and deletion, settings patches, and transcription results have distinct shapes. `plugin` registers implementations for these methods. State has two branches: if recognition-host resolution throws, it returns null machine identifiers, an empty engine list, the error and available machines, while retaining settings and the configured active engine; otherwise it combines host status/identity/secrets with settings and model progress, marking local engines unsupported when the identity platform is not Darwin. Catalog lookup catches unavailable-plugin errors and returns `available: false`; host operations can reject through RPC. `updateSettings` stores manual/catalog secrets on the resolved host, sanitizes ordinary values, writes KV, pushes config and publishes `state-changed` (`server.ts:49-157`, `server.ts:359-500`).

The entry also registers the compatible `local-voice` AI service and CLI group. The AI service converts audio to base64, calls the shared transcription path, throws when its result is not ok, and returns text on success. CLI registration exposes status, setup, history, config, download, file transcription and settings delivery; command exceptions become exit code 1 with a described error (`server.ts:543-567`, `server.ts:569-600`, `server.ts:601-748`).

### Audio transcription request execution

`executeAudioTranscription` reads host config with secrets, applies a request-specific UI language when supplied, decodes base64, and derives an extension from filename first or MIME type second. When `saveRecordings` is enabled it tries `keepRecording`; if that returns null or saving is disabled, it creates a UUID-named temporary file. It passes both the working path and nullable saved path to `runTranscription`, along with prompt and a default 600,000 ms timeout. Success maps the outcome to `{ ok: true, model: engine, text }`. Any thrown value maps to `{ ok: false }`, using code `timeout` only for the exact message `timeout` and `request_failed` otherwise; timeout text is localized (`host.ts:391-435`).

Failures before the `try` block, such as config read, directory creation or temporary audio write failures, reject the host handler. Failures from `runTranscription` are caught and returned in the result shape; the browser or AI service decides how to surface that failure (`host.ts:403-435`, `host.ts:553-564`).

## Modes

| Setting/action | Inputs and limits | Result | Evidence |
|---|---|---|---|
| Recognition engine | `whisper`, `gigaam`, `openai`, `google`, `groq`; local engines need Python 3 and ffmpeg, and source marks MLX Whisper as Apple Silicon-only (`src/contract.ts:8-9`, `src/setup.ts:70-97`, `src/paths.ts:24-29`). | Local engines install Python packages; cloud setup installs no packages, and GigaAM can fall back from MPS to CPU (`src/setup.ts:70-123`, `python/engines.py:85-108`). | `server.ts:386-399`, `server.ts:802-808` |
| Recognition machine | Empty means BB server host; otherwise a configured machine identifier/name (`src/settings-store.ts:24-30`). | The server pushes config to every connected host, while each host RPC resolves its target host (`server.ts:244-256`, `server.ts:819-855`). | `server.ts:810-853` |
| Whisper model | One of the configured values in `WHISPER_MODELS`; default is the 4-bit large-v3 repository (`src/settings-store.ts:12-19`). | Model downloads to Hugging Face cache; the selected model is reported as active (`src/model-store.ts:10-18`, `host.ts:602-613`). | `src/settings-store.ts:12-19` |
| API key | Manual secret or Env Catalog link; host environment variable name is another setting (`server.ts:41-46`, `server.ts:474-490`). | Secret is stored on the recognition host; UI receives configured booleans and key source only (`host.ts:438-455`, `server.ts:410-416`). | `src/secret-store.ts:36-53` |
| `keepDays` | Integer from 0 to 3650 inclusive (`src/settings-store.ts:54-56`). | `0` disables pruning; positive values remove older dated recording directories after successful transcription (`host.ts:176-190`, `host.ts:374-384`). | `host.ts:176-190` |
| UI language | `auto` or one of eight language codes; `auto` follows the BB document language (`src/settings-store.ts:20-23`, `src/i18n/index.ts:13-33`). | Regional codes such as `pt-BR` resolve by their base code; unsupported codes use English. The browser loads the saved choice through `uiLanguage`, and recording requests carry the resolved language (`src/i18n/index.ts:29-35`, `src/frontend/words.ts:7-10`, `src/frontend/words.ts:36-51`, `src/frontend/global-voice-session.ts:35-41`). | `src/i18n/index.ts:13-35` |
| Dictation hotkey | Separate `hotkey*` settings for macOS/other and `hotkeyWin*` settings for Windows; Windows defaults to right Ctrl, other platforms to right Option (`src/frontend/hotkey.ts:26-53`, `src/frontend/hotkey.ts:149-205`, `src/settings-store.ts:56-67`, `src/settings-store.ts:101-115`). | UI selects platform-specific presets and captures a custom key. Windows presets include Ctrl, Alt, Caps Lock, and F8; non-Windows presets include Option, Command, and Control (`app.tsx:396-435`, `src/frontend/hotkey.ts:65-80`). | `app.tsx:348-448` |

### GigaAM execution modes and outcomes

`GigaamEngine.warmup` calls `_ensure_model`. On first use, `_ensure_model` selects MPS when Torch reports it available, otherwise CPU; it loads fixed model `v3_e2e_rnnt` and enables fp16 only on MPS. If model loading fails on MPS it retries on CPU; a CPU load failure propagates. Later calls reuse the cached model (`python/engines.py:75-108`).

For transcription, the engine converts non-WAV audio to 16 kHz mono WAV, then reads the samples and downmixes multi-channel input. Audio within the configured 22-second chunk size stays whole. Longer audio is split at Silero VAD speech boundaries; if VAD import/detection fails or returns no boundaries, equal chunks are used. A speech segment longer than the limit is hard-split. The engine transcribes chunks in order, omits empty chunk results, joins the rest with spaces, and cleans temporary WAV files in `finally` (`python/engines.py:123-154`, `python/engines.py:156-192`, `python/engines.py:195-222`).

If chunk transcription raises `RuntimeError` or `NotImplementedError` while on MPS, the model is loaded on CPU and that chunk is retried once. The retry error propagates; the same errors on CPU propagate without fallback. Audio conversion failure raises `EngineError` with the end of ffmpeg stderr (`python/engines.py:110-122`, `python/engines.py:195-210`).

## Business rules

- Settings use per-field validation and merge with defaults, so one malformed or obsolete field does not erase other valid settings (`src/settings-store.ts:117-143`).
- Windows and non-Windows hotkey values occupy separate settings fields; `hotkeyFromSettings` and `hotkeyToSettings` select the matching field family based on detected platform (`src/frontend/hotkey.ts:44-53`, `src/frontend/hotkey.ts:149-205`).
- `sanitizePatch` copies only keys present in defaults, validates that partial object, and returns `{}` when validation fails; unknown-only patches validate as an empty object (`src/settings-store.ts:145-155`).
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
