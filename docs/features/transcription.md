---
title: Transcription and text processing
type: component
created: 2026-10-01
updated: 2026-10-17
status: active
confidence: high
tags: [transcription, engines, text-processing]
sources:
  - host.ts
  - server.ts
  - src/contract.ts
  - src/paths.ts
  - src/setup.ts
  - src/cloud.ts
  - src/vocabulary.ts
  - src/term-repair.ts
  - src/cleanup.ts
  - src/ai-pass.ts
  - src/ai-pass-guard.ts
  - src/providers.ts
  - python/voiced.py
  - python/engines.py
  - src/daemon.ts
---
# Transcription and text processing

TL;DR: The recognition host reads a saved or temporary audio file, dispatches to a local Python engine or cloud provider, processes the returned text, records history, and returns the final text (`host.ts:265-384`).

## Purpose

This page describes the recognition pipeline behind the `local-voice` BB service and the plugin's direct audio transcription method (`server.ts:534-558`, `host.ts:554-566`). The available engines are `whisper`, `gigaam`, `openai`, `google`, and `groq` (`src/contract.ts:8-9`).

## How it works

1. The host reads `config.json`, overlays provider secrets from `secrets.json`, decodes base64 audio, and chooses a filename extension from the supplied filename or MIME type (`host.ts:103-140`, `host.ts:387-411`).
2. If recording retention is enabled, it writes the source audio under a UTC date directory; otherwise it writes a temporary file (`host.ts:158-174`, `host.ts:402-411`).
3. The host parses the vocabulary and constructs an optional recognition hint capped at 800 characters (`host.ts:60-61`, `host.ts:273-276`).
4. OpenAI and Groq use the OpenAI-compatible `/audio/transcriptions` endpoint; Google uses Files API plus Interactions for models whose names contain `transcribe`, and inline `generateContent` for other models (`host.ts:278-331`, `src/cloud.ts:57-90`, `src/cloud.ts:99-203`).
5. Local engines use `ensureDaemon` and `callDaemon`; the host pings the engine-specific socket, removes a stale socket if needed, materializes embedded Python files, starts a detached worker, and polls for readiness for up to 20 seconds. A missing engine virtual environment or failed startup rejects the request. A socket call sends one JSON line, parses the first response line, and rejects on connection errors or its supplied timeout (`host.ts:332-351`, `src/daemon.ts:41-83`, `src/daemon.ts:84-142`).
6. If the result exactly repeats the normalized vocabulary hint, it is cleared. Then deterministic vocabulary repair and cleanup run; cleanup first shortens stretched words, removes language-specific fillers, and repairs punctuation left around removed fillers. The optional AI pass runs only when enabled, a model is set, and a key resolves (`host.ts:353-365`, `host.ts:192-229`, `src/cleanup.ts:35-49`).
7. Empty post-processed text becomes a request failure. Success appends one JSONL history row, writes a `.txt` sidecar when a saved recording exists, and prunes expired recording directories (`host.ts:231-251`, `host.ts:363-384`).

## Modes

| Engine | Execution and prerequisites | Audio destination / output behavior | Evidence |
|---|---|---|---|
| `whisper` | Local `mlx-whisper` in its own Python environment; setup checks Python 3 and ffmpeg (`src/paths.ts:24-38`, `src/setup.ts:70-123`). | Runs on selected host; model is selected from the Whisper model setting (`host.ts:332-345`). | `python/engines.py:33-66` |
| `gigaam` | Local GigaAM v3, Torch, SoundFile, Silero VAD (`src/paths.ts:32-37`). | Runs on selected host; audio is converted to 16 kHz mono WAV and split into chunks no longer than the configured 22 seconds (`python/engines.py:16-18`, `python/engines.py:138-153`, `python/engines.py:195-210`). | `python/engines.py:67-77` |
| `groq` | Cloud API key or configured host environment variable (`host.ts:293-305`). | Audio file is sent to the configured OpenAI-compatible base URL (`host.ts:283-313`). | `src/cloud.ts:57-90` |
| `openai` | Cloud API key or configured host environment variable (`host.ts:293-305`). | Audio file is sent to the configured OpenAI-compatible base URL (`host.ts:283-313`). | `src/cloud.ts:57-90` |
| `google` | Google API key or configured host environment variable (`host.ts:315-321`). | Audio is uploaded or sent inline according to model name (`src/cloud.ts:99-203`). | `src/cloud.ts:99-203` |
| Optional AI text pass | Enabled flag, model, base URL, and resolved key; UI presets are Groq, OpenCode Zen, and OpenAI (`src/contract.ts:49-57`, `src/providers.ts:48-73`). | Runs after deterministic repair and cleanup; its request timeout is 30 seconds; a guard accepts vocabulary-term changes and rejects unrelated changes (`host.ts:211-227`, `host.ts:60-62`, `src/ai-pass-guard.ts:25-54`). | `src/ai-pass.ts:20-96` |

