---
title: Plugin API and commands
type: component
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: medium
tags: [api, rpc, cli]
sources:
  - server.ts
  - app.tsx
  - src/frontend/global-voice-session.ts
  - python/voiced.py
  - src/daemon.ts
  - src/contract.ts
  - src/host-contract.ts
  - src/frontend/words.ts
  - host.ts
---
# Plugin API and commands

TL;DR: The plugin exposes BB plugin RPC methods, host RPC handlers, one AI voice service, browser HTTP RPC calls for language bootstrap and fallback transcription, and the `bb voice-input` CLI command group (`server.ts:49-157`, `src/contract.ts:94-210`, `server.ts:560-591`, `src/frontend/words.ts:36-51`).

## Purpose

This page lists interfaces implemented by the plugin. It does not define a standalone public REST API: the settings UI uses BB plugin RPC and the normal transcription path is registered as an AI service (`app.tsx:431-469`, `server.ts:534-558`).

## How it works

1. BB invokes the exported `plugin()` entry point in `server.ts`; it registers handlers against `rpcContract` (`server.ts:49-157`, `server.ts:159-160`, `server.ts:359-519`).
2. The settings UI calls RPC methods through the SDK's `useRpc` hook (`app.tsx:431-469`).
3. The server uses `managementContract` to call host methods; `hostContract` extends it with BB's AI-services host contract (`src/contract.ts:89-210`, `src/host-contract.ts:1-10`).
4. The server registers `local-voice` as an AI service and forwards `File` audio as base64 to the host (`server.ts:534-558`).
5. The CLI is registered separately as `voice-input` and dispatches status, setup, config, download, transcribe, history, and settings-delivery commands (`server.ts:560-738`).

### Plugin entry point

`plugin()` creates a host client, reads and writes the `settings` KV value, and subscribes to model-progress signals. It schedules legacy-key migration, Env Catalog synchronization, and config delivery after registration; disposal clears that timer. It then registers page RPC handlers, the `local-voice` service, and the CLI group. If `state` cannot resolve a host, it returns machine discovery and saved settings with engine status omitted. Catalog lookup failure returns `available: false`; setup and download handler failures propagate through RPC, while `transcribeAudio` catches errors and returns its `{ ok, text, error }` result shape (`server.ts:159-197`, `server.ts:244-260`, `server.ts:331-355`, `server.ts:359-519`, `server.ts:543-601`).

## Modes

| Interface | Transport | Caller | Result |
|---|---|---|---|
| Plugin page RPC | BB plugin RPC | Settings page via `useRpc` | State, settings, engine/model operations (`app.tsx:431-519`, `server.ts:49-138`). |
| Host management RPC | BB host RPC | Plugin server | Host identity, config, setup, status, secrets, models, file transcription, history (`src/contract.ts:94-210`). |
| AI service | BB AI-services contract | BB voice transcription | `local-voice` returns text or throws a transcription error (`server.ts:534-558`). |
| Browser HTTP fallback | `POST /api/v1/plugins/voice-input/rpc/transcribeAudio` | Global dictation session when no injected transcriber exists | JSON result with `ok`, `text`, and `error` (`src/frontend/global-voice-session.ts:390-410`). |
| CLI | `bb voice-input <command>` | BB CLI user | Text output and command exit status (`server.ts:560-738`). |

The plugin source declares RPC method names and contracts, but does not declare the SDK-managed HTTP paths for those methods. The browser directly calls the `uiLanguage` and `transcribeAudio` paths (`src/frontend/words.ts:36-44`, `src/frontend/global-voice-session.ts:390-410`).

## Business rules

- `plugin()` registers page handlers with `bb.rpc.register(rpcContract, handlers)` and registers the `voice-input` command group with `bb.cli.register` (`server.ts:359-360`, `server.ts:569-601`).
- The UI RPC contract validates method inputs and outputs with Zod (`server.ts:49-152`). Host RPC input and output schemas are strict (`src/contract.ts:94-210`).
- Provider secret values are accepted by settings update but written through host RPC; the UI receives configured booleans and key-source labels (`server.ts:474-490`, `server.ts:410-416`).
- Host management methods are an internal plugin-to-host interface, not HTTP route names (`src/host-contract.ts:1-10`).

