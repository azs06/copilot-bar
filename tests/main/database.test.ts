import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Mock node:fs to prevent filesystem side effects
// database.ts has a top-level mkdirSync call and saveDb() writes to disk
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import {
  initDb,
  getConfig,
  setConfig,
  getAllConfig,
  loadConfig,
  createNote,
  updateNote,
  getNote,
  listNotes,
  searchNotes,
  deleteNote,
  deleteAllNotes,
  countNotes,
  createTodo,
  listTodos,
  getTodo,
  completeTodo,
  deleteTodo,
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  createChatSession,
  listChatSessions,
  renameChatSession,
  deleteChatSession,
  getActiveChatSession,
  setActiveChatSession,
  closeDb,
} from "../../src/main/database.js";

beforeAll(async () => {
  await initDb();
});

describe("config", () => {
  it("loadConfig returns defaults on fresh database", () => {
    const config = loadConfig();
    expect(config.model).toBe("gpt-5-mini");
    expect(config.shortcut).toBe("CommandOrControl+Shift+T");
    expect(config.theme).toBe("dark");
  });

  it("setConfig/getConfig roundtrip works", () => {
    setConfig("test_key", "test_value");
    expect(getConfig("test_key")).toBe("test_value");
  });

  it("setConfig overwrites existing values", () => {
    setConfig("test_key", "first");
    setConfig("test_key", "second");
    expect(getConfig("test_key")).toBe("second");
  });

  it("getConfig returns null for non-existent key", () => {
    expect(getConfig("nonexistent_key_xyz")).toBeNull();
  });

  it("getAllConfig returns all key-value pairs", () => {
    const all = getAllConfig();
    expect(all.model).toBe("gpt-5-mini");
    expect(all.theme).toBe("dark");
  });
});

describe("notes", () => {
  beforeEach(() => {
    deleteAllNotes();
  });

  it("createNote returns positive ID", () => {
    const id = createNote("Hello world");
    expect(id).toBeGreaterThan(0);
  });

  it("getNote retrieves the note by ID", () => {
    const id = createNote("Test note");
    const note = getNote(id);
    expect(note).not.toBeNull();
    expect(note!.content).toBe("Test note");
    expect(note!.id).toBe(id);
  });

  it("getNote returns null for non-existent ID", () => {
    expect(getNote(99999)).toBeNull();
  });

  it("updateNote changes content", () => {
    const id = createNote("Original");
    updateNote(id, "Updated");
    const note = getNote(id);
    expect(note!.content).toBe("Updated");
  });

  it("listNotes returns notes", () => {
    createNote("Note A");
    createNote("Note B");
    const notes = listNotes();
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });

  it("listNotes respects limit", () => {
    createNote("One");
    createNote("Two");
    createNote("Three");
    const notes = listNotes(2);
    expect(notes).toHaveLength(2);
  });

  it("searchNotes finds matching notes", () => {
    createNote("Buy groceries");
    createNote("Clean house");
    createNote("Buy birthday gift");
    const results = searchNotes("Buy");
    expect(results.length).toBe(2);
  });

  it("searchNotes returns empty for no matches", () => {
    createNote("Hello");
    const results = searchNotes("zzzzz_no_match");
    expect(results).toHaveLength(0);
  });

  it("deleteNote removes the note", () => {
    const id = createNote("Delete me");
    deleteNote(id);
    expect(getNote(id)).toBeNull();
  });

  it("countNotes reflects current count", () => {
    expect(countNotes()).toBe(0);
    createNote("A");
    createNote("B");
    expect(countNotes()).toBe(2);
  });

  it("deleteAllNotes empties the table", () => {
    createNote("A");
    createNote("B");
    deleteAllNotes();
    expect(countNotes()).toBe(0);
  });
});

