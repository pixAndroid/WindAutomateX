import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import CryptoJS from 'crypto-js';
import type { Task, TaskStep, Run, Credential, Settings } from '../shared/types';

const ENCRYPTION_KEY = 'windautomatex-secret-key-2024';

let db: Database.Database;

export function initDatabase(userDataPath: string): void {
  const dbPath = path.join(userDataPath, 'windautomatex.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const initSqlPath = path.join(__dirname, '../../database/init.sql');
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, 'utf-8');
    db.exec(sql);
  } else {
    createTables();
  }

  // Mark any runs that were still 'running' when the app last closed as 'stopped'
  db.prepare("UPDATE runs SET status = 'stopped', ended_at = datetime('now') WHERE status = 'running'").run();

  // Insert default settings if not present
  const existingSettings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO settings (id, theme, download_folder, python_path, auto_start, notifications)
      VALUES (1, 'dark', '', '', 0, 1)
    `).run();
  } else {
    // Migrate: reset the old default 'python' so runtime detection takes over
    db.prepare(`UPDATE settings SET python_path = '' WHERE id = 1 AND python_path = 'python'`).run();
  }
}

function createTables(): void {
  db.exec(`
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
  `);
}

// Tasks CRUD
export function getTasks(): Task[] {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function getTask(id: number): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : undefined;
}

export function createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Task {
  const result = db.prepare(`
    INSERT INTO tasks (name, description, enabled, schedule_type, schedule_value)
    VALUES (?, ?, ?, ?, ?)
  `).run(task.name, task.description, task.enabled ? 1 : 0, task.schedule_type, task.schedule_value);
  return getTask(result.lastInsertRowid as number)!;
}

export function updateTask(id: number, task: Partial<Task>): Task {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (task.name !== undefined) { fields.push('name = ?'); values.push(task.name); }
  if (task.description !== undefined) { fields.push('description = ?'); values.push(task.description); }
  if (task.enabled !== undefined) { fields.push('enabled = ?'); values.push(task.enabled ? 1 : 0); }
  if (task.schedule_type !== undefined) { fields.push('schedule_type = ?'); values.push(task.schedule_type); }
  if (task.schedule_value !== undefined) { fields.push('schedule_value = ?'); values.push(task.schedule_value); }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTask(id)!;
}

export function deleteTask(id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string,
    enabled: Boolean(row.enabled),
    schedule_type: row.schedule_type as Task['schedule_type'],
    schedule_value: row.schedule_value as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// Steps CRUD
export function getSteps(taskId: number): TaskStep[] {
  return db.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order ASC').all(taskId) as TaskStep[];
}

export function saveSteps(taskId: number, steps: Omit<TaskStep, 'id'>[]): TaskStep[] {
  const deleteStmt = db.prepare('DELETE FROM task_steps WHERE task_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO task_steps (task_id, step_order, step_type, config_json)
    VALUES (?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    deleteStmt.run(taskId);
    for (const step of steps) {
      insertStmt.run(step.task_id, step.step_order, step.step_type, step.config_json);
    }
  });
  transaction();
  return getSteps(taskId);
}

// Runs CRUD
export function getRuns(taskId?: number): Run[] {
  const rows = taskId
    ? db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId)
    : db.prepare('SELECT * FROM runs ORDER BY started_at DESC').all();
  return (rows as Record<string, unknown>[]).map(rowToRun);
}

export function getRun(id: number): Run | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : undefined;
}

export function createRun(taskId: number): Run {
  const result = db.prepare(`
    INSERT INTO runs (task_id, status, started_at)
    VALUES (?, 'running', datetime('now'))
  `).run(taskId);
  return getRun(result.lastInsertRowid as number)!;
}

export function updateRun(id: number, data: Partial<Run>): Run {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.ended_at !== undefined) { fields.push('ended_at = ?'); values.push(data.ended_at); }
  if (data.log_text !== undefined) { fields.push('log_text = ?'); values.push(data.log_text); }
  values.push(id);
  db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getRun(id)!;
}

export function clearRuns(): void {
  db.prepare('DELETE FROM runs').run();
}

function rowToRun(row: Record<string, unknown>): Run {
  return {
    id: row.id as number,
    task_id: row.task_id as number,
    status: row.status as Run['status'],
    started_at: row.started_at as string,
    ended_at: row.ended_at as string,
    log_text: row.log_text as string,
  };
}

// Credentials CRUD
export function getCredentials(): Credential[] {
  return db.prepare('SELECT * FROM credentials').all() as Credential[];
}

export function createCredential(cred: Omit<Credential, 'id'>): Credential {
  const encrypted = CryptoJS.AES.encrypt(cred.password_encrypted, ENCRYPTION_KEY).toString();
  const result = db.prepare(`
    INSERT INTO credentials (name, username, password_encrypted)
    VALUES (?, ?, ?)
  `).run(cred.name, cred.username, encrypted);
  return db.prepare('SELECT * FROM credentials WHERE id = ?').get(result.lastInsertRowid as number) as Credential;
}

export function deleteCredential(id: number): void {
  db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
}

export function decryptPassword(encrypted: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// Settings
export function getSettings(): Settings {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>;
  return {
    theme: row.theme as 'dark' | 'light',
    download_folder: row.download_folder as string,
    python_path: row.python_path as string,
    auto_start: Boolean(row.auto_start),
    notifications: Boolean(row.notifications),
  };
}

export function saveSettings(settings: Settings): void {
  db.prepare(`
    UPDATE settings SET
      theme = ?,
      download_folder = ?,
      python_path = ?,
      auto_start = ?,
      notifications = ?
    WHERE id = 1
  `).run(
    settings.theme,
    settings.download_folder,
    settings.python_path,
    settings.auto_start ? 1 : 0,
    settings.notifications ? 1 : 0,
  );
}