## Public API

### Settings page RPC

The endpoint path prefix is managed by BB. Input/output shapes below follow `rpcContract`; `null` means the method accepts no payload (`server.ts:49-152`).

| Method | Path | Caller | Purpose and payload | Auth |
|---|---|---|---|---|
| `state` | BB-managed plugin RPC method `state` | Settings UI | Returns machine, engines, settings, provider-key status, model options, and progress. | BB plugin RPC; no plugin-specific check (`server.ts:49-99`, `server.ts:353-419`). |
| `envKeys` | BB-managed plugin RPC method `envKeys` | Settings UI | Returns names declared by BB and visible to the recognition host; values are not returned (`server.ts:101-104`, `server.ts:434-449`). | BB plugin RPC; no plugin-specific check. |
| `catalogKeys` | BB-managed plugin RPC method `catalogKeys` | Settings UI | Returns Env Catalog availability and variable names (`server.ts:105-108`, `server.ts:427-439`). | BB plugin RPC; no plugin-specific check. |
| `setupEngine` | BB-managed plugin RPC method `setupEngine` | Settings UI | `{ engine }`; set up one recognition engine (`server.ts:109-112`, `server.ts:450-459`). | BB plugin RPC; no plugin-specific check. |
| `downloadEngineModel` | BB-managed plugin RPC method `downloadEngineModel` | Settings UI | `{ engine }`; download a local engine model (`server.ts:113-116`, `server.ts:495-504`). | BB plugin RPC; no plugin-specific check. |
| `diskModels` | BB-managed plugin RPC method `diskModels` | Settings UI | Returns cached model records (`server.ts:117-130`, `server.ts:460-463`). | BB plugin RPC; no plugin-specific check. |
| `deleteEngineModel` | BB-managed plugin RPC method `deleteEngineModel` | Settings UI | `{ engine, model }`; delete a model and return bytes freed (`server.ts:131-134`, `server.ts:464-473`). | BB plugin RPC; no plugin-specific check. |
| `updateSettings` | BB-managed plugin RPC method `updateSettings` | Settings UI | Scalar record patch; saves valid settings and host secrets (`server.ts:135-138`, `server.ts:474-493`). | BB plugin RPC; no plugin-specific check. |
| `uiLanguage` | `POST /api/v1/plugins/voice-input/rpc/uiLanguage` | Browser dictation bootstrap | Returns the saved UI language preference (`server.ts:135-138`, `server.ts:359-360`, `src/frontend/words.ts:36-51`). | BB RPC route; no plugin-specific check. |
| `transcribeAudio` | `POST /api/v1/plugins/voice-input/rpc/transcribeAudio` | Browser fallback | Base64 audio, MIME type, optional filename, prompt and UI language; returns `{ ok, text, error }` (`server.ts:143-155`, `server.ts:512-540`, `src/frontend/global-voice-session.ts:390-410`). | BB RPC route; no plugin-specific check. |

### Host RPC

Host method payloads and output schemas are declared in `managementContract` (`src/contract.ts:94-210`). `hostContract` adds the SDK voice and inference operations (`src/host-contract.ts:7-10`, `host.ts:546-557`).

