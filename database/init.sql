CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  schedule_type TEXT DEFAULT 'once',
  schedule_value TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  config_json TEXT DEFAULT '{}',
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  status TEXT DEFAULT 'running',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT DEFAULT '',
  log_text TEXT DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  theme TEXT DEFAULT 'dark',
  download_folder TEXT DEFAULT '',
  python_path TEXT DEFAULT '',
  auto_start INTEGER DEFAULT 0,
  notifications INTEGER DEFAULT 1
);
