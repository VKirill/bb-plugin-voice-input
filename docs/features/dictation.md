---
title: Dictation
type: component
created: 2026-10-01
updated: 2026-10-27
status: active
confidence: high
tags: [dictation, browser, composer]
sources:
  - src/frontend/voice-interceptor.ts
  - src/frontend/global-voice-session.ts
  - src/frontend/hotkey.ts
  - src/frontend/composer-insert.ts
  - app.tsx
  - server.ts
---
# Dictation

TL;DR: Dictation captures microphone audio in a page-level session, sends it to the configured recognition host, then inserts the transcript into the original BB composer draft (`src/frontend/global-voice-session.ts:105-164`, `src/frontend/global-voice-session.ts:511-565`).

## Purpose

Dictation adds a recording panel and hotkey control to BB's composer. The singleton session survives composer unmounts and page navigation because it is created at module scope (`src/frontend/global-voice-session.ts:1-3`, `src/frontend/global-voice-session.ts:609-610`).

## How it works

1. `mountVoiceInputInterceptor` listens for composer microphone events; `findVoiceButton` requires a voice label, data attribute, or microphone SVG inside a prompt box (`src/frontend/voice-interceptor.ts:23-94`, `src/frontend/voice-interceptor.ts:187-249`).
2. A click or configured key records the origin thread/new-thread target, composer caret, and up to 500 characters of prompt context (`src/frontend/voice-interceptor.ts:96-146`, `src/frontend/voice-interceptor.ts:234-249`).
3. The global session asks for microphone access and records with `MediaRecorder`; supported MIME types are tried in WebM/Opus, WebM, MP4, Ogg/Opus, WAV order (`src/frontend/global-voice-session.ts:41-58`, `src/frontend/global-voice-session.ts:212-275`).
4. A stop action waits for recorder stop or a 1.5-second safety timer, then encodes audio as base64 and calls the injected transcribe function or plugin RPC (`src/frontend/global-voice-session.ts:338-418`).
5. On success, the transcript is inserted at the live or remembered caret. If the user navigated away, the original draft in localStorage is updated, BB is navigated back to the target, and the live editor is repaired after a 350 ms delay if needed (`src/frontend/global-voice-session.ts:511-565`).
6. Audio tracks, timers, the analyser, and the wake lock are released on completion or cancellation (`src/frontend/global-voice-session.ts:567-606`).

### Global session states and outcomes

`GlobalVoiceSession` owns one cached snapshot (`idle`, `recording`, `transcribing`, or `error`), media resources, target, and subscribers. `startRecording` refuses while recording/transcribing; otherwise it resets chunks and asks for microphone access, chooses the first supported MIME type, creates a recorder and optional analyser, and starts duration/level updates. Permission or recorder failures clean resources, set an error, and return to idle. `stopAndTranscribe` only acts from recording, waits for recorder stop or 1.5 seconds, then rejects captures under 500 ms or without chunks. It calls an injected transcriber when available, otherwise the browser RPC with a 60-second abort; successful non-empty text goes to draft delivery, while a failed/empty response or exception returns idle and shows an error toast (`src/frontend/global-voice-session.ts:107-153`, `src/frontend/global-voice-session.ts:214-337`, `src/frontend/global-voice-session.ts:340-457`).

### Interceptor mounting and teardown

`mountVoiceInputInterceptor` installs delegated pointer/click and keyboard handlers, reads UI language and hotkey settings, and subscribes to session changes. Microphone events are prevented and debounced for 350 ms; hotkey events are ignored during settings capture/repeat, and nonmatching keys interrupt a pending/held push-to-talk state. Session updates create or remove the recording bar, synchronize it to the current prompt box or a floating position, and start/stop the waveform. The returned disposer removes listeners, restores patched history methods, unsubscribes observers, and clears timers/animation resources (`src/frontend/voice-interceptor.ts:188-252`, `src/frontend/voice-interceptor.ts:268-349`, `src/frontend/voice-interceptor.ts:396-407`, `src/frontend/voice-interceptor.ts:526-604`, `src/frontend/voice-interceptor.ts:854-908`).

### Push-to-talk key-down transition

`pttKeyDown` maps `latched` to `stop` and a fresh idle/pending state to `holding` plus `start`; a second key-down in `pending` within 420 ms changes to `latched` without another action. Key-down while already `holding` is ignored. Thus timeout/interruption cancellation is handled by the companion timer/interruption functions, not by this transition (`src/frontend/hotkey.ts:231-245`, `src/frontend/hotkey.ts:269-285`).

## Modes

| Trigger/state | Behavior | Evidence |
|---|---|---|
| Composer mic click | Stops the original button event and toggles start/stop; duplicate triggers within 350 ms are ignored (`src/frontend/voice-interceptor.ts:234-249`). | `src/frontend/voice-interceptor.ts:234-249` |
| Hold hotkey | Press starts recording; release after 280 ms stops it. A short release enters a pending state for 420 ms (`src/frontend/hotkey.ts:6-8`, `src/frontend/hotkey.ts:231-262`). | `src/frontend/hotkey.ts:231-262` |
| Double tap / latched | A second press within 420 ms latches recording; another press stops it (`src/frontend/hotkey.ts:231-245`). | `src/frontend/hotkey.ts:231-245` |
| Short tap / cancel | If no second press arrives during the pending interval, the recording is cancelled without transcription. Another key or window blur cancels a holding or pending recording; a latched recording is unaffected (`src/frontend/hotkey.ts:269-285`). | `src/frontend/hotkey.ts:269-285` |
| Cancel | Clears captured chunks and resets state without submitting audio (`src/frontend/global-voice-session.ts:567-571`). | `src/frontend/global-voice-session.ts:567-571` |
| Target remains open | Inserts into the current composer and persists the matching draft text (`src/frontend/global-voice-session.ts:514-525`, `src/frontend/global-voice-session.ts:557-564`). | `src/frontend/global-voice-session.ts:514-564` |
| User navigated away | Updates the origin draft, returns to its route/thread, then reconciles the editor (`src/frontend/global-voice-session.ts:526-555`). | `src/frontend/global-voice-session.ts:526-555` |

