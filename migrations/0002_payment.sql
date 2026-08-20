-- Money becomes a log of events instead of a running total.
--
-- project.amount_paid answered "how much has this client handed over" and
-- nothing else. Every time it was overwritten, the fact that a payment happened
-- on a particular day was lost — so "how much did I take in this month" had no
-- answer, and never would have. Same mistake the habit design avoided by
-- deriving streaks from check-ins rather than storing a counter.
--
-- Amount paid is now SUM(payment.amount) over the project.

CREATE TABLE payment (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  -- Whole VND. Negative is allowed and is how a mistake gets corrected: the
  -- wrong row stays and an offsetting row cancels it, so the history of what
  -- was believed when stays intact.
  amount     INTEGER NOT NULL,
  -- Local calendar date the money arrived, YYYY-MM-DD. Every monthly figure
  -- groups on this, which is why it is not derived from created_at.
  paid_date  TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX payment_by_project ON payment(project_id);
CREATE INDEX payment_by_date ON payment(paid_date);

-- Carry the existing totals over as one opening payment each. The real date is
-- unknown — it was never recorded — so it is stamped with the project's own
-- creation date and labelled, rather than silently invented.
INSERT INTO payment (project_id, amount, paid_date, note)
  SELECT id, amount_paid, date(created_at), 'Số dư chuyển sang khi tách bảng payment — ngày là ước lượng'
    FROM project
   WHERE amount_paid > 0;

ALTER TABLE project DROP COLUMN amount_paid;
