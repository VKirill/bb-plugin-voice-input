/** BB 0.43 registers voice with `kinds`; 0.44+ requires `transcribe()`. */

export type VoiceTranscribeFn = (
  audio: File,
  options: { hint: string | null },
) => Promise<string>;

export function registerCompatibleAiService(
  register: (declaration: Record<string, unknown>) => unknown,
  args: { id: string; displayName: string; transcribe: VoiceTranscribeFn },
): void {
  const { id, displayName, transcribe } = args;
  const attempts: Record<string, unknown>[] = [
    { id, displayName, kinds: ["voice"], transcribe },
    { id, displayName, transcribe },
    { id, displayName, kinds: ["voice"] },
  ];
  let lastError: unknown;
  for (const declaration of attempts) {
    try {
      register(declaration);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
