import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".copilot-bar");
const DB_PATH = join(CONFIG_DIR, "copilot-bar.db");

// Ensure config directory exists
if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// Default config values
const DEFAULT_CONFIG: Record<string, string> = {
  model: "gpt-5-mini",
  shortcut: "CommandOrControl+Shift+T",
  theme: "dark",
};

let db: SqlJsDatabase | null = null;

export interface ChatSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

function hasColumn(database: SqlJsDatabase, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  if (result.length === 0) return false;
  return result[0].values.some((row) => row[1] === column);
}

function getSingleNumber(database: SqlJsDatabase, sql: string, params: any[] = []): number | null {
  const result = database.exec(sql, params);
  const value = result[0]?.values?.[0]?.[0];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return null;
}

function formatSessionTitleFromTimestamp(date: Date = new Date()): string {
  // Example: "Jan 28, 1:23 AM"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ensureDefaultChatSession(database: SqlJsDatabase): number {
  const existing = getSingleNumber(database, "SELECT id FROM chat_sessions ORDER BY id ASC LIMIT 1");
  if (existing) return existing;

  database.run("INSERT INTO chat_sessions (title) VALUES (?)", [formatSessionTitleFromTimestamp()]);
  saveDb();
  return getSingleNumber(database, "SELECT last_insert_rowid()") || 1;
}

function getActiveSessionId(database: SqlJsDatabase): number {
  const raw = getConfig("active_session_id");
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isNaN(parsed) && parsed > 0) {
    const exists = getSingleNumber(database, "SELECT id FROM chat_sessions WHERE id = ? LIMIT 1", [parsed]);
    if (exists) return parsed;
  }

  const fallback = ensureDefaultChatSession(database);
  setConfig("active_session_id", String(fallback));
  return fallback;
}

