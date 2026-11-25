/**
 * @jest-environment node
 */
import { answerFollowup, confirmFields, editField, openCase, signCase } from '@/case/commands';
import { uuidv7 } from '@/utils/uuid';
import { migrate } from './database';
import { Repo } from './repo';
import { openTestDb } from './test-db';

const NOW = '2026-11-23T15:44:00.000Z';
const officer = { name: 'Test IO', badgeNo: 'T-1', policeStation: 'Test PS', district: 'Kamrup (Metro)' };

async function setup() {
  const db = openTestDb();
  await migrate(db);
  return { db, repo: new Repo(db) };
}

test('a new case is saved with its fields, audit event and outbox rows in order', async () => {
  const { repo } = await setup();
  const change = openCase({ clientId: 'case-r1', now: NOW, officer, location: { lat: 26.14, lng: 91.73 }, lang: 'as' });
  await repo.commit(null, change);

  const doc = await repo.loadCase('case-r1');
  expect(doc).toEqual(change.doc);
  const ops = await repo.syncStore.dueOps('data', NOW, 100, false);
  expect(ops.map((o) => `${o.entity}/${o.op}`)).toEqual(['case/create', 'field/set', 'field/set', 'field/set', 'audit/append']);
  expect(new Set(ops.map((o) => o.opId)).size).toBe(ops.length);
  expect((await repo.listAudit('case-r1')).map((a) => a.type)).toEqual(['case_opened']);
});

test('every later change is queued: edits, answers and signing', async () => {
  const { repo } = await setup();
  const first = openCase({ clientId: 'case-r2', now: NOW, officer: null, lang: 'as' });
  await repo.commit(null, first);
  let doc = (await repo.loadCase('case-r2'))!;

  const weatherQ = doc.followups.find((f) => f.fieldIds[0] === 'weather')!;
  const answered = answerFollowup(doc, weatherQ.id, 'rain', { source: 'tap', now: '2026-11-23T15:50:00.000Z' });
  await repo.commit(doc, answered);
  doc = (await repo.loadCase('case-r2'))!;
  expect(doc.fields.weather).toMatchObject({ value: 'rain', source: 'tap' });
  expect(doc.followups.find((f) => f.id === weatherQ.id)?.status).toBe('answered');

  const edited = editField(doc, 'lighting', 'night_no_lights', '2026-11-23T15:51:00.000Z');
  await repo.commit(doc, edited);
  doc = (await repo.loadCase('case-r2'))!;
  const confirmed = confirmFields(doc, Object.keys(doc.fields), '2026-11-23T15:52:00.000Z');
  await repo.commit(doc, confirmed);
  doc = (await repo.loadCase('case-r2'))!;
  await repo.commit(doc, signCase(doc, [], '2026-11-23T15:53:00.000Z'));

  const ops = (await repo.syncStore.dueOps('data', NOW, 100, false)).map((o) => `${o.entity}/${o.op}`);
  expect(ops).toEqual(expect.arrayContaining(['followup/answer', 'case/sign']));
  expect(ops.indexOf('case/sign')).toBeGreaterThan(ops.lastIndexOf('field/set'));
  expect((await repo.loadCase('case-r2'))!.status).toBe('signed');
});

test('the database itself keeps the audit trail append-only and signed cases read-only', async () => {
  const { db, repo } = await setup();
  const opened = openCase({ clientId: 'case-r3', now: NOW, officer, lang: 'as' });
  await repo.commit(null, opened);
  await expect(db.runAsync("UPDATE audit_events SET type = 'x'")).rejects.toThrow(/append-only/);
  await expect(db.runAsync('DELETE FROM audit_events')).rejects.toThrow(/append-only/);

  let doc = (await repo.loadCase('case-r3'))!;
  await repo.commit(doc, confirmFields(doc, Object.keys(doc.fields), NOW));
  doc = (await repo.loadCase('case-r3'))!;
  await repo.commit(doc, signCase(doc, [], NOW));
  await expect(db.runAsync("UPDATE field_values SET value = '\"x\"' WHERE case_id = 'case-r3'")).rejects.toThrow(/read-only/);
  expect(() => editField(doc, 'weather', 'fog', NOW)).not.toThrow(); // doc was loaded before signing
  const signed = (await repo.loadCase('case-r3'))!;
  expect(() => editField(signed, 'weather', 'fog', NOW)).toThrow(/read-only/);
});

test('a pull never undoes a decision the officer made on the phone', async () => {
  const { repo } = await setup();
  await repo.commit(null, openCase({ clientId: 'case-r4', now: NOW, officer, lang: 'as' }));
  const proposal = {
    id: uuidv7(),
    caseId: 'case-r4',
    fieldId: 'skid_marks_m',
    value: 12,
    currentValue: 2,
    currentConfirmed: false,
    source: 'server_asr' as const,
    status: 'open' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await repo.applyPull({ cursor: NOW, proposals: [proposal, { ...proposal, id: uuidv7(), caseId: 'not-on-this-phone' }], cases: [] }, NOW);
  expect((await repo.listProposals('case-r4')).map((p) => p.status)).toEqual(['open']);
  expect(await repo.listProposals('not-on-this-phone')).toEqual([]);

  const doc = (await repo.loadCase('case-r4'))!;
  await repo.commit(doc, { doc, audit: [], proposalDecisions: [{ id: proposal.id, status: 'rejected' }] });
  await repo.applyPull({ cursor: NOW, proposals: [proposal], cases: [] }, NOW);
  expect((await repo.listProposals('case-r4'))[0].status).toBe('rejected');
});

test('a voice check is stored on the clip; a mismatch is audited and synced', async () => {
  const { repo } = await setup();
  await repo.commit(null, openCase({ clientId: 'case-v1', now: NOW, officer, lang: 'as' }));
  const clip = (clientId: string, section: 'crash' | 'road') => ({
    clientId,
    caseId: 'case-v1',
    section,
    uri: `file:///clips/${clientId}.m4a`,
    mimeType: 'audio/m4a',
    recordedAt: NOW,
    status: 'saved' as const,
    filledKeys: [],
  });
  for (const [id, section] of [['clip-v1', 'crash'], ['clip-v2', 'road']] as const) {
    await repo.addClip(clip(id, section), { id: uuidv7(), caseId: 'case-v1', type: 'clip_saved', at: NOW, meta: { clipId: id } });
  }

  await repo.recordSpeakerCheck(clip('clip-v1', 'crash'), { score: 0.82, match: true, engine: 'wespeaker-resnet34' });
  await repo.recordSpeakerCheck(clip('clip-v2', 'road'), { score: 0.21, match: false, engine: 'wespeaker-resnet34' });

  const clips = await repo.listClips('case-v1');
  expect(clips.map((c) => c.speaker)).toEqual([
    { score: 0.82, match: true, engine: 'wespeaker-resnet34' },
    { score: 0.21, match: false, engine: 'wespeaker-resnet34' },
  ]);
  const mismatches = (await repo.listAudit('case-v1')).filter((a) => a.type === 'speaker_mismatch');
  expect(mismatches).toHaveLength(1);
  expect(mismatches[0].meta).toMatchObject({ clipId: 'clip-v2', section: 'road', score: 0.21 });
  const ops = await repo.syncStore.dueOps('data', NOW, 100, false);
  expect(ops.filter((o) => o.entity === 'audit' && (o.payload as { type?: string }).type === 'speaker_mismatch')).toHaveLength(1);
});
