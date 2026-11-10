# Changelog

- 2026-10-28 lprun_bb823429433148dc8130e115903999a2: The Windows BB app now picks its own dictation shortcut (default Right Ctrl, stored in `hotkeyWin*` settings) independently of the macOS shortcut (voice-hotkey-windows-2; commit: see git log)
- 2026-11-10 lprun_4c7ba30c82064d408452ba865c6fd345: Clamp transcription prompt to OpenAI's 896-character limit (openai-prompt-limit)
- 2026-11-10 lprun_4c7ba30c82064d408452ba865c6fd345: Clamp transcription prompt to OpenAI's 896-character limit; Recognition prompt comes only from the vocabulary (openai-prompt-limit, vocab-only-hint)
- 2026-11-10 lprun_4c7ba30c82064d408452ba865c6fd345: Clamp transcription prompt to OpenAI's 896-character limit; Cloud errors name the real provider; CLI uses the configured machine; Recognition prompt comes only from the vocabulary (openai-prompt-limit, provider-label-cli-machine, vocab-only-hint)
