---
title: Dictation
type: component
created: 2026-10-01
updated: 2026-10-30
status: active
confidence: high
tags: [dictation, browser, composer]
sources:
  - src/frontend/voice-interceptor.ts
  - src/frontend/global-voice-session.ts
  - src/frontend/hotkey.ts
  - src/settings-store.ts
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
2. A click or configured key records the origin thread/new-thread target, composer caret, and up to 500 characters of prompt context (`src/frontend/voice-interceptor.ts:96-146`, `src/frontend/voice-interceptor.ts:239-253`).
3. The global session asks for microphone access and records with `MediaRecorder`; supported MIME types are tried in WebM/Opus, WebM, MP4, Ogg/Opus, WAV order (`src/frontend/global-voice-session.ts:41-58`, `src/frontend/global-voice-session.ts:212-275`).
4. A stop action waits for recorder stop or a 1.5-second safety timer, then encodes audio as base64 and calls the injected transcribe function or plugin RPC (`src/frontend/global-voice-session.ts:338-418`).
5. On success, the transcript is inserted at the live or remembered caret. If the user navigated away, the original draft in localStorage is updated, BB is navigated back to the target, and the live editor is repaired after a 350 ms delay if needed (`src/frontend/global-voice-session.ts:511-565`).
6. Audio tracks, timers, the analyser, and the wake lock are released on completion or cancellation (`src/frontend/global-voice-session.ts:567-606`).

### Global session states and outcomes

`GlobalVoiceSession` owns one cached snapshot (`idle`, `recording`, `transcribing`, or `error`), media resources, target, and subscribers. `startRecording` refuses while recording/transcribing; otherwise it resets chunks and asks for microphone access, chooses the first supported MIME type, creates a recorder and optional analyser, and starts duration/level updates. Permission or recorder failures clean resources, set an error, and return to idle. `stopAndTranscribe` only acts from recording, waits for recorder stop or 1.5 seconds, then rejects captures under 500 ms or without chunks. It calls an injected transcriber when available, otherwise the browser RPC with a 60-second abort; successful non-empty text goes to draft delivery, while a failed/empty response or exception returns idle and shows an error toast (`src/frontend/global-voice-session.ts:107-153`, `src/frontend/global-voice-session.ts:214-337`, `src/frontend/global-voice-session.ts:340-457`).

### Session lifecycle, modes, and outcomes

1. `GlobalVoiceSession` keeps a cached snapshot and media state; subscribers receive a new snapshot when `updateSnapshot` shallow-merges a patch. `startRecording` refuses while already recording or transcribing, then clears chunks and exposes the recording state before requesting microphone access (`src/frontend/global-voice-session.ts:107-153`, `src/frontend/global-voice-session.ts:214-226`).
2. A successful microphone request configures noise/echo processing, chooses the first supported recorder MIME type, creates an optional analyser, starts `MediaRecorder` in 250 ms chunks, and updates elapsed time and five frequency levels every 200 ms. Screen wake lock is requested only while the page is visible and support is present (`src/frontend/global-voice-session.ts:228-319`).
3. A recorder error releases audio resources, sets an error and returns to idle. A rejected microphone request also returns false and idle; `NotAllowedError`/`SecurityError` maps to permission denied, `NotFoundError` maps to microphone missing, and other errors use their message (`src/frontend/global-voice-session.ts:270-275`, `src/frontend/global-voice-session.ts:320-337`).
4. `stopAndTranscribe` acts only from recording, switches to transcribing, and waits for the recorder's stop event or a 1.5-second safety timeout. It then releases audio resources; captures under 500 ms or with no chunks are discarded, target is cleared, and a too-short toast is shown (`src/frontend/global-voice-session.ts:340-379`).
5. For a usable capture, chunks become a Blob and base64. A supplied function wins over the session function; if neither exists, the session posts to plugin RPC with a 60-second abort. A nested RPC `result` is unwrapped; success requires `ok === true` and non-empty trimmed text (`src/frontend/global-voice-session.ts:381-431`).
6. A successful result goes to draft delivery. A non-success or empty response clears state and reports the returned error or generic recognition message; thrown errors clear state too, with aborts reported as timeout (`src/frontend/global-voice-session.ts:439-456`, `src/frontend/global-voice-session.ts:514-568`).

The session snapshot modes are `idle`, `recording`, `transcribing`, and `error`; the class uses `error` to type the snapshot, while microphone failures set a message and return the state to `idle`. A result or failed request also returns to `idle` (`src/frontend/global-voice-session.ts:16-33`, `src/frontend/global-voice-session.ts:270-275`, `src/frontend/global-voice-session.ts:439-455`).

### Hotkey defaults and matching

