import { idsToText, joinPieces, tokenTable } from './ctc';

const table = tokenTable({ 0: '<unk>', 1: '▁ক', 2: 'াৰ', 3: '▁গ', 4: '<blank>' });

test('pieces become text: "▁" starts a word, special tokens are dropped', () => {
  expect(idsToText([1, 2, 3, 0, 4], table)).toBe('কাৰ গ');
  expect(idsToText([], table)).toBe('');
});

test('the pieces of a clip join with a space; confidence is weighted by token count', () => {
  const joined = joinPieces(
    [
      { ids: [1, 2], confidence: 0.9 },
      { ids: [], confidence: 0 },
      { ids: [3], confidence: 0.6 },
    ],
    table,
  );
  expect(joined.text).toBe('কাৰ গ');
  expect(joined.confidence).toBeCloseTo(0.8);
});

test('the shipped Assamese token table matches the model: 256 language tokens + blank', () => {
  const tokens = require('@/models/data/indicconformer-as-int8.tokens.json') as Record<string, string>;
  const t = tokenTable(tokens);
  expect(t[0]).toBe('<unk>');
  expect(t[5632]).toBe('<blank>');
  expect(Object.keys(tokens)).toHaveLength(257);
});
