// Redux Toolkit store for app state: session, sync status, settings. Case data is not here:
// SQLite (src/db) stays the source of truth for cases, clips, photos and the audit trail.
// Only `settings` is persisted (redux-persist, store/persistStorage).
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist';

import { persistStorage } from './persistStorage';
import { sessionSlice } from './sessionSlice';
import { settingsSlice } from './settingsSlice';
import { syncSlice } from './syncSlice';

const rootReducer = combineReducers({
  session: sessionSlice.reducer,
  sync: syncSlice.reducer,
  settings: persistReducer({ key: 'settings', version: 1, storage: persistStorage }, settingsSlice.reducer),
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
        // syncNow({ repo }) carries the SQLite repository in its action's meta.arg.
        ignoredActionPaths: ['meta.arg.repo'],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

export const { restored, loggedIn, loggedOut } = sessionSlice.actions;
export const { caseLangChosen } = settingsSlice.actions;
export { syncNow } from './syncSlice';