Platform detection searches User-Agent Client Hints, `navigator.platform`, then user-agent text for Windows or Mac; unmatched or absent values resolve to `other`. The non-Windows default is enabled `AltRight` with all extra modifiers false; Windows defaults to enabled `ControlRight` with all extra modifiers false (`src/frontend/hotkey.ts:18-53`). Settings parsing uses the platform's separate field family; absent or invalid code values fall back to that platform default. The Windows preset list is right/left Ctrl, right/left Alt, Caps Lock and F8; the other list is right/left Option, right/left Command and left Control (`src/frontend/hotkey.ts:65-80`, `src/frontend/hotkey.ts:108-180`).

`eventMatchesHotkey` first requires an enabled non-empty code and matching code (on macOS left/right Control are one family). A configured modifier is required unless it is the trigger key itself; for non-modifier keys, any unconfigured Alt/Ctrl/Shift/Meta modifier rejects the event. Thus modifier triggers can be used alone, while letter/F-key shortcuts require their exact configured modifier combination (`src/frontend/hotkey.ts:207-263`).

### Interceptor mounting and teardown

`mountVoiceInputInterceptor` installs delegated pointer/click and keyboard handlers, reads UI language and hotkey settings, and subscribes to session changes. Microphone events are prevented and debounced for 350 ms; hotkey events are ignored during settings capture/repeat, and nonmatching keys interrupt a pending/held push-to-talk state. Session updates create or remove the recording bar, synchronize it to the current prompt box or a floating position, and start/stop the waveform. The returned disposer removes listeners, restores patched history methods, unsubscribes observers, and clears timers/animation resources (`src/frontend/voice-interceptor.ts:188-252`, `src/frontend/voice-interceptor.ts:268-349`, `src/frontend/voice-interceptor.ts:396-407`, `src/frontend/voice-interceptor.ts:526-604`, `src/frontend/voice-interceptor.ts:854-908`).

Mounting also starts language loading/observation, reads published hotkey configuration, and issues a best-effort state RPC to replace it with saved platform settings when available. Mic events are accepted only when `findVoiceButton` finds a voice-labelled, marked, or recognized microphone-SVG button inside the prompt box; events inside the plugin recording bar are excluded. The handler stops propagation, ignores a duplicate trigger within 350 ms, remembers the composer caret, and toggles the session (`src/frontend/voice-interceptor.ts:25-95`, `src/frontend/voice-interceptor.ts:189-193`, `src/frontend/voice-interceptor.ts:238-253`, `src/frontend/voice-interceptor.ts:269-271`, `src/frontend/voice-interceptor.ts:362-379`).

For hotkeys, repeat events and active settings capture are ignored. A nonmatching key interrupts holding/pending; a matching hotkey in a typing target may be ignored by `shouldIgnoreTypingTarget`; accepted key events feed `pttKeyDown`/`pttKeyUp`, and actions start only from idle, stop only from recording, or cancel only a recording session. Window blur uses the same interruption path. Disposal removes the listeners, clears PTT timers, restores history methods, unsubscribes observers, removes the bar, and stops animation/synchronization timers (`src/frontend/voice-interceptor.ts:274-350`, `src/frontend/voice-interceptor.ts:394-409`, `src/frontend/voice-interceptor.ts:856-909`).

### Push-to-talk key-down transition

`pttKeyDown` maps a latched state to idle plus `stop`; a second key-down while pending and within 420 ms changes to latched with no action; key-down while holding is ignored; otherwise it enters holding and emits `start` (`src/frontend/hotkey.ts:360-374`). `pttKeyUp` ignores latched/non-holding states, stops a hold lasting at least 280 ms, and turns a shorter hold into pending with a 420 ms timer (`src/frontend/hotkey.ts:376-392`). When that timer expires in pending at or after `stopAt`, `pttTimerFired` resets to idle and emits `cancel`. A different key or window blur resets holding/pending and emits cancel, while latched and idle states are left alone (`src/frontend/hotkey.ts:398-415`, `src/frontend/voice-interceptor.ts:313-319`, `src/frontend/voice-interceptor.ts:394-405`).

## Modes

