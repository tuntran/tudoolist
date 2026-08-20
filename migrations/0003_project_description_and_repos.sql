-- Two things a project needs that note was absorbing badly.
--
-- `note` had become both "what this job is" and "where it stands right now".
-- The first barely changes, the second changes weekly, so writing one
-- overwrites the other. description takes the scope; note keeps the status.
--
-- Repos get their own table rather than a column because a single project
-- routinely spans more than one — frontend and backend, or a mobile client
-- alongside an API.

ALTER TABLE project ADD COLUMN description TEXT;

CREATE TABLE repo (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  -- Which part of the project this is: "frontend", "api", "mobile". Optional,
  -- because a one-repo project has nothing to disambiguate.
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Adding the same repo twice is a mistake every time, never an intent.
  UNIQUE (project_id, url)
);

CREATE INDEX repo_by_project ON repo(project_id);
