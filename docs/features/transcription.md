---
title: Transcription and text processing
type: component
created: 2026-10-01
updated: 2026-10-30
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
5. Local engines call `ensureDaemon` before sending a `transcribe` request over the engine socket. The daemon lifecycle and its startup failures are detailed below (`host.ts:336-350`, `src/daemon.ts:85-144`).
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

`runTranscription` follows this order:

1. Record the start time, parse vocabulary, then choose the hint. With vocabulary prompting enabled, the bounded vocabulary prompt takes precedence and the caller prompt is fallback; with it disabled, only the caller prompt is used (`host.ts:268-281`).
2. For OpenAI/Groq/Google, read the audio file and build request metadata. OpenAI and Groq resolve their separate key, endpoint and model, then call the OpenAI-compatible adapter; Google resolves its key and calls the Gemini adapter. A missing key throws a localized provider or environment-variable error (`host.ts:282-335`).
3. For local engines, ensure the engine daemon and send a `transcribe` request with engine, Whisper model, language, audio path and hint. A response with `ok: false` throws its message; otherwise missing response text becomes an empty string (`host.ts:336-355`).
4. If non-empty output, after removing commas, periods and whitespace and lowercasing, exactly matches the similarly normalized hint, clear it to reject a recognizer echo. Then run post-processing. Empty final text throws the localized no-speech error (`host.ts:357-370`).
5. For non-empty text, create an outcome with engine, elapsed milliseconds, raw text and processed text; append a JSONL history record with a new ID, timestamp and saved audio path; prune expired recording directories; return the outcome (`host.ts:371-388`).

Cloud key, file-read, request, and adapter failures reject the run before history is written. Local daemon startup/call failures and unsuccessful responses also reject before history. Empty processed text rejects as no speech. Pruning or history append errors propagate and prevent the outcome from returning (`host.ts:282-388`).

### Local daemon startup and socket outcomes

`ensureDaemon` first pings the per-engine socket. An alive daemon ends the path immediately. Otherwise it removes a stale socket path, writes embedded Python assets, and checks that the engine's venv Python exists; a missing interpreter throws the localized engine-missing error. It opens the engine log, spawns `voiced.py` detached with the socket path, idle timeout and Hugging Face telemetry disabled, releases the child from the plugin process, and polls liveness every 250 ms until ready. If the 20-second startup deadline expires, it throws an error containing the daemon log path (`src/daemon.ts:85-144`).

`callDaemon` opens a Unix socket, starts the supplied request timeout, writes one JSON line after connect, and buffers bytes until the first newline. It parses only that first response line and ends the connection on success. Timeout destroys the socket and rejects with `timeout`; JSON parse and socket errors reject the call (`src/daemon.ts:42-82`). Startup errors, socket errors, timeout errors and a daemon `{ ok: false }` response all stop the transcription request before post-processing (`host.ts:336-355`).

### Vocabulary repair stages

`repairTerms` returns the input for an empty/blank vocabulary. Otherwise it scans Unicode letter/number words while keeping each preceding separator and final trailing separator. At each position it tries a two-word window before a one-word window. A two-word candidate needs only spaces or hyphens between words, non-empty consonant skeletons, and no one-character first word; joined candidates use exact skeleton equality. A one-word candidate can use the fuzzy matching rules in `replacement`. On a match, the original separator and canonical vocabulary term are emitted; otherwise the original word and separators pass through (`src/term-repair.ts:177-240`).

`skeleton` lowercases characters, transliterates mapped Cyrillic letters, preserves ASCII Latin, ignores all other characters, removes vowels, folds `c` to `k`, and drops repeated adjacent consonants. A word made only of ignored characters or vowels has an empty skeleton (`src/term-repair.ts:49-71`). `replacement` first classifies the input as mixed script, Cyrillic-only, or without Cyrillic; minimum skeleton lengths are 2, 4, and 3. Only Latin vocabulary terms are candidates. Equal skeletons match directly; fuzzy skeleton similarity of at least 0.75 is allowed only for mixed-script inputs of length at least 3 and only for single-word matching. Inputs without Cyrillic need an additional transliterated similarity of at least 0.5. No candidate yields `null`; among matches, the closest term by character length wins (`src/term-repair.ts:112-168`).

`cleanupText` resolves the language from the text or configured language, applies filler removal and quote normalization according to separate booleans, then always collapses spaces and punctuation spacing (`src/cleanup.ts:11-33`, `src/cleanup.ts:66-75`). `removeFillers` first contracts stretched words, applies every language-specific filler pattern, removes punctuation orphaned at the beginning or beside sentence punctuation, and removes duplicate commas; it returns the transformed text even when no pattern matched (`src/cleanup.ts:35-49`). `fixQuotes` replaces paired straight quotes with the configured open/close style and optional narrow spaces, removes a single remaining unmatched quote, and adds a space after a colon only when the next character is neither whitespace nor a digit (`src/cleanup.ts:51-64`).

### Optional AI pass and guard

`runAiPass` has a no-vocabulary mode that returns the input without a request. Otherwise it builds a correction-only prompt, starts an abort timer, and posts model, zero temperature, a 4096 completion-token ceiling, and the prompt to `/chat/completions`. Non-2xx responses throw; the response must contain a first choice whose message content is a string. Complete and unfinished `<think>` sections are stripped. If that leaves text, it is returned; if it leaves nothing, the original input is returned. The timer is cleared in `finally`, while fetch, timeout, HTTP, JSON, and missing-content errors propagate to the host caller (`src/ai-pass.ts:20-38`, `src/ai-pass.ts:45-49`, `src/ai-pass.ts:51-95`, `src/ai-pass.ts:101-111`).

`guardAiPass` lowercases tokens and normalizes `ё` to `е`, then builds an allowlist from original words, each vocabulary term's words, and each vocabulary phrase with spaces removed. During corrected-text replacement, allowed tokens remain unchanged. For each other token it selects the most similar original word; similarity at least 0.6 restores that original word, while a lower score or an empty original-word list leaves the model token untouched. The host catches an AI-pass or guard error, logs it, and returns deterministic cleanup output (`src/ai-pass-guard.ts:9-54`, `host.ts:211-231`).

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