Microphone clicks and hotkey actions share `toggleVoiceRecording`: a recording stops and transcribes; an idle session resolves the current composer target and starts. Calls while the session is transcribing do not start another capture (`src/frontend/voice-interceptor.ts:148-155`, `src/frontend/global-voice-session.ts:212-215`).

## Business rules

- Only a microphone control located in or explicitly marked for the prompt box is intercepted; the recording panel's own buttons are excluded (`src/frontend/voice-interceptor.ts:33-49`).
- The default hotkey is right Option (`AltRight`) with no additional modifiers; presets include left Option, left/right Command, and Control (`src/frontend/hotkey.ts:18-43`).
- Hotkey state has four modes: `idle`, `holding`, `pending`, and `latched`. A press starts immediately; release before 280 ms waits 420 ms for a second press, and timeout cancels the capture without recognition. Release after 280 ms stops. A second press within the pending window latches recording; pressing again while latched stops (`src/frontend/hotkey.ts:4-8`, `src/frontend/hotkey.ts:227-285`).
- Non-modifier hotkeys without Alt, Control, or Command are ignored in input, textarea, select, and contenteditable targets; modifier-only and function-key bindings bypass that typing-target check (`src/frontend/hotkey.ts:188-202`).
- The configured hotkey handler returns without acting while the settings page captures a key or the browser marks the event as a repeat (`src/frontend/voice-interceptor.ts:319-322`).
- The settings page's key capture ends after 8 seconds; Escape cancels, Tab is ignored, and repeated keydown events are skipped (`app.tsx:356-381`).
- Composer insertion trims the transcript, clamps the requested offset to the current draft length, and adds a separating space next to non-whitespace text (`src/frontend/composer-insert.ts:22-43`).
- A session cannot start while recording or transcribing (`src/frontend/global-voice-session.ts:212-215`).
- Captures shorter than 500 ms or with no recorded chunks are discarded (`src/frontend/global-voice-session.ts:373-377`).
- After `updateSettings` resolves successfully, `app.tsx` publishes hotkey configuration only when the saved patch includes a hotkey field (`app.tsx:498-517`).

## Public API

| Export / integration | File | Purpose |
|---|---|---|
| `mountVoiceInputInterceptor({ signal })` | `src/frontend/voice-interceptor.ts:187-246` | Installs delegated microphone and hotkey listeners and the recording UI. |
| `globalVoiceSession` / `GlobalVoiceSession` | `src/frontend/global-voice-session.ts:105-164`, `src/frontend/global-voice-session.ts:609-610` | Page-level recording state and lifecycle. |
| `VoiceHotkeyConfig`, `hotkeyFromSettings`, `pttKeyDown`, `pttKeyUp` | `src/frontend/hotkey.ts:9-25`, `src/frontend/hotkey.ts:86-107`, `src/frontend/hotkey.ts:231-278` | Hotkey config conversion and push-to-talk state transitions. |
| Composer insertion helpers | `src/frontend/composer-insert.ts:4-5`, `src/frontend/composer-insert.ts:22-44`, `src/frontend/composer-insert.ts:140-157` | Locate the editor and insert transcript text at an offset. |
| `toggleVoiceRecording` | `src/frontend/voice-interceptor.ts:148-155` | Starts the current target from idle or stops an active recording for transcription. |

## Gotchas

- The target and caret are remembered before navigation; transcript placement falls back to the remembered position when the original editor is not mounted (`src/frontend/composer-insert.ts:7-20`, `src/frontend/composer-insert.ts:88-94`).
- The session's browser fallback request uses a 60-second abort timer, while the server's host transcription timeout is 10 minutes. The fallback timer can end the browser wait first (`src/frontend/global-voice-session.ts:390-410`, `server.ts:31-37`).
- Permission denial, missing microphone, recorder errors, empty recognition results, and request errors return the session to idle and show a toast (`src/frontend/global-voice-session.ts:268-273`, `src/frontend/global-voice-session.ts:318-334`, `src/frontend/global-voice-session.ts:436-452`).

## Failures

- If browser microphone access fails, the session cleans up, returns to `idle`, sets an error message, and shows a toast (`src/frontend/global-voice-session.ts:318-334`).
- If recording errors, the stream is cleaned up and the state returns to `idle` (`src/frontend/global-voice-session.ts:268-273`).
- If capture is shorter than 500 ms or has no chunks, it is discarded without transcription (`src/frontend/global-voice-session.ts:373-377`).
- If transcription fails, returns no text, or the request times out, the session returns to `idle` and shows an error toast (`src/frontend/global-voice-session.ts:427-452`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Architecture](../architecture.md)
- [BB Voice Input — Overview](../overview.md)
