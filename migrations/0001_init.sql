-- Pisma. Tekst je nepromjenjiv nakon objave (body_sha256 ide u lanac).
CREATE TABLE letters (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'hr',
  owner_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  allow_anonymous INTEGER NOT NULL DEFAULT 1,
  moderation INTEGER NOT NULL DEFAULT 0,
  body_sha256 TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX letters_owner ON letters (owner_hash);

-- Potpisi. E-mail se ne sprema, samo HMAC i domena.
CREATE TABLE signatures (
  id INTEGER PRIMARY KEY,
  letter_id INTEGER NOT NULL REFERENCES letters (id),
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  affiliation TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 0,
  email_hash TEXT NOT NULL,
  email_domain TEXT NOT NULL,
  institution TEXT,
  show_institution INTEGER NOT NULL DEFAULT 0,
  tier INTEGER NOT NULL DEFAULT 0,
  methods TEXT NOT NULL DEFAULT '[]',
  orcid TEXT,
  name_source TEXT NOT NULL DEFAULT 'self',
  review_note TEXT,
  salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'review', 'withdrawn', 'rejected')),
  manage_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  UNIQUE (letter_id, email_hash)
);
CREATE INDEX signatures_letter ON signatures (letter_id, status);
CREATE INDEX signatures_manage ON signatures (manage_hash);

-- Jedan ORCID / jedan OIB po pismu.
CREATE TABLE identity_claims (
  letter_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  signature_id INTEGER NOT NULL,
  PRIMARY KEY (letter_id, kind, subject_hash)
);

CREATE TABLE login_tokens (
  hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE oidc_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  signature_id INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Lanac hasheva po pismu: hash = sha256(prev_hash|seq|event)
CREATE TABLE log (
  letter_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  event TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (letter_id, seq)
);
CREATE TRIGGER log_no_update BEFORE UPDATE ON log BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;
CREATE TRIGGER log_no_delete BEFORE DELETE ON log BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;

CREATE TABLE rate (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
