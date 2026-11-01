-- Run ONLY if an existing v0.1 database is already configured.
-- A fresh installation needs only schema.sql.
-- Review changes in an approved staging environment before any production migration.
BEGIN;
ALTER TABLE public.study_events DROP CONSTRAINT IF EXISTS study_events_kind_check;
ALTER TABLE public.study_events ADD CONSTRAINT study_events_kind_check
  CHECK (kind IN ('session_started','session_completed','task_started','task_ended','answers','interaction_batch','method_event'));
COMMIT;
