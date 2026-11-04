# Optional contextual editing and recorder choice

## Compatibility and defaults

This feature requires **BB 0.48.1+ and SDK 0.6.104+** for composer actions,
atomic draft replacement and keyboard commands. It does not support older BB
versions simply because the new options are disabled.

Existing and fresh installations retain these choices:

- **Recorder: Plugin recorder**, including its existing hotkey settings.
- **AI trigger: Automatically after recording** when AI processing is enabled.
- **Editing mode: Vocabulary terms only** and no custom prompt override.
- AI enablement, models, endpoints, vocabulary and credentials are not changed.

No personal provider profile, recording, key or migration tool is included.

## Speaker-intent mode

Under **Vocabulary → AI post-processing**, choose **Speaker intent** to use the
configured text model for contextual editing, including without a vocabulary:

- restore product/technology names from pronunciation and dictation context;
- remove fillers, repetition and explicit abandoned/self-corrected starts;
- simplify wording without discarding alternatives, constraints or uncertainty;
- preserve questions rather than answering them, and commands rather than executing them;
- preserve the original language, negation, numbers, versions and identifiers.

The default editing instructions are English; that does not request translation
of dictation. Custom instructions are editable/resettable, up to 8000 characters.
Fixed output/non-execution rules stay separate from the transcript/vocabulary
JSON data. These are model instructions, **not semantic guarantees**: review
important text before sending. No chat history is sent to the editor model.

Automatic intent editing receives raw recognition text before heuristic vocabulary
replacement. Strict terms mode retains the vocabulary word guard. Network errors,
empty replies and token-truncated/filtered completions do not replace the full
dictation with a partial result: automatic processing retains ordinary cleanup.

## Fast STT and on-demand Improve

Choose **When to run AI → On demand** to insert STT plus ordinary cleanup first,
without waiting for a text-model request. Press **Improve** or use the rebindable
**Voice Input: Improve last dictation** command (default Mod+Shift+U).

Only the latest dictated fragment is sent/edited, not the whole draft or chat.
If that fragment changes during processing, an **Apply / Keep my text** preview
requires confirmation. **Undo improvement** restores just the replaced fragment.
Unrelated text and attachments survive; mention ranges after the fragment are
rebased, and fragments overlapping mention pills are not edited.

Clearing, submitting, a new dictation, recorder/AI-mode changes or reloading the
client invalidates old tracking/results. Tracking is in memory. The compact
composer exposes Improve in a banner. Explicit model failures leave text intact
and show a retryable error rather than a fake successful rewrite.

## Optional native BB microphone

In **Dictation → Recorder**, select **BB native microphone**. This is opt-in;
switching back restores the plugin recorder/hotkey panels and keeps their saved
values. A confirmed change cancels an active plugin recording/transcription.
Finish a recording before switching if its audio must be kept.

Native mode does not mount the plugin's microphone click interception, floating
recording bar or push-to-talk handlers. BB owns device selection, recording,
cancel/stop/send and recording shortcuts. The text model and STT configuration
remain the same. In BB's voice service picker, explicitly select this plugin's
**Voice input on the BB machine** service to use these models; choosing the native
recorder does not silently replace the globally selected voice service.

Use native **Stop and add to draft** for manual Improve. Native **Send voice input**
submits immediately, so no editable fragment remains for manual post-processing.
AI automatic mode still runs before native insertion/submission when enabled.

For native manual editing, a read-only observer matches a recent draft insertion
to a short-lived receipt `{id, hash, length}`. Realtime carries neither audio nor
transcript, though digest and length are metadata, not an anonymization guarantee.
The bridge never duplicates native insertion or takes over recording. If matching
is ambiguous/expired, Improve is not enabled rather than rewriting unrelated text.

## Verification and limitations

```sh
npm ci
npm run typecheck
npm test
npm run test:ui
npm run build
TMPDIR=/tmp/opencode npm run test:host
npm run test:server
```

Tests use synthetic transcripts, deferred requests, DOM/SDK harnesses and mocked
providers. They cover both recorder modes, settings migration, safe replacements,
Undo, delayed draft publication, matching receipts and failure fallback. They do
not constitute real-device recording checks. Test microphone permissions/devices,
mode switching and important dictation on supported browsers before release.

PR #3's silence/preview/auto-send features and PR #4's recorder session isolation
are separate work. This branch does not copy either PR wholesale. Their shared
frontend/host changes must be reconciled and retested according to merge order.
