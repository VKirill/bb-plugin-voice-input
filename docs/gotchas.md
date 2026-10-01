---
title: Gotchas
type: gotchas
created: 2026-10-01
updated: 2026-10-01
status: active
confidence: medium
tags: [gotchas, operations, data]
sources:
  - src/frontend/global-voice-session.ts
  - server.ts
  - src/contract.ts
  - src/paths.ts
  - src/setup.ts
  - host.ts
  - src/model-store.ts
  - python/engines.py
  - src/download.ts
  - src/settings-store.ts
  - src/cloud.ts
  - src/ai-service-compat.ts
---
# Gotchas

TL;DR: The sharp edges are differences between browser and host timeouts, settings on the BB server versus secrets on the recognition host, and cleanup that runs only after successful recognition (`src/frontend/global-voice-session.ts:390-410`, `server.ts:194-230`, `host.ts:374-384`).

## Critical

### Recording retention can be disabled

**Problem:** `saveRecordings` defaults to true, but users can turn it off; audio then goes to a temporary directory and a failed recognition has no persisted audio recovery copy (`src/settings-store.ts:95-96`, `host.ts:402-411`).

**Risk:** A failed recognition cannot be retried from a retained recording when recording saving is disabled or when the recording write fails (`host.ts:158-174`, `host.ts:402-411`).

**Workaround:** Check the setting before relying on the recordings folder for recovery (`src/settings-store.ts:54-55`).

### Secrets and ordinary settings live on different machines

**Problem:** User settings are saved in BB server key-value storage, while provider secrets and runtime config are stored on the recognition host (`server.ts:160-169`, `src/paths.ts:8-21`).

**Risk:** Inspecting only the server's plugin data does not locate the host API keys or recordings (`server.ts:194-230`, `host.ts:438-455`).

**Workaround:** Resolve the configured recognition host before debugging config or key delivery (`server.ts:238-255`, `server.ts:810-853`).

## High

### Browser fallback can time out before host transcription

**Problem:** The fallback browser fetch aborts at 60 seconds, while server-to-host transcription is configured for 10 minutes (`src/frontend/global-voice-session.ts:390-410`, `server.ts:31-37`).

**Risk:** The browser can show a timeout while a longer host operation is still within its own timeout budget (`src/frontend/global-voice-session.ts:444-452`, `server.ts:514-531`).

**Workaround:** Distinguish browser fallback requests from BB's registered AI service path when investigating timeouts (`server.ts:534-558`).

### Recording pruning and history retention differ

**Problem:** Expired recording directories are pruned after a successful transcription; history JSONL is append-only in the plugin (`host.ts:176-190`, `host.ts:363-384`, `host.ts:527-544`).

**Risk:** A history row can retain an `audioPath` after its recording directory has been removed (`host.ts:231-251`, `src/contract.ts:77-87`).

**Workaround:** Treat `audioPath` as a historical reference, not proof the file still exists (`host.ts:176-190`).

## Medium

### Local-engine UI support does not check CPU architecture

**Problem:** The settings page marks local engines supported whenever the reported platform is Darwin, but its setup handler forwards the request without another platform check. The source requirement comment identifies MLX Whisper as Apple Silicon-only (`server.ts:386-399`, `server.ts:450-458`, `server.ts:802-808`, `src/paths.ts:24-29`).

**Risk:** A macOS host with an unsupported CPU architecture can appear supported for Whisper even though the engine requirement says Apple Silicon (`src/paths.ts:24-29`).

**Workaround:** Select a recognition host with Apple Silicon for Whisper; verify GigaAM runtime support separately (`src/paths.ts:24-38`, `python/engines.py:85-108`).

### Model caches are outside plugin data

**Problem:** Whisper and GigaAM model caches are under the recognition user's home directory, while the Python virtual environments and recordings live under the plugin host data directory (`src/model-store.ts:9-18`, `src/paths.ts:8-21`).

**Risk:** Backing up or deleting only the plugin data directory does not include model weights (`src/model-store.ts:48-72`).

**Workaround:** Use the plugin model list and delete operation to inspect/manage model caches (`host.ts:595-614`).

### One invalid setting patch rejects all fields in that patch

**Problem:** `sanitizePatch` first filters unknown keys, then validates the remaining object as one partial schema; any invalid included value returns `{}` (`src/settings-store.ts:133-143`).

**Risk:** A mixed valid/invalid update is not partially applied (`server.ts:474-493`).

**Workaround:** Send one validated setting at a time from CLI config or correct all fields before saving the page patch (`server.ts:647-674`).

## Low

### Engine setup readiness does not mean the model is downloaded

**Problem:** Local setup installs Python packages and returns ready; the source says the model is downloaded on first transcription (`src/setup.ts:103-123`). Local readiness checks package imports, while model size is reported separately (`src/setup.ts:129-153`, `host.ts:491-507`).

**Risk:** The first dictation can include model download time even when engine status says ready (`host.ts:332-351`, `src/download.ts:15-35`).

**Workaround:** Download the model before a dictation session with `bb voice-input download` (`server.ts:676-691`).

### Local engine setup needs system tools

**Problem:** Setup locates Python 3 and ffmpeg on the host and returns an explicit failure when either is absent (`src/setup.ts:16-60`, `src/setup.ts:79-97`).

**Risk:** Installing the plugin package alone does not install these operating-system tools (`src/setup.ts:1-4`).

**Workaround:** Install Python and ffmpeg on the recognition machine before running local engine setup (`src/setup.ts:79-97`).

### Compatibility registration tries multiple declarations

**Problem:** AI-service registration attempts declarations with `kinds` plus `transcribe`, then `transcribe` only, then legacy `kinds` only (`src/ai-service-compat.ts:1-27`).

**Risk:** A plugin load failure after all attempts means no declaration shape was accepted (`src/ai-service-compat.ts:18-27`).

**Workaround:** Keep the SDK compatibility adapter when changing service registration (`server.ts:534-558`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [BB Voice Input — Overview](overview.md)