| Trigger/state | Behavior | Evidence |
|---|---|---|
| Composer mic click | Stops the original button event and toggles start/stop; duplicate triggers within 350 ms are ignored (`src/frontend/voice-interceptor.ts:239-253`). | `src/frontend/voice-interceptor.ts:239-253` |
| Hold hotkey | Press starts recording; release after 280 ms stops it. A short release enters a pending state for 420 ms (`src/frontend/hotkey.ts:4-8`, `src/frontend/hotkey.ts:360-392`). | `src/frontend/hotkey.ts:360-392` |
| Double tap / latched | A second press while pending and within 420 ms latches without another action; a press in latched resets state and emits stop (`src/frontend/hotkey.ts:360-374`). | `src/frontend/hotkey.ts:360-374` |
| Short tap / cancel | If the timer fires at or after `stopAt` while pending, state resets and emits cancel. A different key or blur cancels holding/pending; idle and latched are unchanged (`src/frontend/hotkey.ts:398-415`, `src/frontend/voice-interceptor.ts:313-319`, `src/frontend/voice-interceptor.ts:394-405`). | `src/frontend/hotkey.ts:398-415` |
| Cancel | Clears captured chunks and resets state without submitting audio (`src/frontend/global-voice-session.ts:567-571`). | `src/frontend/global-voice-session.ts:567-571` |
| Target remains open | Inserts into the current composer and persists the matching draft text (`src/frontend/global-voice-session.ts:514-525`, `src/frontend/global-voice-session.ts:557-564`). | `src/frontend/global-voice-session.ts:514-564` |
| User navigated away | Updates the origin draft, returns to its route/thread, then reconciles the editor (`src/frontend/global-voice-session.ts:526-555`). | `src/frontend/global-voice-session.ts:526-555` |

Microphone clicks and hotkey actions share `toggleVoiceRecording`: a recording stops and transcribes; an idle session resolves the current composer target and starts. Calls while the session is transcribing do not start another capture (`src/frontend/voice-interceptor.ts:148-155`, `src/frontend/global-voice-session.ts:212-215`).

## Business rules

- Only a microphone control located in or explicitly marked for the prompt box is intercepted; the recording panel's own buttons are excluded (`src/frontend/voice-interceptor.ts:33-49`).
- Hotkey platform detection checks User-Agent Client Hints, `navigator.platform`, and user agent text. Windows reads and writes its own `hotkeyWin*` settings and defaults to right Control; macOS and other platforms use `hotkey*` settings and default to right Option. Windows presets are right/left Ctrl, right/left Alt, Caps Lock, and F8; the macOS preset set is right/left Option, right/left Command, and left Control (`src/frontend/hotkey.ts:26-80`, `src/frontend/hotkey.ts:149-205`).
- Hotkey state has four modes: `idle`, `holding`, `pending`, and `latched`. A press starts immediately; release before 280 ms waits 420 ms for a second press, and timeout cancels the capture without recognition. Release after 280 ms stops. A second press within the pending window latches recording; pressing again while latched stops (`src/frontend/hotkey.ts:4-8`, `src/frontend/hotkey.ts:360-415`).
- A configured hotkey is ignored in input, textarea, select, or contenteditable targets only when its code is non-modifier, it has no Alt, Control, or Meta modifier, and it is not an F-key; Shift alone does not bypass this check (`src/frontend/hotkey.ts:317-330`).
- The configured hotkey handler returns without acting while the settings page captures a key or the browser marks the event as a repeat (`src/frontend/voice-interceptor.ts:319-322`).
- The settings page's key capture ends after 8 seconds; Escape cancels, Tab is ignored, and repeated keydown events are skipped (`app.tsx:369-394`).
- Composer insertion trims the transcript, clamps the requested offset to the current draft length, and adds a separating space next to non-whitespace text (`src/frontend/composer-insert.ts:22-43`).
- A session cannot start while recording or transcribing (`src/frontend/global-voice-session.ts:212-215`).
- Captures shorter than 500 ms or with no recorded chunks are discarded (`src/frontend/global-voice-session.ts:373-377`).
- After `updateSettings` resolves successfully, `save` publishes hotkey configuration only if the patch contains a hotkey setting; a failed RPC shows a toast and skips that publish (`app.tsx:516-544`).

## Public API

| Export / integration | File | Purpose |
|---|---|---|
| `mountVoiceInputInterceptor({ signal })` | `src/frontend/voice-interceptor.ts:189-253` | Installs delegated microphone and hotkey listeners and the recording UI. |
| `globalVoiceSession` / `GlobalVoiceSession` | `src/frontend/global-voice-session.ts:105-164`, `src/frontend/global-voice-session.ts:609-610` | Page-level recording state and lifecycle. |
| `VoiceHotkeyConfig`, `detectHotkeyPlatform`, `hotkeyFromSettings`, `hotkeyToSettings`, `pttKeyDown`, `pttKeyUp` | `src/frontend/hotkey.ts:9-24`, `src/frontend/hotkey.ts:44-53`, `src/frontend/hotkey.ts:149-205`, `src/frontend/hotkey.ts:345-392` | Platform-specific hotkey config conversion and push-to-talk state transitions. |
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
