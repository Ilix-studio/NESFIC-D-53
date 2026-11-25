import { packVoiceprint, unpackVoiceprint } from './voiceprint';

test('a 256-value voiceprint packs into well under 2048 characters and back', () => {
  const values = Array.from({ length: 256 }, (_, i) => Math.sin(i) / 16);
  const packed = packVoiceprint(values);
  expect(packed.length).toBe(1368);
  unpackVoiceprint(packed).forEach((v, i) => expect(v).toBeCloseTo(values[i], 6));
});
