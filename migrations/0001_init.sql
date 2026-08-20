-- tudoolist v1 schema: client -> project -> task.
--
-- Habits are deliberately absent. They were scoped out of v1 and will arrive as
-- their own numbered migration, so nothing here needs to anticipate them.
--
-- Conventions used throughout:
--   *_at    ISO-8601 UTC instant, e.g. 2026-08-20T03:33:46Z
--   *_date  bare calendar date in Asia/Ho_Chi_Minh, e.g. 2026-08-20.
--           A due date is a day a person points at, not an instant. Stored as a
--           UTC timestamp it would land on the wrong day for anything set after
--           17:00 local, so it stays a plain string the app compares as text.
--   money   whole VND. No minor unit exists, so no scaling factor is needed.

CREATE TABLE client (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  -- Individuals, not companies: a phone number is the real contact handle.
  phone      TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE project (
  id           INTEGER PRIMARY KEY,
  client_id    INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'done', 'cancelled')),
  -- Agreed contract value, and what the client has actually handed over.
  -- amount_paid is not constrained against amount_total: overpayment and
  -- renegotiation both happen, and rejecting the row helps nobody.
  amount_total INTEGER NOT NULL DEFAULT 0,
  amount_paid  INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX project_by_client ON project(client_id);

CREATE TABLE task (
  id         INTEGER PRIMARY KEY,
  -- Nullable on purpose: not every task belongs to paid client work.
  project_id INTEGER REFERENCES project(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo', 'doing', 'done')),
  due_date   TEXT,
  -- Most tasks are a one-line feature note with nothing more to say.
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  done_at    TEXT
);

-- The two ways tasks get read: everything open on a project, and what is due.
CREATE INDEX task_by_project ON task(project_id, status);
CREATE INDEX task_by_due ON task(due_date) WHERE due_date IS NOT NULL;
