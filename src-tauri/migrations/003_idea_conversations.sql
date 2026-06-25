-- Scope conversations to an idea. NULL idea_id = the global home-page conversation.
-- Existing rows (home conversations) keep idea_id = NULL.
ALTER TABLE conversations ADD COLUMN idea_id INTEGER REFERENCES ideas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_conversations_idea ON conversations(idea_id, updated_at DESC);
