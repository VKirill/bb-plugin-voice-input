/** Match the normalization performed by BB's native voice recorder. */
export function normalizeNativeTranscript(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export type NativeTranscriptReceipt = { id: string; hash: string; length: number };

export async function nativeTranscriptReceipt(id: string, text: string): Promise<NativeTranscriptReceipt> {
  const normalized = normalizeNativeTranscript(text);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return { id, hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), length: normalized.length };
}
