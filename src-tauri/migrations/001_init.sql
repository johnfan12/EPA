PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  research_area TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idea_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  target_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dataset TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '',
  raw_output TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  conclusion TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type,
  entity_id UNINDEXED,
  idea_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS ideas_touch_updated
AFTER UPDATE ON ideas
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE ideas SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS reports_touch_updated
AFTER UPDATE ON reports
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS ideas_ai_search
AFTER INSERT ON ideas
BEGIN
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('idea', NEW.id, NEW.id, NEW.title, NEW.research_area || ' ' || NEW.tags || ' ' || NEW.brief);
END;

CREATE TRIGGER IF NOT EXISTS ideas_au_search
AFTER UPDATE ON ideas
BEGIN
  DELETE FROM search_index WHERE entity_type = 'idea' AND entity_id = NEW.id;
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('idea', NEW.id, NEW.id, NEW.title, NEW.research_area || ' ' || NEW.tags || ' ' || NEW.brief);
END;

CREATE TRIGGER IF NOT EXISTS ideas_ad_search
AFTER DELETE ON ideas
BEGIN
  DELETE FROM search_index WHERE idea_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS entries_ai_search
AFTER INSERT ON idea_entries
BEGIN
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('entry', NEW.id, NEW.idea_id, NEW.title, NEW.content || ' ' || NEW.summary || ' ' || NEW.source);
END;

CREATE TRIGGER IF NOT EXISTS entries_au_search
AFTER UPDATE ON idea_entries
BEGIN
  DELETE FROM search_index WHERE entity_type = 'entry' AND entity_id = NEW.id;
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('entry', NEW.id, NEW.idea_id, NEW.title, NEW.content || ' ' || NEW.summary || ' ' || NEW.source);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad_search
AFTER DELETE ON idea_entries
BEGIN
  DELETE FROM search_index WHERE entity_type = 'entry' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS agent_runs_ai_search
AFTER INSERT ON agent_runs
BEGIN
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('agent_run', NEW.id, NEW.idea_id, NEW.target_agent || ' ' || NEW.task_type, NEW.prompt || ' ' || NEW.output || ' ' || NEW.summary);
END;

CREATE TRIGGER IF NOT EXISTS agent_runs_au_search
AFTER UPDATE ON agent_runs
BEGIN
  DELETE FROM search_index WHERE entity_type = 'agent_run' AND entity_id = NEW.id;
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('agent_run', NEW.id, NEW.idea_id, NEW.target_agent || ' ' || NEW.task_type, NEW.prompt || ' ' || NEW.output || ' ' || NEW.summary);
END;

CREATE TRIGGER IF NOT EXISTS agent_runs_ad_search
AFTER DELETE ON agent_runs
BEGIN
  DELETE FROM search_index WHERE entity_type = 'agent_run' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS experiments_ai_search
AFTER INSERT ON experiments
BEGIN
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('experiment', NEW.id, NEW.idea_id, NEW.name, NEW.dataset || ' ' || NEW.method || ' ' || NEW.config || ' ' || NEW.raw_output || ' ' || NEW.metrics_json || ' ' || NEW.conclusion);
END;

CREATE TRIGGER IF NOT EXISTS experiments_au_search
AFTER UPDATE ON experiments
BEGIN
  DELETE FROM search_index WHERE entity_type = 'experiment' AND entity_id = NEW.id;
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('experiment', NEW.id, NEW.idea_id, NEW.name, NEW.dataset || ' ' || NEW.method || ' ' || NEW.config || ' ' || NEW.raw_output || ' ' || NEW.metrics_json || ' ' || NEW.conclusion);
END;

CREATE TRIGGER IF NOT EXISTS experiments_ad_search
AFTER DELETE ON experiments
BEGIN
  DELETE FROM search_index WHERE entity_type = 'experiment' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS reports_ai_search
AFTER INSERT ON reports
BEGIN
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('report', NEW.id, NEW.idea_id, NEW.title, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS reports_au_search
AFTER UPDATE ON reports
BEGIN
  DELETE FROM search_index WHERE entity_type = 'report' AND entity_id = NEW.id;
  INSERT INTO search_index(entity_type, entity_id, idea_id, title, body)
  VALUES ('report', NEW.id, NEW.idea_id, NEW.title, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS reports_ad_search
AFTER DELETE ON reports
BEGIN
  DELETE FROM search_index WHERE entity_type = 'report' AND entity_id = OLD.id;
END;