| Method | Path | Caller | Purpose | Auth |
|---|---|---|---|---|
| `identify` | Host RPC method `identify` | Plugin server | Return host name and platform. | BB host RPC; no method-level plugin check (`src/contract.ts:95-99`, `host.ts:435-436`). |
| `applyConfig` | Host RPC method `applyConfig` | Plugin server | Persist sanitized voice config and stop obsolete local daemons. | BB host RPC; no method-level plugin check (`src/contract.ts:100-103`, `host.ts:465-481`). |
| `setup` | Host RPC method `setup` | Plugin server | Set up selected engine and optionally reinstall. | BB host RPC; no method-level plugin check (`src/contract.ts:104-109`, `host.ts:484-489`). |
| `status` | Host RPC method `status` | Plugin server | Return paths, engine readiness, model bytes, and recording count. | BB host RPC; no method-level plugin check (`src/contract.ts:110-120`, `host.ts:491-524`). |
| `downloadModel` | Host RPC method `downloadModel` | Plugin server | Download a local model and emit progress. Cloud engines return ready without a model download. | BB host RPC; no method-level plugin check (`src/contract.ts:122-126`, `host.ts:568-593`). |
| `envKeys` | Host RPC method `envKeys` | Plugin server | Return matching, non-empty environment variable names. | BB host RPC; values are omitted (`src/contract.ts:127-130`, `host.ts:457-463`). |
| `setSecret` | Host RPC method `setSecret` | Plugin server | Write one of four named provider keys. | BB host RPC; value is stored in the host secret file (`src/contract.ts:132-140`, `host.ts:438-443`). |
| `secretsStatus` | Host RPC method `secretsStatus` | Plugin server | Return configured flags and AI-pass key source, never secret values. | BB host RPC (`src/contract.ts:142-155`, `host.ts:445-455`). |
| `listModels` | Host RPC method `listModels` | Plugin server | List cached models with active flags. | BB host RPC (`src/contract.ts:156-174`, `host.ts:595-607`). |
| `deleteModel` | Host RPC method `deleteModel` | Plugin server | Stop the engine daemon and delete a model cache. | BB host RPC (`src/contract.ts:175-181`, `host.ts:616-620`). |
| `transcribeFile` | Host RPC method `transcribeFile` | Plugin server | Transcribe a file already on the selected host. | BB host RPC (`src/contract.ts:180-186`, `host.ts:616-628`). |
| `transcribeDirect` | Host RPC method `transcribeDirect` | Plugin server | Decode and transcribe browser or API base64 audio. | BB host RPC (`src/contract.ts:187-205`, `host.ts:559-566`). |
| `historyList` | Host RPC method `historyList` | Plugin server | Return the most recent 1–200 parsed history entries. | BB host RPC (`src/contract.ts:206-210`, `host.ts:527-544`). |
| `ai.voice.transcribe` | Host AI-services method `ai.voice.transcribe` | BB AI-services runtime | Pass audio input and host temporary directory to the shared audio transcription pipeline. | BB AI-services host contract (`src/host-contract.ts:7-10`, `host.ts:560-563`). |
| `ai.inference.complete` | Host AI-services method `ai.inference.complete` | BB AI-services runtime | Reject text completion because this plugin handles only voice transcription. | BB AI-services host contract (`host.ts:546-552`). |

### CLI commands

The command group and usage strings are registered at `server.ts:560-590`; argument parsing and dispatch are at `server.ts:592-738`.

| Method | Path / command | Caller | Purpose | Auth |
|---|---|---|---|---|
| `voice-input status` | `bb voice-input status [--machine <name>]` | BB CLI | Show data path, Python, ffmpeg, recording count, and engine status. | BB CLI; no plugin-specific check (`server.ts:564`, `server.ts:610-629`). |
| `voice-input setup` | `bb voice-input setup [whisper|gigaam] [--reinstall] [--machine <name>]` | BB CLI | Install the selected/configured engine and push config (`server.ts:566-569`, `server.ts:632-645`). | BB CLI; no plugin-specific check. |
| `voice-input history` | `bb voice-input history [N] [--machine <name>]` | BB CLI | Print recent transcripts; N is clamped to 1–200 (`server.ts:570`, `server.ts:712-730`). | BB CLI; no plugin-specific check. |
| `voice-input config` | `bb voice-input config [key value]` | BB CLI | Print settings or set one known setting after type validation (`server.ts:572-575`, `server.ts:647-674`). | BB CLI; no plugin-specific check. |
| `voice-input download` | `bb voice-input download [whisper|gigaam] [--machine <name>]` | BB CLI | Download a model for the requested or configured engine (`server.ts:577-580`, `server.ts:676-691`). | BB CLI; no plugin-specific check. |
| `voice-input transcribe` | `bb voice-input transcribe <path> [--machine <name>]` | BB CLI | Transcribe a file already on the recognition host (`server.ts:582-585`, `server.ts:693-710`). | BB CLI; no plugin-specific check. |
| `voice-input apply-settings` | `bb voice-input apply-settings` | BB CLI | Push the current configuration to connected hosts (`server.ts:587-590`, `server.ts:596-605`). | BB CLI; no plugin-specific check. |

