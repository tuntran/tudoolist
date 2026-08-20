-- Repos collapse from a table into a list of URLs on the project.
--
-- The table carried an id, a label, and a created_at for every link. None of
-- that was ever read: the question is only ever "where does this code live",
-- and the answer is a handful of URLs. A row per repo bought structure nobody
-- was querying and cost two tools on the surface to maintain it.
--
-- Stored as a JSON array of strings so the column holds a list rather than a
-- delimited blob the app has to guess how to split.

ALTER TABLE project ADD COLUMN repos TEXT;

UPDATE project
   SET repos = (SELECT json_group_array(url)
                  FROM (SELECT url FROM repo WHERE repo.project_id = project.id ORDER BY id))
 WHERE EXISTS (SELECT 1 FROM repo WHERE repo.project_id = project.id);

DROP TABLE repo;
