-- The language of generated text was never stored anywhere.
--
-- It lived in a browser cookie: whichever way the RU/EN switch happened to be
-- pointing when a run started decided the language of everything that run
-- wrote, and nothing recorded the decision. One workspace opened in two
-- browsers had two languages, and a switch silently changed what the next run
-- would be written in. The result is a single channel list holding July's
-- English rows beside August's Russian ones, under an interface in a third
-- state.
--
-- So: the workspace owns the choice, and every row remembers what it was
-- written in. A row whose language differs from its workspace's is the one
-- thing that can now be found and fixed, rather than merely noticed by a user.

ALTER TABLE workspaces ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'en';

ALTER TABLE prospects ADD COLUMN content_locale TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN content_locale TEXT NOT NULL DEFAULT '';

-- Rows written before this migration keep an empty language: unknown is
-- honest, and the translation pass decides what they are by reading them.
CREATE INDEX IF NOT EXISTS idx_prospects_content_locale
  ON prospects (workspace_id, content_locale);
