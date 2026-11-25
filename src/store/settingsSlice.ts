// Phone settings, persisted to a file (store/persistStorage). Nothing personal goes here.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { CaseLang } from '@/lang';

type SettingsState = {
  /** Language of the last case opened on this phone; new cases start in it. */
  caseLang: CaseLang;
};

const initialState: SettingsState = { caseLang: 'as' };

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    caseLangChosen(state, action: PayloadAction<CaseLang>) {
      state.caseLang = action.payload;
    },
  },
});
