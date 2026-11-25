// UUID v7 (RFC 9562): 48-bit millisecond timestamp + random bits. Ids made on the phone sort
// by creation time and are used by the server for idempotent sync (OFFLINE-PLAN rule 12).
function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

let lastMs = 0;
let counter = 0;

export function uuidv7(now = Date.now()): string {
  // Keep ids made in the same millisecond in creation order (12-bit counter in rand_a).
  counter = now === lastMs ? (counter + 1) & 0xfff : 0;
  lastMs = now;
  const b = randomBytes(16);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = 0x70 | (counter >> 8);
  b[7] = counter & 0xff;
  b[8] = 0x80 | (b[8] & 0x3f);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
