// Token ids -> text for the IndicConformer engines. Typed port of the server's
// src/services/asr/ctc.js (keep the two in step). On the phone, greedy CTC decoding and
// chunking run natively in modules/voicedar-asr (VoicedarAsrModule.kt).

/** Turns a token map ({ "0": "<unk>", "1": "▁ক", ... }) into an array indexed by id. */
export function tokenTable(tokens: Record<string, string>): string[] {
  const table: string[] = [];
  for (const [id, piece] of Object.entries(tokens)) table[Number(id)] = piece;
  return table;
}

/** SentencePiece pieces to text: "▁" starts a word. Unknown and special tokens are dropped. */
export function idsToText(ids: number[], table: string[]): string {
  let text = '';
  for (const id of ids) {
    const piece = table[id];
    if (!piece || piece.startsWith('<')) continue;
    text += piece.replaceAll('▁', ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Joins the pieces of one clip; confidence is weighted by the number of tokens. */
export function joinPieces(pieces: { ids: number[]; confidence: number }[], table: string[]): { text: string; confidence: number } {
  let weighted = 0;
  let tokens = 0;
  const texts: string[] = [];
  for (const p of pieces) {
    texts.push(idsToText(p.ids, table));
    weighted += p.confidence * p.ids.length;
    tokens += p.ids.length;
  }
  return { text: texts.filter(Boolean).join(' '), confidence: tokens ? weighted / tokens : 0 };
}
