// Logged-in officer. The token and profile themselves live in expo-secure-store (api/session);
// this slice only mirrors the profile for the screens, and is never persisted to a file.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { Officer } from '@/api/types';

type SessionState = { officer: Officer | null; ready: boolean };

const initialState: SessionState = { officer: null, ready: false };

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    restored(state, action: PayloadAction<Officer | null>) {
      state.officer = action.payload;
      state.ready = true;
    },
    loggedIn(state, action: PayloadAction<Officer>) {
      state.officer = action.payload;
    },
    loggedOut(state) {
      state.officer = null;
    },
  },
});
