import { describe, it, expect, vi } from "vitest";

// Mock the database module
vi.mock("../../../src/main/database.js", () => ({
  createNote: vi.fn(() => 1),
  updateNote: vi.fn(() => true),
  getNote: vi.fn(() => null),
  listNotes: vi.fn(() => []),
  searchNotes: vi.fn(() => []),
  deleteNote: vi.fn(() => true),
  deleteAllNotes: vi.fn(),
  countNotes: vi.fn(() => 0),
  createTodo: vi.fn(() => 1),
  listTodos: vi.fn(() => []),
  getTodo: vi.fn(() => null),
  completeTodo: vi.fn(() => true),
  deleteTodo: vi.fn(),
}));

import { dataTools } from "../../../src/main/tools/data-tools.js";
import { createNote, getNote, listNotes, searchNotes, countNotes, createTodo, getTodo, listTodos, completeTodo } from "../../../src/main/database.js";

function findTool(name: string) {
  const tool = dataTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool as unknown as { handler: (args: any) => Promise<any> };
}

describe("create_note", () => {
  it("returns success with id and preview", async () => {
    vi.mocked(createNote).mockReturnValueOnce(42);
    const result = await findTool("create_note").handler({ content: "Hello world" });
    expect(result.success).toBe(true);
    expect(result.id).toBe(42);
    expect(result.preview).toBe("Hello world");
  });

  it("truncates long preview", async () => {
    vi.mocked(createNote).mockReturnValueOnce(1);
    const long = "a".repeat(100);
    const result = await findTool("create_note").handler({ content: long });
    expect(result.preview).toBe("a".repeat(50) + "...");
  });

  it("returns error on failure", async () => {
    vi.mocked(createNote).mockImplementationOnce(() => { throw new Error("DB error"); });
    const result = await findTool("create_note").handler({ content: "fail" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("DB error");
  });
});

describe("get_note", () => {
  it("returns error for non-existent ID", async () => {
    vi.mocked(getNote).mockReturnValueOnce(null);
    const result = await findTool("get_note").handler({ id: 999 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns note content when found", async () => {
    vi.mocked(getNote).mockReturnValueOnce({
      id: 1, content: "Hello", created_at: "2025-01-01", updated_at: "2025-01-01",
    });
    const result = await findTool("get_note").handler({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello");
  });
});

describe("update_note", () => {
  it("returns error when note not found", async () => {
    vi.mocked(getNote).mockReturnValueOnce(null);
    const result = await findTool("update_note").handler({ id: 99, content: "new" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns success when note exists", async () => {
    vi.mocked(getNote).mockReturnValueOnce({
      id: 1, content: "old", created_at: "2025-01-01", updated_at: "2025-01-01",
    });
    const result = await findTool("update_note").handler({ id: 1, content: "new" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("updated");
  });
});

describe("list_notes", () => {
  it("returns notes from database", async () => {
    vi.mocked(listNotes).mockReturnValueOnce([
      { id: 1, content: "Note A", created_at: "2025-01-01", updated_at: "2025-01-01" },
      { id: 2, content: "Note B", created_at: "2025-01-02", updated_at: "2025-01-02" },
    ]);
    const result = await findTool("list_notes").handler({});
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.notes[0].id).toBe(1);
  });

  it("passes limit to database", async () => {
    vi.mocked(listNotes).mockReturnValueOnce([]);
    await findTool("list_notes").handler({ limit: 5 });
    expect(listNotes).toHaveBeenCalledWith(5);
  });
});

describe("search_notes", () => {
  it("returns matching notes with previews", async () => {
    vi.mocked(searchNotes).mockReturnValueOnce([
      { id: 1, content: "Buy groceries", created_at: "2025-01-01", updated_at: "2025-01-01" },
    ]);
    const result = await findTool("search_notes").handler({ query: "Buy" });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.query).toBe("Buy");
  });

  it("returns no-match message when empty", async () => {
    vi.mocked(searchNotes).mockReturnValueOnce([]);
    const result = await findTool("search_notes").handler({ query: "xyz" });
    expect(result.message).toContain("No notes found");
  });
});

describe("delete_note", () => {
  it("returns error for non-existent note", async () => {
    vi.mocked(getNote).mockReturnValueOnce(null);
    const result = await findTool("delete_note").handler({ id: 99 });
    expect(result.success).toBe(false);
  });

  it("returns success with preview when note exists", async () => {
    vi.mocked(getNote).mockReturnValueOnce({
      id: 1, content: "Delete me", created_at: "2025-01-01", updated_at: "2025-01-01",
    });
    const result = await findTool("delete_note").handler({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.deleted_preview).toBe("Delete me");
  });
});

describe("delete_all_notes", () => {
  it("rejects without confirm", async () => {
    const result = await findTool("delete_all_notes").handler({ confirm: false });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Confirmation required");
  });

  it("succeeds with confirm", async () => {
    vi.mocked(countNotes).mockReturnValueOnce(5);
    const result = await findTool("delete_all_notes").handler({ confirm: true });
    expect(result.success).toBe(true);
    expect(result.deleted_count).toBe(5);
  });
});

describe("create_todo", () => {
  it("returns success with id and text", async () => {
    vi.mocked(createTodo).mockReturnValueOnce(10);
    const result = await findTool("create_todo").handler({ text: "Do laundry" });
    expect(result.success).toBe(true);
    expect(result.id).toBe(10);
    expect(result.text).toBe("Do laundry");
  });
});

describe("list_todos", () => {
  it("passes filter to database function", async () => {
    vi.mocked(listTodos).mockReturnValueOnce([]);
    await findTool("list_todos").handler({ filter: "active" });
    expect(listTodos).toHaveBeenCalledWith("active");
  });

  it("defaults to all filter", async () => {
    vi.mocked(listTodos).mockReturnValueOnce([]);
    await findTool("list_todos").handler({});
    expect(listTodos).toHaveBeenCalledWith("all");
  });
});

describe("complete_todo", () => {
  it("returns error for non-existent ID", async () => {
    vi.mocked(getTodo).mockReturnValueOnce(null);
    const result = await findTool("complete_todo").handler({ id: 999 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("completes existing todo", async () => {
    vi.mocked(getTodo).mockReturnValueOnce({
      id: 1, content: "Task", completed: false, created_at: "2025-01-01",
    });
    const result = await findTool("complete_todo").handler({ id: 1 });
    expect(result.success).toBe(true);
    expect(completeTodo).toHaveBeenCalledWith(1);
  });
});

describe("delete_todo", () => {
  it("returns error for non-existent ID", async () => {
    vi.mocked(getTodo).mockReturnValueOnce(null);
    const result = await findTool("delete_todo").handler({ id: 999 });
    expect(result.success).toBe(false);
  });

  it("deletes existing todo", async () => {
    vi.mocked(getTodo).mockReturnValueOnce({
      id: 1, content: "Remove", completed: false, created_at: "2025-01-01",
    });
    const result = await findTool("delete_todo").handler({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.text).toBe("Remove");
  });
});
