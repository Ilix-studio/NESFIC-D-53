// Sync queue (Phase 7): uploads cases, clips and photos when NetInfo reports a connection,
// with retries, using the API client in src/api (POST /sync/cases, /cases/:id/clips, /cases/:id/photos).
export type SyncStatus = 'local' | 'queued' | 'synced' | 'error';