// Initialize database asynchronously
async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME
    );
  `);

  // Initialize default config if not exists
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    db.run("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", [key, value]);
  }

  // Migrations for chat sessions
  if (!hasColumn(db, "chat_history", "session_id")) {
    db.run("ALTER TABLE chat_history ADD COLUMN session_id INTEGER");
  }

  // Ensure at least one session exists and mark it active if needed
  const defaultSessionId = ensureDefaultChatSession(db);
  if (!getConfig("active_session_id")) {
    setConfig("active_session_id", String(defaultSessionId));
  }

  // Backfill existing rows into the default session
  db.run("UPDATE chat_history SET session_id = ? WHERE session_id IS NULL", [defaultSessionId]);

  // Index for session-scoped history queries
  db.run("CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id, id)");

  saveDb();
  return db;
}

// Save database to file
function saveDb(): void {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  }
}

// Synchronous database getter (assumes initDb was called)
function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

// Config functions
export function getConfig(key: string): string | null {
  const database = getDb();
  const result = database.exec("SELECT value FROM config WHERE key = ?", [key]);
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as string;
  }
  return null;
}

export function setConfig(key: string, value: string): void {
  const database = getDb();
  database.run(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    [key, value, value]
  );
  saveDb();
}

export function getAllConfig(): Record<string, string> {
  const database = getDb();
  const result = database.exec("SELECT key, value FROM config");
  const config: Record<string, string> = {};
  if (result.length > 0) {
    for (const row of result[0].values) {
      config[row[0] as string] = row[1] as string;
    }
  }
  return config;
}

// Convenience function for backward compatibility
export function loadConfig(): { model: string; shortcut: string; theme: string } {
  return {
    model: getConfig("model") || DEFAULT_CONFIG.model,
    shortcut: getConfig("shortcut") || DEFAULT_CONFIG.shortcut,
    theme: getConfig("theme") || DEFAULT_CONFIG.theme,
  };
}

// Get the config directory path (for opening in Finder)
export function getConfigPath(): string {
  return CONFIG_DIR;
}

export function getDbPath(): string {
  return DB_PATH;
}

// Chat history functions
export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "error" | "tool";
  content: string;
  timestamp: string;
}

export function addChatMessage(role: string, content: string, sessionId?: number): number {
  const database = getDb();
  const sid = sessionId ?? getActiveSessionId(database);
  database.run(
    "INSERT INTO chat_history (role, content, session_id) VALUES (?, ?, ?)",
    [role, content, sid]
  );
  database.run(
    "UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP, last_message_at = CURRENT_TIMESTAMP WHERE id = ?",
    [sid]
  );
  saveDb();
  const result = database.exec("SELECT last_insert_rowid()");
  return result[0]?.values[0]?.[0] as number || 0;
}

export function getChatHistory(sessionId?: number, limit: number = 100): ChatMessage[] {
  const database = getDb();
  const sid = sessionId ?? getActiveSessionId(database);
  const result = database.exec(
    `SELECT id, role, content, timestamp FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?`,
    [sid, limit]
  );
  if (result.length === 0) return [];
  
  return result[0].values.map((row) => ({
    id: row[0] as number,
    role: row[1] as "user" | "assistant" | "error" | "tool",
    content: row[2] as string,
    timestamp: row[3] as string,
  })).reverse(); // Return in chronological order
}

export function clearChatHistory(sessionId?: number): void {
  const database = getDb();
  const sid = sessionId ?? getActiveSessionId(database);
  database.run("DELETE FROM chat_history WHERE session_id = ?", [sid]);
  database.run("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sid]);
  saveDb();
}

// Chat session functions
export function listChatSessions(limit: number = 50): ChatSession[] {
  const database = getDb();
  const result = database.exec(
    `SELECT id, title, created_at, updated_at, last_message_at
     FROM chat_sessions
     ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
     LIMIT ?`,
    [limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0] as number,
    title: row[1] as string,
    created_at: row[2] as string,
    updated_at: row[3] as string,
    last_message_at: (row[4] as string | null) ?? null,
  }));
}

export function createChatSession(title?: string): number {
  const database = getDb();
  const finalTitle = (title && title.trim()) ? title.trim() : formatSessionTitleFromTimestamp();
  database.run("INSERT INTO chat_sessions (title) VALUES (?)", [finalTitle]);
  saveDb();
  const id = getSingleNumber(database, "SELECT last_insert_rowid()") || 0;
  if (id > 0) {
    setConfig("active_session_id", String(id));
  }
  return id;
}

export function renameChatSession(id: number, title: string): void {
  const database = getDb();
  const finalTitle = title.trim();
  if (!finalTitle) return;
  database.run("UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [finalTitle, id]);
  saveDb();
}

export function deleteChatSession(id: number): { activeSessionId: number } {
  const database = getDb();
  const activeRaw = getConfig("active_session_id");
  const activeBefore = activeRaw ? Number.parseInt(activeRaw, 10) : NaN;

  database.run("DELETE FROM chat_history WHERE session_id = ?", [id]);
  database.run("DELETE FROM chat_sessions WHERE id = ?", [id]);

  // Ensure there is always an active session
  if (!Number.isNaN(activeBefore) && activeBefore === id) {
    const next = getSingleNumber(database, "SELECT id FROM chat_sessions ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 1");
    const fallback = next || ensureDefaultChatSession(database);
    setConfig("active_session_id", String(fallback));
  }

  saveDb();
  return { activeSessionId: getActiveSessionId(database) };
}

export function setActiveChatSession(id: number): { id: number; title: string } {
  const database = getDb();
  const exists = getSingleNumber(database, "SELECT id FROM chat_sessions WHERE id = ? LIMIT 1", [id]);
  const sid = exists || ensureDefaultChatSession(database);
  setConfig("active_session_id", String(sid));
  const titleResult = database.exec("SELECT title FROM chat_sessions WHERE id = ? LIMIT 1", [sid]);
  const title = (titleResult[0]?.values?.[0]?.[0] as string) || "Chat";
  return { id: sid, title };
}

export function getActiveChatSession(): { id: number; title: string } {
  const database = getDb();
  const sid = getActiveSessionId(database);
  const titleResult = database.exec("SELECT title FROM chat_sessions WHERE id = ? LIMIT 1", [sid]);
  const title = (titleResult[0]?.values?.[0]?.[0] as string) || "Chat";
  return { id: sid, title };
}

// Note functions
export interface Note {
  id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export function createNote(content: string): number {
  const database = getDb();
  database.run(
    "INSERT INTO notes (content) VALUES (?)",
    [content]
  );
  saveDb();
  const id = getSingleNumber(database, "SELECT last_insert_rowid()");
  if (!id || id <= 0) throw new Error("Failed to create note");
  return id;
}

export function updateNote(id: number, content: string): boolean {
  const database = getDb();
  database.run(
    "UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [content, id]
  );
  saveDb();
  return true;
}

export function getNote(id: number): Note | null {
  const database = getDb();
  const result = database.exec(
    "SELECT id, content, created_at, updated_at FROM notes WHERE id = ?",
    [id]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    content: row[1] as string,
    created_at: row[2] as string,
    updated_at: row[3] as string,
  };
}

export function listNotes(limit: number = 50): Note[] {
  const database = getDb();
  const result = database.exec(
    `SELECT id, content, created_at, updated_at FROM notes ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0] as number,
    content: row[1] as string,
    created_at: row[2] as string,
    updated_at: row[3] as string,
  }));
}

