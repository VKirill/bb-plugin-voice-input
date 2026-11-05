---
title: Optional contextual editing and safe dictation
status: active
updated: 2026-11-05
tags: [dictation, ai, composer]
---

# Optional contextual editing and safe dictation

Requires **BB 0.48.1+ / Plugin SDK 0.6.104+**, including when the new options are disabled.

## Defaults and privacy

Existing engines, endpoints, keys, vocabulary, retention and hotkeys are preserved. AI editing keeps its existing enablement and defaults to automatic, vocabulary-only processing. Stop-on-silence and auto-send default to off.

The text model receives only the dictated fragment and vocabulary. The complete composer draft and chat history are not sent. No native transcript digest is broadcast. The editor uses the configured OpenAI-compatible endpoint and can incur provider charges.

> [!IMPORTANT]
> Intent preservation is a model instruction, not a semantic guarantee. Review important text. Automatic sending is skipped whenever enabled AI editing uses on-demand or intent mode.

## Speaker-intent editing

Under **Vocabulary → AI post-processing**, select **Speaker intent** to restore names from pronunciation/context, remove disfluencies and resolve explicit self-corrections. Instructions preserve language, questions, uncertainty, negation, constraints, numbers and identifiers. The model edits rather than answering questions or executing commands.

The English default instructions are editable/resettable, up to 8000 characters. Transcript and vocabulary are separate JSON data. Intent mode receives raw STT before heuristic vocabulary repair. Terms mode retains the word guard.

HTTP failures, empty/reasoning-only responses, and truncated/filtered completions retain ordinary cleanup in automatic processing. An explicit Improve failure leaves the draft unchanged.

## Improve and Undo

Choose **When to run AI → On demand** for immediate STT plus ordinary cleanup. **Improve** and its rebindable command (Mod+Shift+U) edit only the latest dictated fragment.

If that fragment changes during processing, **Apply / Keep my text** requires a decision. Undo restores only the replaced fragment. Unrelated text and attachments survive; following mention ranges are rebased. A fragment overlapping a mention is rejected.

Submit, clear, a new dictation and editor setting changes invalidate tracking/results. Tracking is in memory and disappears on client reload. The compact composer offers Improve in a banner. A safe fallback can insert into the original persisted draft; it never auto-sends through an unrelated editor.

## Stop on silence and automatic sending

Dictation offers **Stop on silence** after 1, 1.5, 2, 2.5, 3 or 5 seconds. It arms after detected speech; holding push-to-talk suppresses stopping. Detection depends on browser microphone processing and room noise.

Auto-send uses the SDK handle captured when recording starts. It validates composer identity, project/model selection, route, the complete inserted draft, mentions, attachments and recording generation. A changed/unmounted target, pending uploads, unknown AI settings, cancellation or disabling auto-send prevents submission. Skipped submission leaves a draft. Changing a new-thread destination before insertion rejects delivery.

The daemon answers pings during inference, retains a busy socket, and owns cleanup. A shutdown client never removes a replacement daemon's socket.

## Deferred proposals

Repeated live-preview inference and native BB recorder selection are not included. They require separate performance and explicit recording/composer correlation work. No digest-only heuristic claims the provenance of typed text.

## Verification

Run npm ci, npm run typecheck, npm test, npm run test:ui, npm run build, npm run test:host and npm run test:server. Tests cover stale microphone/recorder/result callbacks, final chunks, socket replacement, draft-bound submission, edits/Undo, mentions, attachments, localization and model-failure fallback. Browser/device checks complement synthetic regressions.