## Gotchas

- The `transcribeAudio` browser fetch is the fallback path only; normal AI service use passes through BB's AI service registration (`src/frontend/global-voice-session.ts:390-410`, `server.ts:534-558`).
- Host methods are strict Zod RPC contracts; the plugin source defines method names and schemas, not their HTTP route implementation (`src/contract.ts:94-210`, `src/host-contract.ts:1-10`).
- The command help lists the supported CLI forms; unrecognized commands return exit code 1 (`server.ts:560-590`, `server.ts:733-735`).

### Local daemon protocol

The host communicates with one Python daemon per engine over a Unix domain socket. `ensureDaemon` first pings an existing socket and returns if it responds. Otherwise it removes the stale socket, materializes embedded Python files, checks that the engine virtualenv interpreter exists, launches `voiced.py` detached with idle-timeout and telemetry environment settings, then polls every 250 ms until the socket answers or the 20-second startup deadline raises a localized error. Missing interpreter raises a localized engine-missing error. `callDaemon` writes one JSON request terminated by a newline and reads the first newline-terminated JSON response; it rejects on timeout, socket error, or invalid JSON (`src/daemon.ts:85-95`, `src/daemon.ts:101-144`, `src/daemon.ts:42-82`).

`voiced.py` requires a socket path argument (otherwise it prints usage and exits with code 2), creates the socket parent directory, replaces any old socket path, binds and listens with backlog 8, then sets socket permissions to `0600`. Its accept loop handles clients serially; an accept error or client-requested shutdown breaks the loop, while an unexpected client-serving exception is logged and the loop continues. The `finally` block closes the server socket and removes its path (`python/voiced.py:119-149`). `_serve_client` reads through the first newline, returns without a response if the peer closes early, parses one JSON request and calls `_handle`, maps `EngineError` and other exceptions to `{ ok: false, code: "request_failed", message }`, writes one JSON response line, and returns whether that response requested shutdown (`python/voiced.py:86-104`). `stopDaemon` sends shutdown when a socket exists, tolerates a daemon that already exited, then removes the socket path (`src/daemon.ts:146-155`).

`hostContract` spreads `managementContract` and the SDK AI-services host contract. The combined contract adds the SDK voice and text inference methods; this host implements voice transcription and explicitly returns a request failure for text completion (`src/host-contract.ts:7-10`, `host.ts:552-563`).

`managementContract` declares strict input and output objects for identity, config, setup, status, model download, environment names, secret writes/status, model listing/deletion, file/direct transcription, and history. Setup/download may include a UI language; direct audio requires non-empty base64; file transcription requires a non-empty path and positive timeout; history limits are 1–200. Extra fields and invalid values fail schema validation before a handler receives input (`src/contract.ts:97-214`).

`executeAudioTranscription` reads host config plus secrets, applies a request UI language override when present, decodes base64 audio, and derives its extension from filename/MIME type. With retention enabled it calls `keepRecording`; if no saved path results, it writes a UUID-named temporary file. It calls `runTranscription` with the caller prompt and a 600-second default timeout, returning `{ ok: true, model, text }` on success. A thrown error becomes `timeout` only when its message equals `timeout`; other errors use `request_failed`, with timeout text localized (`host.ts:391-436`). The AI voice handler returns this result directly, while `transcribeDirect` maps it to `{ ok, text, error }` (`host.ts:560-572`).

## Failures

- Zod rejects inputs that do not match the declared plugin or host RPC schema before valid handler processing (`server.ts:49-152`, `src/contract.ts:94-210`).
- `transcribeAudio` catches transcription errors and returns `{ ok: false, text: "", error }` (`server.ts:512-518`).
- A missing file passed to `transcribeFile` throws a path-specific error on the host (`host.ts:616-628`).
- CLI handler errors are returned with exit code 1 and the error text on stderr (`server.ts:601-604`, `server.ts:742-745`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](architecture.md)
- [Deployment](deployment.md)
- [BB Voice Input — Overview](overview.md)
