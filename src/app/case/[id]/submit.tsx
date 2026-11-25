// Wireframe 6: Submit, export and sync. The export is built on the phone, so it works offline.
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Share, StyleSheet, View } from 'react-native';

import { recordExport } from '@/case/commands';
import type { AuditEntry } from '@/case/types';
import { fieldTitle } from '@/components/case-ui';
import { Button, Card, Pill, Screen, styles, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useRepo, useRepoData } from '@/db';
import { buildEdarJson } from '@/export';
import { useSync } from '@/sync/SyncContext';
import { formatDateTime } from '@/utils/format';

const AUDIT_LABEL: Record<AuditEntry['type'], string> = {
  case_opened: 'Case opened',
  clip_saved: 'Clip saved',
  clip_processed: 'Clip transcribed on phone',
  fields_filled: 'Fields filled from speech',
  followup_answered: 'Question answered',
  followup_skipped: 'Question skipped',
  field_edited: 'Field edited',
  field_confirmed: 'Field confirmed',
  photo_added: 'Photo added',
  case_signed: 'Case signed',
  case_exported: 'Exported',
  language_set: 'Language changed',
  proposal_accepted: 'Server suggestion accepted',
  proposal_rejected: 'Server suggestion rejected',
};

const short = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function auditDetail(e: AuditEntry): string {
  if (e.type === 'field_edited' || e.type === 'followup_answered' || e.type === 'proposal_accepted' || e.type === 'proposal_rejected') {
    return `${fieldTitle(e.fieldId ?? '')}: ${short(e.oldValue)} → ${short(e.newValue)}`;
  }
  if (e.type === 'field_confirmed') return fieldTitle(e.fieldId ?? '');
  if (e.type === 'followup_skipped') return `${fieldTitle(e.fieldId ?? '')}: ${short(e.meta?.reason)}`;
  if (e.type === 'fields_filled') return `${short(e.meta?.count)} field(s)`;
  if (e.type === 'clip_saved' || e.type === 'clip_processed') return `${short(e.meta?.section)}${e.meta?.engine ? ` · ${short(e.meta.engine)}` : ''}`;
  if (e.type === 'language_set') return `${short(e.oldValue)} → ${short(e.newValue)}`;
  return '';
}

export default function SubmitScreen() {
  const t = useTheme();
  const repo = useRepo();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { syncNow, running, online, loggedIn } = useSync();
  const doc = useRepoData(`case:${id}`, (r) => r.loadCase(id));
  const outbox = useRepoData(`outbox:${id}`, (r) => r.caseOutbox(id));
  const summary = useRepoData(`summary:${id}`, (r) => r.caseSummary(id));
  const audit = useRepoData(`audit:${id}`, (r) => r.listAudit(id)) ?? [];

  if (!doc) return <Screen><ActivityIndicator /></Screen>;
  const signed = doc.status === 'signed';

  const exportJson = async () => {
    try {
      const json = buildEdarJson(doc, { clips: summary?.clipCount ?? 0, photos: summary?.photoCount ?? 0 });
      await repo.commit(doc, recordExport(doc, new Date().toISOString()));
      await Share.share({ title: `edar-${doc.clientId}.json`, message: JSON.stringify(json, null, 2) });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    }
  };

  const pending = outbox?.pending ?? 0;
  return (
    <Screen footer={<T variant="small" style={local.center}>Personal data handled under the DPDP Act, 2023 · audio and photos kept as evidence</T>}>
      <T variant="title">{signed ? 'Signed and locked' : 'Not signed yet'}</T>
      <T variant="small">
        {signed
          ? `Signed ${formatDateTime(new Date(doc.signedAt!))}${doc.officerName ? ` by ${doc.officerName} (${doc.officerBadge})` : ''}. Read-only on this phone and on the server.`
          : 'Sign from the review screen once every filled field is confirmed. A signed case is locked.'}
      </T>

      <T variant="label">Sync</T>
      <Card>
        <View style={styles.row}>
          <T variant="heading" style={styles.flex}>
            {pending ? `${pending} change${pending === 1 ? '' : 's'} waiting` : 'Everything sent'}
          </T>
          <Pill tone={pending ? 'warn' : 'ok'} text={pending ? (online ? 'Queued' : 'Offline') : 'Synced'} />
        </View>
        <T variant="small">
          Stored on the phone first. Sends automatically when there is signal{summary?.serverStatus ? ` · server copy: ${summary.serverStatus}` : ''}.
        </T>
        {(outbox?.rejected.length ?? 0) > 0 && (
          <View style={local.rejected}>
            <T variant="small" color={t.warn}>
              Not accepted by the server:
            </T>
            {outbox!.rejected.map((r, i) => (
              <T key={i} variant="small" color={t.warn}>
                {r.op}: {r.reason}
              </T>
            ))}
          </View>
        )}
        <Button title="Sync now" variant="secondary" onPress={syncNow} loading={running} disabled={!online || !loggedIn} />
        {!loggedIn && <T variant="small">Log in from Settings & sync on the welcome screen.</T>}
      </Card>

      <T variant="label">Export for eDAR</T>
      <Card>
        <T variant="heading">eDAR-schema JSON file</T>
        <T variant="small">Built on the phone from the PLACEHOLDER schema. Share it with the Android share sheet.</T>
        <Button title="Export JSON" onPress={exportJson} disabled={!signed} />
        {!signed && <T variant="small">Sign the case first.</T>}
      </Card>
      <T variant="small">Direct eDAR upload once NIC grants API access</T>

      <T variant="label">Audit trail ({audit.length})</T>
      <Card>
        {audit.length === 0 && <T variant="small">No events yet.</T>}
        {audit.map((e) => (
          <View key={e.id} style={[local.event, { borderTopColor: t.border }]}>
            <View style={styles.row}>
              <T variant="heading" style={styles.flex}>
                {AUDIT_LABEL[e.type] ?? e.type}
              </T>
              <T variant="small">{formatDateTime(new Date(e.at))}</T>
            </View>
            {auditDetail(e) !== '' && <T variant="small">{auditDetail(e)}</T>}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const local = StyleSheet.create({
  center: { textAlign: 'center' },
  rejected: { gap: 2 },
  event: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
