import { sessionSlice } from './sessionSlice';
import { settingsSlice } from './settingsSlice';
import { syncNow, syncSlice } from './syncSlice';

const officer = { _id: 'o1', name: 'Test IO', badgeNo: 'T-1', policeStation: 'Test PS', district: 'Kamrup (Metro)', role: 'io' } as never;

test('session: restore marks ready; login and logout set the officer', () => {
  const { restored, loggedIn, loggedOut } = sessionSlice.actions;
  let s = sessionSlice.reducer(undefined, restored(null));
  expect(s).toEqual({ officer: null, ready: true });
  s = sessionSlice.reducer(s, loggedIn(officer));
  expect(s.officer).toBe(officer);
  expect(sessionSlice.reducer(s, loggedOut())).toEqual({ officer: null, ready: true });
});

test('settings: new cases start in the last language chosen', () => {
  expect(settingsSlice.reducer(undefined, { type: 'init' }).caseLang).toBe('as');
  expect(settingsSlice.reducer(undefined, settingsSlice.actions.caseLangChosen('brx')).caseLang).toBe('brx');
});

test('sync: running while a pass is in flight, then keeps its report', () => {
  const report = { pushed: 2, uploaded: 1, rejected: 0, pulled: 3 };
  let s = syncSlice.reducer(undefined, { type: syncNow.pending.type });
  expect(s.running).toBe(true);
  s = syncSlice.reducer(s, { type: syncNow.fulfilled.type, payload: report });
  expect(s).toEqual({ running: false, lastReport: report });
});