For vocabulary repair, mixed-script words can match a Latin vocabulary term when skeleton similarity is at least 0.75; pure Latin words are additionally filtered by transliterated similarity of at least 0.5. Exact skeleton matches are considered first, and ties choose the term closest in character count (`src/term-repair.ts:132-168`).

## Business rules

- Supported transcription languages are `auto`, `ru`, `en`, `de`, `fr`, `es`, `pt`, and `it` (`src/contract.ts:11-12`). The cloud adapters map only `ru` and `en` to provider-specific language codes for the Google Interactions path (`src/cloud.ts:29-37`, `src/cloud.ts:127-135`).
- The recognition vocabulary is parsed into terms; when vocabulary prompting is enabled it forms a hint with an 800-character budget (`src/vocabulary.ts:14-48`, `host.ts:60-61`, `host.ts:273-276`).
- Deterministic repair only runs when `vocabularyRepair` is enabled and vocabulary entries exist; cleanup receives the `cleanupFillers` and `cleanupQuotes` switches (`host.ts:198-209`).
- Filler removal contracts elongated words before applying filler patterns, then removes orphaned punctuation while retaining a space after sentence punctuation (`src/cleanup.ts:35-49`).
- The AI pass is a second text operation. The guard rejects changed ordinary words that do not match vocabulary terms (`host.ts:211-227`, `src/ai-pass-guard.ts:25-54`).
- API keys resolve from plugin-owned secret values or, when configured, the named environment variable on the recognition host (`host.ts:96-101`, `host.ts:293-321`).
- A provider timeout is converted to the message `timeout`; provider non-2xx responses and payloads without text fail the request (`src/cloud.ts:39-55`, `src/cloud.ts:81-89`, `src/cloud.ts:144-153`).
- The local daemon unloads after 900 seconds idle; `0` disables its idle exit (`host.ts:63-72`, `python/voiced.py:26-27`, `python/voiced.py:107-118`).

## Public API

| Entry | File | Purpose |
|---|---|---|
| `ai.voice.transcribe` host handler | `host.ts:554-557` | SDK voice-service transcription path. |
| `transcribeDirect` host handler | `host.ts:559-566` | Plugin-owned direct audio transcription path. |
| `runTranscription` | `host.ts:265-384` | Shared engine, text processing, history, and retention pipeline. |
| `transcribeOpenAi` / `transcribeGemini` | `src/cloud.ts:57-154` | Cloud provider adapters. |
| `repairTerms` / `cleanupText` / `runAiPass` | `src/term-repair.ts:177-236`, `src/cleanup.ts:23-34`, `src/ai-pass.ts:51-96` | Text transformation stages. |

## Failures

- Missing provider key throws a provider-specific setup error; a named but missing host environment variable is identified by name (`host.ts:293-321`).
- A local daemon response with `ok: false` becomes an error; a model result that reduces to empty text fails as “speech not detected” (`host.ts:332-365`).
- Cloud HTTP failures, missing response text, and request timeouts reject the adapter call (`src/cloud.ts:39-55`, `src/cloud.ts:81-89`, `src/cloud.ts:144-153`).
- A failed optional AI pass is logged and deterministic output is returned (`host.ts:211-227`).
- Direct transcription wraps failures into `{ ok: false, text: "", error }` (`host.ts:387-429`, `host.ts:559-566`).

## Gotchas

- Google model routing is based on whether the configured model string contains `transcribe` (`src/cloud.ts:99-110`).
- A failed recognition leaves the recording file only when recording retention is enabled and file creation succeeded; history is appended only after a successful non-empty result (`host.ts:158-174`, `host.ts:363-384`, `host.ts:402-411`).
- Google audio upload and interaction creation each use the supplied timeout independently (`src/cloud.ts:110-116`, `src/cloud.ts:136-143`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](../architecture.md)
- [BB Voice Input — Overview](../overview.md)
