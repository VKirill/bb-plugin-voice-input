## Now
- BB Voice Input is a BB plugin that records speech in the chat UI and transcribes it on a recognition host via local Whisper/GigaAM or cloud Groq/OpenAI/Google, with vocabulary prompting, deterministic cleanup, optional AI correction, and insertion into the original composer draft.
- Push-to-talk dictation fires from a configurable keyboard shortcut; macOS and the Windows BB app each keep their own shortcut (Windows default Right Ctrl stored in `hotkeyWin*` settings, macOS keeps Right Option) since 0.2.13.
- Local engines run in isolated Python virtual environments on the recognition host; the host manages provider keys, engine setup/status, transcription history, and model downloads.
- The settings page and recording controls are localized in eight languages and follow the BB interface language in auto mode; the speech language of a request can differ from the saved configuration.

## Blocked
- none

## Next
- [ ] none captured — new ideas go to .agents/todos/

## Last verify
- command: npm run typecheck && node --test tests/hotkey.test.ts tests/settings.test.ts tests/dictionary-completeness.test.ts
- result: green (typecheck clean, 21/21 tests pass)
- when: 2026-10-28

## Pointers
- Plans: .agents/plans/items/voice-hotkey-windows-2 (done 2026-10-28), .agents/plans/items/voice-hotkey-windows (earlier draft of the same idea, superseded)
- Run artifacts: .agents/runs/lprun_bb823429433148dc8130e115903999a2/artifacts/voice-hotkey-windows-2
- Open todos: none (.agents/todos/ does not exist yet)
- Changelog: .agents/CHANGELOG.md
