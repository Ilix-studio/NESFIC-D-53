# VoiceDAR: Claude Code project brief

> Put this file in the root of your Expo repo as `CLAUDE.md`. Claude Code reads it at the start of every session.

## What we are building

An Android app (Expo / React Native, TypeScript) for police Investigating Officers (IOs) in Assam.
At a road-crash scene the officer **speaks in Assamese**. As soon as a recording is saved, the app:

1. Transcribes the Assamese speech.
2. Maps what was said onto **eDAR field values** (eDAR = MoRTH's Electronic Detailed Accident Report, 100+ structured fields).
3. Runs checks for **missing** fields and **inconsistent** values (contradictions).
4. Shows a list of **follow-up questions**. The officer answers by tapping or by voice, or skips with a reason.
5. Lets the officer **review and confirm every field**, then exports an eDAR-schema JSON file.

This is for the NESFIC 2026 challenge NESFIC-D-53 (Assam Transport Department). Pilot district: Kamrup (Metro).

## Screens (expo-router, one file per screen)

Wireframes: https://claude.ai/artifact/1FWT6XjASNNdMsyxpsA2La

| Route | Screen | Key content |
|---|---|---|
| `app/index.tsx` | Welcome | App name, "Open" button |
| `app/cases.tsx` | Case list | Cases on this phone (newest first, with sync state), "New case" at the bottom, settings icon (top right) → Settings & sync |
| `app/settings.tsx` | Settings & sync | Officer login, sync status + "Sync now", offline engines, server connection |
| `app/case/[id]/index.tsx` | New case / case home | Auto time + GPS, offline badge, 4 sections, "% eDAR fields filled" bar, photo checklist link |
| `app/case/[id]/record/[section].tsx` | Record a section | Record/stop/save, noise warning, Assamese transcript, fields filled from this clip |
| `app/case/[id]/followup.tsx` | Follow-up questions | Contradictions first, then missing fields by priority; tap options, voice answer, skip with reason |
| `app/case/[id]/photos.tsx` | Scene photos | Checklist: road surface, vehicle positions, skid marks, lighting, signs, number plates. Each photo stamped with time + GPS |
| `app/case/[id]/review.tsx` | Officer review | Every field grouped by section, English/Assamese toggle, source clip + transcript per value, Confirm/Edit, still-open list |
| `app/case/[id]/submit.tsx` | Submit, export, sync | Sign + lock, sync queue, export JSON / PDF, audit trail |

The 4 recording sections are: `crash`, `road`, `vehicles`, `persons`.

## Tech stack

- **Expo (latest SDK), TypeScript strict, expo-router.**
- Recording: `expo-audio`. Location: `expo-location`. Photos: `expo-image-picker` (camera). Files: `expo-file-system`.
- Local database (offline first): `expo-sqlite`. Secrets: `expo-secure-store`. Network state: `@react-native-community/netinfo`.
- Reading questions aloud: `expo-speech` (fall back to on-screen text if no Assamese voice is installed).
- Validation: `zod`.
- Styling: plain `StyleSheet`, no UI kit. Touch targets at least 44 px. Must be usable one-handed, outdoors, at night.

## Architecture rules

1. **Everything works offline first.** Every case, clip, transcript, field value, photo and audit event is written to SQLite immediately. Network is only for sync and (in the prototype) cloud speech/LLM calls.
2. **Speech-to-text and field mapping sit behind interfaces** so we can swap providers without touching screens:
   ```ts
   interface AsrEngine { transcribe(audioUri: string, lang: LangCode): Promise<Transcript> }
   interface FieldMapper { map(transcript: Transcript, section: Section, schema: EdarSchema, current: FieldValues): Promise<FieldProposal[]> }
   ```
   - Prototype: `CloudAsrEngine` + `CloudFieldMapper`, which call **our own backend** (never call third-party APIs with keys from the app).
   - Later: `OnDeviceAsrEngine` (whisper.rn or an IndicConformer ONNX model) and `OnDeviceFieldMapper` (llama.rn with a small model). These need an Expo **development build** (`npx expo prebuild` / EAS), not Expo Go.
3. **The eDAR schema is data, not code.** Keep it in `src/schema/edar.schema.json`: each field has `id`, `section`, `label_en`, `label_as`, `type` (`enum | text | number | datetime | geo | photo`), `options` (for enums, with English codes + Assamese labels), `required`, `priority` (1 = ask first). The real schema will come from the Transport Department. Until then, use a **placeholder** with ~40 representative fields and mark it `"placeholder": true`.
4. **Language packs are data.** `src/lang/as.json` holds Assamese labels, question wording and number/date words. Adding Bengali or Bodo must only mean adding `bn.json` / `brx.json`.
5. **Checks are pure TypeScript rules** in `src/rules/`, one file per rule, each returning `{ fieldIds, kind: 'missing' | 'inconsistent', question_en, question_as, options? }`. Examples:
   - Crash time between sunset and sunrise but lighting = "Daylight".
   - Severity = "Fatal" but no person recorded as killed.
   - Vehicles involved = 2 but only 1 vehicle described.
   - Required field still empty.
   Write a unit test for every rule.
6. **Every field value keeps its evidence:** `{ value, source: 'speech' | 'tap' | 'auto' | 'officer_edit', clipId?, transcriptSpan?, confirmedByOfficer, updatedAt }`.
7. **Audit trail is append-only.** Never update or delete rows in `audit_events`. Log: case opened, clip saved, fields filled, question answered/skipped, officer edits (old → new), confirmation, signing, export, sync.
8. **The officer has the final say.** Nothing is submitted until every filled field is confirmed and the officer signs. A signed case is read-only.
9. **Privacy (DPDP Act 2023).** Encrypt stored audio and the database at rest where possible, never log personal data to the console, and use synthetic test data only. Backend must be hosted in India.
10. Offline engines are the default. EngineRouter picks: on-device engine always runs
    first; server engines only run after sync and only produce proposals.
11. Models live in app storage, downloaded by ModelManager with SHA-256 checks.
    Never bundle models in the APK.
12. Sync uses an outbox table + clientId (UUID v7). Officer-confirmed or
    officer_edit values are never overwritten by sync. Server results become
    proposals the officer accepts or rejects.
13. Language is chosen by the officer per case (as/bn/brx); clips inherit it.

Rules 10-13 come from `docs/OFFLINE-PLAN.md`, which replaces Phase 6 of the prompts file.

## Folder layout

```
app/                 expo-router screens
src/schema/          eDAR schema JSON + zod types
src/lang/            language packs (as.json, en.json)
src/asr/             AsrEngine interface + implementations
src/mapper/          FieldMapper interface + implementations
src/rules/           missing/inconsistency rules + tests
src/db/              SQLite setup, migrations, repositories
src/sync/            sync queue
src/export/          eDAR JSON export, PDF export
src/components/      shared UI
server/              small backend (Node/TypeScript) that proxies ASR + LLM calls
test-data/           synthetic Assamese clips + expected field values
```

## Commands

- `npx expo start` (Expo Go works while only cloud engines are used)
- `npx expo run:android` (dev build, needed once on-device models are added)
- `npm test` (jest + rules tests)
- `npx tsc --noEmit` (type check)

## Working rules for Claude Code

- Build one phase at a time (see the prompts file). After each phase: type check, run tests, and tell me how to try it on my phone.
- Don't invent eDAR fields as if they were official. Placeholder fields must be marked as placeholders.
- Never put API keys in the app bundle.
- Keep screens matching the wireframe link above.

## Repo notes (set up 24 Nov 2026; see /SETUP.md)

- This repo is a monorepo: the Expo app is `client/`, the backend is the sibling `server/` (not `client/server/`). The backend follows `server/CLAUDE.md` (JavaScript ES modules + MongoDB), which supersedes the "Node/TypeScript" line above.
- Expo SDK 58 keeps routes in `src/app/`, so the route table above maps to `src/app/index.tsx`, `src/app/case/[id]/index.tsx`, and so on. Do not create a top-level `app/` folder.
- `src/schema/edar.schema.json`, `src/lang/*.json` and `test-data/*.json` are COPIES of `/shared`. Edit the files in `/shared`, then run `npm run sync-shared` from the repo root.
- Field values for vehicles and persons are keyed `fieldId@n` (1-based), e.g. `vehicle_type@2`.
- The server API is wrapped in `src/api` (`api.health()`, `api.login()`, `api.uploadClip()`, ...). Base URL: `EXPO_PUBLIC_API_URL`, else the Expo dev host on port 8080.
- Status (25 Nov 2026): offline-first prototype of `docs/OFFLINE-PLAN.md` (O1, O2, O5, O6 working; O3/O4 scaffolded). All six screens are real and read from SQLite. See SETUP.md section 13.
- Pure pipeline, a typed port of the server's (keep the two in step): `src/case/fields.ts` + `state.ts` (case state, `incomingWins` conflict rule), `src/rules/*` (one file per rule), `src/mapper/rule-mapper.ts` (language-pack driven, with negation). `src/case/commands.ts` = every officer action as a pure function returning `{ doc, audit, ops }`.
- Storage: `src/db/repo.ts` is the only write path. `commit(prev, change)` saves the case, audit events and the outbox rows (derived from the diff, so no change can skip sync) in one transaction. SQLite triggers make `audit_events` append-only and signed cases' `field_values` read-only. Repo tests run the real SQL on Node's `node:sqlite` (`src/db/test-db.ts`).
- Sync: `src/sync/worker.ts` (data ops in batches → files one per request → pull; backoff; testable store/transport), `transport.ts` (HTTP), `SyncContext.tsx` (triggers + status). Server: `POST /sync/cases` with `{ ops }`, `GET /sync/pull?since=`, uploads with `?firstPass=phone`.
- Speech: `src/asr/router.ts` picks on-device → demo engine (`demo.ts`, SYNTHETIC transcripts from test-data, switchable in Offline engines) → none (server transcribes after sync). On-device = `on-device.ts` + the local native module `modules/voicedar-asr` (Kotlin: MediaCodec decode → ≤12 s pieces cut at pauses → onnxruntime-android → greedy CTC; mirrors the server's `ctc.js`). It exists only in the Android development build (`npx expo run:android`; `android/` is generated, never edit it). `src/models/` = manifest from `src/models/data/speech-models.json` (copy of `shared/models`) + ModelManager: downloads `${API_URL}/models/:id/file` over Wi-Fi with progress, checks the pinned SHA-256.
- Watchman on this Mac is broken (missing libfmt); Metro falls back without it and jest has `watchman: false`. Fix with `brew reinstall watchman`.
- State (25 Nov 2026): Redux Toolkit store in `src/store` for app state only: `session` (officer, mirrors expo-secure-store), `sync` (status; `syncNow` thunk), `settings` (`caseLang`, the last case language; replaces the old `last_lang` meta). Only `settings` is persisted, by redux-persist to a JSON file (`store/persistStorage.ts`, expo-file-system `File` API; `redux-persist-expo-file-system-storage` is NOT used: it calls SDK 51 functions that throw in SDK 58). Cases, clips, photos and the audit trail stay in SQLite. `useAuth()` / `useSync()` keep their old shape; `SessionRestorer` and `SyncRunner` are rendered in `_layout.tsx`. Jest transforms `immer` (package.json `transformIgnorePatterns`).
- Web (25 Nov 2026): `app.json` `web.output` is `"single"` (one `index.html`, client-side routing); `"server"` builds no `index.html` and showed a 404 on Vercel. `vercel.json` (here for Vercel Root Directory = `client`; the repo-root `vercel.json` does the same when Root Directory is left at the root) builds with `npx expo export -p web` into `dist`, rewrites every path to `index.html` and sends COOP + COEP headers (expo-sqlite's web worker needs them, as `metro.config.js` does in dev). On web there is no on-device speech or voice check and the session sits in localStorage; the API needs `EXPO_PUBLIC_API_URL` (HTTPS) at build time and the site's origin in the server's `CORS_ORIGINS`.
- Officer voice check (25 Nov 2026): accounts are created by an admin/supervisor on the server; after the first login the IO is sent to `src/app/voice.tsx` to read a passage (`src/speaker/data/passages.json`, copy of `shared/voice`). The server returns `officer.voice` (256-number voiceprint), cached with the profile in secure storage. `captureSectionClip` then runs `src/speaker` `checkSpeaker` before ASR: native `VoicedarAsr.embedSpeaker` (Kotlin `Fbank.kt` + WeSpeaker ONNX, its own session) → cosine vs the voiceprint → `clips.speaker_*` columns (migration 2) and, on a mismatch, a `speaker_mismatch` audit event (synced). Shown on the record screen and at the top of review; never blocks. The speaker model (27 MB) is downloaded from Offline engines. `Fbank.kt` has a JVM test against `test-data/fbank-reference.json`: `cd android && ./gradlew :voicedar-asr:testDebugUnitTest`.

