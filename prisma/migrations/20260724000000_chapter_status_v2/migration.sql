-- v2 state machine: collapse 8-value ChapterStatus enum to 3 values.
-- Prisma represents enum as TEXT on SQLite, so no DROP VALUE needed.
-- Idempotent: re-running yields same result.

UPDATE Chapter SET status = 'draft'
WHERE status IN ('generating', 'generated', 'scored', 'selected', 'rejected');
