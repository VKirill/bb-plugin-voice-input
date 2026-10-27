---
title: Transcription and text processing
type: component
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: medium
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

This page describes the recognition pipeline behind the `local-voice` BB service and the plugin's direct audio transcription method (`server.ts:534-558`, `host.ts:560-572`). The available engines are `whisper`, `gigaam`, `openai`, `google`, and `groq` (`src/contract.ts:8-9`).

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
| Optional AI text pass | Enabled flag, model, base URL, and resolved key; UI presets are Groq, OpenCode Zen, and OpenAI (`src/contract.ts:49-57`, `src/providers.ts:48-73`). | Runs after deterministic repair and cleanup; its request timeout is 30 seconds; a guard accepts vocabulary-term changes and restores unrelated changes (`host.ts:214-231`, `host.ts:60-62`, `src/ai-pass-guard.ts:25-54`). | `src/ai-pass.ts:20-96` |

### Transcription dispatch and outcomes

`runTranscription` first parses vocabulary and selects the recognition hint: when vocabulary prompting is enabled, the bounded vocabulary prompt takes precedence, with the caller prompt as fallback; when disabled, only the caller prompt is passed. OpenAI and Groq share the OpenAI-compatible adapter but select their own credential, endpoint, and model; Google uses its own key and model adapter. Missing keys throw localized errors. Local engines instead ensure the per-engine daemon, send a `transcribe` request, and throw when its response is not successful. After either path, output identical to the normalized hint is cleared, text post-processing runs, and an empty result fails as no speech. A successful result records engine, duration, raw and processed text in history, prunes retained recording folders, and returns the outcome (`host.ts:268-388`).

### Vocabulary repair stages

`skeleton` lowercases each character, transliterates Cyrillic or keeps ASCII Latin, skips other characters, removes vowels, folds `c` into `k`, and suppresses repeated adjacent consonants. Characters that produce no letters yield no skeleton (`src/term-repair.ts:49-71`). `replacement` classifies a word as mixed script, Cyrillic-containing, or having no Cyrillic letters, then enforces minimum skeleton lengths of 2, 4, or 3 respectively. It considers only Latin vocabulary terms. Exact skeleton equality is the first match; fuzzy similarity (≥0.75) is allowed only for mixed-script single-word candidates of length at least 3, while input with no Cyrillic letters also needs ≥0.5 transliterated similarity. No hit returns `null`; ties select the candidate nearest the spoken word's length (`src/term-repair.ts:112-168`).

`repairTerms` returns the original string for an empty vocabulary. Otherwise it tokenizes words while retaining separators and tests windows from two words down to one. A two-word window must have only spaces/hyphens between words, non-empty skeletons for both words, and no one-letter leading word; it also requires exact skeleton matching. The first matching window is replaced, unmatched words and all separators are copied through, and the original trailing separator is restored (`src/term-repair.ts:177-240`).

`cleanupText` detects or uses the configured speech language, conditionally removes fillers and fixes quotes according to independent switches, then always collapses spacing (`src/cleanup.ts:11-33`). Filler cleanup first contracts stretched words, removes language-specific patterns, repairs punctuation orphaned by removal, and preserves spacing after sentence punctuation. Quote cleanup applies the language's quote style, removes a lone unmatched quote, and inserts a space after a colon before a non-space/non-digit (`src/cleanup.ts:35-64`).

### Optional AI pass and guard

`runAiPass` returns the input unchanged if there are no vocabulary terms. Otherwise it builds the term-only correction prompt and posts a deterministic chat-completions request with an abort timer. Timeout/network errors, non-success HTTP status, or a payload without string content throw; the timer is cleared in all outcomes. It strips complete and trailing `<think>` blocks; if stripping leaves no text, it returns the original input (`src/ai-pass.ts:20-38`, `src/ai-pass.ts:45-49`, `src/ai-pass.ts:51-95`, `src/ai-pass.ts:101-111`).

`guardAiPass` builds an allowlist from normalized original words plus vocabulary words/space-joined terms. It scans corrected tokens: allowed tokens pass unchanged; each unknown token is compared with original tokens and replaced by its closest match only at similarity ≥0.6. If there is no sufficiently close original token, the model's token remains. This guard keeps the AI pass best-effort: a thrown AI request is caught by the host, logged, and leaves deterministic cleanup output in place (`src/ai-pass-guard.ts:9-54`, `host.ts:214-231`).

### Cloud adapter outcomes

`transcribeOpenAi` builds multipart fields for model and audio, adds language unless it is `auto`, and adds a prompt only when non-empty. It posts to `/audio/transcriptions` with bearer auth under the request timeout. A non-2xx response throws with provider status/message; a successful response without string `text` also throws; otherwise trimmed text is returned (`src/cloud.ts:57-90`).

Google's inline path constructs a transcription-only instruction and includes the optional vocabulary prompt and base64 audio. It posts to the selected model's `generateContent` endpoint with zero temperature; timeout, HTTP errors, and missing candidate text fail the call, while extracted parts are trimmed and returned (`src/cloud.ts:156-203`).

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
| `ai.voice.transcribe` host handler | `host.ts:560-563` | SDK voice-service transcription path. |
| `transcribeDirect` host handler | `host.ts:559-566` | Plugin-owned direct audio transcription path. |
| `runTranscription` | `host.ts:265-384` | Shared engine, text processing, history, and retention pipeline. |
| `transcribeOpenAi` / `transcribeGemini` | `src/cloud.ts:57-154` | Cloud provider adapters. |
| `repairTerms` / `cleanupText` / `runAiPass` | `src/term-repair.ts:177-236`, `src/cleanup.ts:23-34`, `src/ai-pass.ts:51-96` | Text transformation stages. |

## Failures

- Missing provider key throws a provider-specific setup error; a named but missing host environment variable is identified by name (`host.ts:293-321`).
- A local daemon response with `ok: false` becomes an error; a model result that reduces to empty text fails as “speech not detected” (`host.ts:332-365`).
- Cloud HTTP failures, missing response text, and request timeouts reject the adapter call (`src/cloud.ts:39-55`, `src/cloud.ts:81-89`, `src/cloud.ts:144-153`).
- A failed optional AI pass is logged and deterministic output is returned (`host.ts:214-231`).
- The direct host handler maps pipeline failures to `{ ok: false, text: "", error }`; the server's `transcribeAudio` handler catches thrown RPC errors into the same shape (`host.ts:565-572`, `server.ts:512-518`).

## Gotchas

- Google model routing is based on whether the configured model string contains `transcribe` (`src/cloud.ts:99-110`).
- A failed recognition leaves the recording file only when recording retention is enabled and file creation succeeded; history is appended only after a successful non-empty result (`host.ts:158-174`, `host.ts:363-384`, `host.ts:402-411`).
- Google audio upload and interaction creation each use the supplied timeout independently (`src/cloud.ts:110-116`, `src/cloud.ts:136-143`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](../architecture.md)
- [BB Voice Input — Overview](../overview.md)
