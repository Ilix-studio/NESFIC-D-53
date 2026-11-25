// The voiceprint as compact text for expo-secure-store, whose values should stay under 2048 bytes:
// 256 float32 values = 1024 bytes = 1368 base64 characters (JSON numbers would be about 5 KB).
export function packVoiceprint(values: number[]): string {
  const bytes = new Uint8Array(Float32Array.from(values).buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function unpackVoiceprint(text: string): number[] {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return Array.from(new Float32Array(bytes.buffer));
}
