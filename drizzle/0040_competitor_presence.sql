-- Which rivals were found holding a listing on this channel.
--
-- Stored rather than computed on view: the analysis spends a Serper request
-- per channel per rival, so recomputing it every time the list is opened would
-- cost more than the search that found the channels.
--
-- A JSON array of {name, url}. The url is the page that proves the claim —
-- without it "your competitor is here" is an assertion the user cannot check,
-- and the first one that turns out wrong costs more trust than the feature
-- earns.
ALTER TABLE prospects ADD COLUMN competitor_presence TEXT NOT NULL DEFAULT '';

-- Only rows that actually carry a rival are ever read by the filter.
CREATE INDEX IF NOT EXISTS idx_prospects_competitor_presence
  ON prospects (workspace_id, product_id)
  WHERE competitor_presence <> '';
