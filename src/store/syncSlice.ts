// Sync status. The work itself is src/sync/worker.ts; SyncRunner decides when it runs.
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import { getToken } from '@/api/session';
import type { Repo } from '@/db';
import { httpTransport } from '@/sync/transport';
import { runSync, type SyncReport } from '@/sync/worker';

type SyncState = { running: boolean; lastReport: SyncReport | null };

const initialState: SyncState = { running: false, lastReport: null };

/** One sync pass. Skipped while one is running or when nobody is logged in. */
export const syncNow = createAsyncThunk<SyncReport, { repo: Repo; manual: boolean }, { state: { sync: SyncState } }>(
  'sync/run',
  async ({ repo, manual }) => {
    try {
      return await runSync({ store: repo.syncStore, transport: httpTransport, ignoreBackoff: manual });
    } catch (err) {
      return { pushed: 0, uploaded: 0, rejected: 0, pulled: 0, error: err instanceof Error ? err.message : String(err) };
    }
  },
  { condition: async (_arg, { getState }) => !getState().sync.running && Boolean(await getToken()) },
);

export const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(syncNow.pending, (state) => {
        state.running = true;
      })
      .addCase(syncNow.fulfilled, (state, action) => {
        state.running = false;
        state.lastReport = action.payload;
      });
  },
});
