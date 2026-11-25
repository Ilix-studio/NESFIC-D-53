// SQLite schema. Bump DB_VERSION and append a migration; never edit one that has shipped.
// Every row the phone creates carries an id made on the phone (UUID v7), which the server
// stores too, so uploads are idempotent.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);

  CREATE TABLE cases (
    client_id TEXT PRIMARY KEY NOT NULL,
    started_at TEXT NOT NULL,
    lat REAL, lng REAL, accuracy REAL,
    lang TEXT NOT NULL DEFAULT 'as',
    status TEXT NOT NULL DEFAULT 'draft',
    signed_at TEXT,
    police_station TEXT, district TEXT, officer_name TEXT, officer_badge TEXT,
    completeness TEXT NOT NULL,
    server_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE field_values (
    case_id TEXT NOT NULL REFERENCES cases(client_id),
    field_key TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    clip_id TEXT,
    transcript_span TEXT,
    confirmed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (case_id, field_key)
  );

  CREATE TABLE followups (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(client_id),
    rule_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    field_ids TEXT NOT NULL,
    answer_type TEXT NOT NULL,
    question_en TEXT NOT NULL,
    question_as TEXT NOT NULL,
    options TEXT NOT NULL,
    priority INTEGER NOT NULL,
    status TEXT NOT NULL,
    origin TEXT NOT NULL,
    answer TEXT,
    skip_reason TEXT,
    answered_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX followups_case ON followups(case_id);

  CREATE TABLE clips (
    client_id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(client_id),
    section TEXT NOT NULL,
    uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    duration_ms INTEGER,
    recorded_at TEXT NOT NULL,
    transcript_text TEXT,
    transcript_engine TEXT,
    transcript_lang TEXT,
    status TEXT NOT NULL,
    error TEXT,
    filled_keys TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX clips_case ON clips(case_id);

  CREATE TABLE photos (
    client_id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL REFERENCES cases(client_id),
    checklist_item TEXT NOT NULL,
    uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    taken_at TEXT NOT NULL,
    lat REAL, lng REAL, accuracy REAL,
    note TEXT
  );
  CREATE INDEX photos_case ON photos(case_id);

  -- Server suggestions after sync. local_decision = 1 once the officer accepted or rejected
  -- it on this phone; a later pull never undoes that.
  CREATE TABLE proposals (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value TEXT NOT NULL,
    current_value TEXT,
    current_confirmed INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    evidence TEXT,
    confidence REAL,
    status TEXT NOT NULL,
    local_decision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX proposals_case ON proposals(case_id, status);

  -- Append-only (CLAUDE.md rule 7): the triggers below make UPDATE and DELETE fail.
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    type TEXT NOT NULL,
    field_id TEXT,
    old_value TEXT,
    new_value TEXT,
    meta TEXT,
    at TEXT NOT NULL
  );
  CREATE INDEX audit_case ON audit_events(case_id, at);
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;

  -- Signed cases are read-only: field values of a signed case cannot change.
  CREATE TRIGGER fields_locked_insert BEFORE INSERT ON field_values
    WHEN (SELECT status FROM cases WHERE client_id = NEW.case_id) = 'signed'
    BEGIN SELECT RAISE(ABORT, 'case is signed and read-only'); END;
  CREATE TRIGGER fields_locked_update BEFORE UPDATE ON field_values
    WHEN (SELECT status FROM cases WHERE client_id = OLD.case_id) = 'signed'
    BEGIN SELECT RAISE(ABORT, 'case is signed and read-only'); END;
  CREATE TRIGGER fields_locked_delete BEFORE DELETE ON field_values
    WHEN (SELECT status FROM cases WHERE client_id = OLD.case_id) = 'signed'
    BEGIN SELECT RAISE(ABORT, 'case is signed and read-only'); END;

  -- Outbox (OFFLINE-PLAN sync design): one row per change, sent in seq order.
  -- entity: case | field | followup | proposal | audit (data, sent in batches)
  --         clip | photo (files, one per request, after the data)
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    entity TEXT NOT NULL,
    client_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    done_at TEXT
  );
  CREATE INDEX outbox_status ON outbox(status, seq);
  `,
  `
  -- Officer voice check (src/speaker): the clip compared with the IO's voiceprint.
  -- NULL = not checked (no voiceprint, no speaker model, or the clip was too short).
  ALTER TABLE clips ADD COLUMN speaker_score REAL;
  ALTER TABLE clips ADD COLUMN speaker_match INTEGER;
  ALTER TABLE clips ADD COLUMN speaker_engine TEXT;
  `,
];

export const DB_VERSION = MIGRATIONS.length;