export function searchNotes(query: string, limit: number = 20): Note[] {
  const database = getDb();
  // Escape LIKE wildcards (% and _) in the user query
  const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
  const searchPattern = `%${escaped}%`;
  const result = database.exec(
    `SELECT id, content, created_at, updated_at FROM notes WHERE content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`,
    [searchPattern, limit]
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0] as number,
    content: row[1] as string,
    created_at: row[2] as string,
    updated_at: row[3] as string,
  }));
}

export function deleteNote(id: number): boolean {
  const database = getDb();
  database.run("DELETE FROM notes WHERE id = ?", [id]);
  saveDb();
  return true;
}

export function countNotes(): number {
  const database = getDb();
  return getSingleNumber(database, "SELECT COUNT(*) FROM notes") || 0;
}

export function deleteAllNotes(): void {
  const database = getDb();
  database.run("DELETE FROM notes");
  saveDb();
}

// Todo functions
export interface TodoItem {
  id: number;
  content: string;
  completed: boolean;
  created_at: string;
}

export function createTodo(content: string): number {
  const database = getDb();
  database.run("INSERT INTO todos (content) VALUES (?)", [content]);
  saveDb();
  const id = getSingleNumber(database, "SELECT last_insert_rowid()");
  if (!id || id <= 0) throw new Error("Failed to create todo");
  return id;
}

export function listTodos(filter: "all" | "active" | "completed" = "all", limit: number = 100): TodoItem[] {
  const database = getDb();
  let sql = "SELECT id, content, completed, created_at FROM todos";
  const params: any[] = [];
  if (filter === "active") {
    sql += " WHERE completed = 0";
  } else if (filter === "completed") {
    sql += " WHERE completed = 1";
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const result = database.exec(sql, params);
  if (result.length === 0) return [];
  return result[0].values.map((row) => ({
    id: row[0] as number,
    content: row[1] as string,
    completed: (row[2] as number) === 1,
    created_at: row[3] as string,
  }));
}

export function getTodo(id: number): TodoItem | null {
  const database = getDb();
  const result = database.exec(
    "SELECT id, content, completed, created_at FROM todos WHERE id = ?",
    [id]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    content: row[1] as string,
    completed: (row[2] as number) === 1,
    created_at: row[3] as string,
  };
}

export function completeTodo(id: number): boolean {
  const database = getDb();
  database.run("UPDATE todos SET completed = 1 WHERE id = ?", [id]);
  saveDb();
  return getTodo(id)?.completed === true;
}

export function deleteTodo(id: number): void {
  const database = getDb();
  database.run("DELETE FROM todos WHERE id = ?", [id]);
  saveDb();
}

// Close database
export function closeDb(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}

// Export init function
export { initDb };