describe("todos", () => {
  beforeEach(() => {
    // Clean up todos before each test
    for (const t of listTodos("all")) {
      deleteTodo(t.id);
    }
  });

  it("createTodo returns positive ID", () => {
    const id = createTodo("Do laundry");
    expect(id).toBeGreaterThan(0);
  });

  it("getTodo retrieves the todo", () => {
    const id = createTodo("Walk the dog");
    const todo = getTodo(id);
    expect(todo).not.toBeNull();
    expect(todo!.content).toBe("Walk the dog");
    expect(todo!.completed).toBe(false);
  });

  it("getTodo returns null for non-existent ID", () => {
    expect(getTodo(99999)).toBeNull();
  });

  it("listTodos with all filter returns everything", () => {
    createTodo("Task A");
    createTodo("Task B");
    const todos = listTodos("all");
    expect(todos.length).toBeGreaterThanOrEqual(2);
  });

  it("listTodos with active filter excludes completed", () => {
    const id1 = createTodo("Active task");
    const id2 = createTodo("Completed task");
    completeTodo(id2);
    const active = listTodos("active");
    expect(active.every(t => !t.completed)).toBe(true);
    expect(active.some(t => t.id === id1)).toBe(true);
  });

  it("listTodos with completed filter returns only completed", () => {
    createTodo("Active");
    const doneId = createTodo("Done");
    completeTodo(doneId);
    const completed = listTodos("completed");
    expect(completed.every(t => t.completed)).toBe(true);
  });

  it("completeTodo marks the todo as done", () => {
    const id = createTodo("Finish report");
    completeTodo(id);
    const todo = getTodo(id);
    expect(todo!.completed).toBe(true);
  });

  it("deleteTodo removes the item", () => {
    const id = createTodo("Remove me");
    deleteTodo(id);
    expect(getTodo(id)).toBeNull();
  });
});

describe("chat sessions", () => {
  it("createChatSession returns positive ID", () => {
    const id = createChatSession("Test Session");
    expect(id).toBeGreaterThan(0);
  });

  it("createChatSession sets it as active", () => {
    const id = createChatSession("Active Session");
    const active = getActiveChatSession();
    expect(active.id).toBe(id);
  });

  it("listChatSessions returns created sessions", () => {
    createChatSession("Session A");
    const sessions = listChatSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some(s => s.title === "Session A")).toBe(true);
  });

  it("renameChatSession updates the title", () => {
    const id = createChatSession("Old Name");
    renameChatSession(id, "New Name");
    const sessions = listChatSessions();
    expect(sessions.find(s => s.id === id)?.title).toBe("New Name");
  });

  it("setActiveChatSession changes the active session", () => {
    const id1 = createChatSession("First");
    const id2 = createChatSession("Second");
    setActiveChatSession(id1);
    expect(getActiveChatSession().id).toBe(id1);
  });

  it("deleteChatSession falls back when deleting active session", () => {
    const id1 = createChatSession("Keep");
    const id2 = createChatSession("Delete");
    // id2 is now active (createChatSession sets it active)
    const result = deleteChatSession(id2);
    expect(result.activeSessionId).toBeGreaterThan(0);
    expect(result.activeSessionId).not.toBe(id2);
  });
});

describe("chat history", () => {
  let sessionId: number;

  beforeEach(() => {
    sessionId = createChatSession("History Test");
  });

  it("addChatMessage inserts a message", () => {
    const msgId = addChatMessage("user", "Hello", sessionId);
    expect(msgId).toBeGreaterThan(0);
  });

  it("getChatHistory returns messages in chronological order", () => {
    addChatMessage("user", "First", sessionId);
    addChatMessage("assistant", "Second", sessionId);
    const history = getChatHistory(sessionId);
    expect(history.length).toBe(2);
    expect(history[0].content).toBe("First");
    expect(history[1].content).toBe("Second");
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });

  it("clearChatHistory removes messages for the session", () => {
    addChatMessage("user", "Temp", sessionId);
    clearChatHistory(sessionId);
    const history = getChatHistory(sessionId);
    expect(history).toHaveLength(0);
  });

  it("clearChatHistory does not affect other sessions", () => {
    const otherId = createChatSession("Other");
    addChatMessage("user", "Keep this", otherId);
    addChatMessage("user", "Delete this", sessionId);
    clearChatHistory(sessionId);
    const otherHistory = getChatHistory(otherId);
    expect(otherHistory.length).toBe(1);
    expect(otherHistory[0].content).toBe("Keep this");
  });
});
