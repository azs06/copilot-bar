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
  `);

  // Initialize default config if not exists
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    db.run("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", [key, value]);
  }

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
