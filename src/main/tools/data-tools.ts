import { defineTool } from "@github/copilot-sdk";
import { createNote, updateNote, getNote, listNotes, searchNotes, deleteNote, deleteAllNotes, countNotes, createTodo, listTodos, getTodo, completeTodo, deleteTodo } from "../database.js";

// Notes tools (quick notes / sticky notes)
const createNoteTool = defineTool("create_note", {
  description: "Create a new sticky note/quick note. The note will be saved and can be retrieved later.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The content/text of the note to save",
      },
    },
    required: ["content"],
  },
  handler: async ({ content }: { content: string }) => {
    try {
      const id = createNote(content);
      return {
        success: true,
        id,
        content,
        message: `Note created with ID ${id}`,
        preview: content.length > 50 ? content.substring(0, 50) + "..." : content
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to create note: ${error.message}`
      };
    }
  },
});

const listNotesTool = defineTool("list_notes", {
  description: "List all saved notes/quick notes. Returns notes sorted by most recently updated.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of notes to return (default: 20)",
      },
    },
  },
  handler: async ({ limit }: { limit?: number }) => {
    try {
      const notes = listNotes(limit || 20);
      return {
        success: true,
        count: notes.length,
        notes: notes.map(n => ({
          id: n.id,
          preview: n.content.length > 100 ? n.content.substring(0, 100) + "..." : n.content,
          content: n.content,
          created_at: n.created_at,
          updated_at: n.updated_at
        })),
        message: notes.length === 0 ? "No notes found" : `Found ${notes.length} note(s)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list notes: ${error.message}`
      };
    }
  },
});

const getNoteTool = defineTool("get_note", {
  description: "Get the full content of a specific note by its ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "The ID of the note to retrieve",
      },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: number }) => {
    try {
      const note = getNote(id);
      if (!note) {
        return {
          success: false,
          error: `Note with ID ${id} not found`
        };
      }
      return {
        success: true,
        id: note.id,
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to get note: ${error.message}`
      };
    }
  },
});

const updateNoteTool = defineTool("update_note", {
  description: "Update the content of an existing note by its ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "The ID of the note to update",
      },
      content: {
        type: "string",
        description: "The new content for the note",
      },
    },
    required: ["id", "content"],
  },
  handler: async ({ id, content }: { id: number; content: string }) => {
    try {
      const note = getNote(id);
      if (!note) {
        return {
          success: false,
          error: `Note with ID ${id} not found`
        };
      }
      updateNote(id, content);
      return {
        success: true,
        id,
        message: `Note ${id} updated successfully`,
        preview: content.length > 50 ? content.substring(0, 50) + "..." : content
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to update note: ${error.message}`
      };
    }
  },
});

const searchNotesTool = defineTool("search_notes", {
  description: "Search through all notes by content. Returns notes that contain the search query.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search term to look for in notes",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default: 10)",
      },
    },
    required: ["query"],
  },
  handler: async ({ query, limit }: { query: string; limit?: number }) => {
    try {
      const notes = searchNotes(query, limit || 10);
      return {
        success: true,
        query,
        count: notes.length,
        notes: notes.map(n => ({
          id: n.id,
          preview: n.content.length > 100 ? n.content.substring(0, 100) + "..." : n.content,
          content: n.content,
          created_at: n.created_at,
          updated_at: n.updated_at
        })),
        message: notes.length === 0 ? `No notes found matching "${query}"` : `Found ${notes.length} note(s) matching "${query}"`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to search notes: ${error.message}`
      };
    }
  },
});

const deleteNoteTool = defineTool("delete_note", {
  description: "Delete a specific note by its ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "The ID of the note to delete",
      },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: number }) => {
    try {
      const note = getNote(id);
      if (!note) {
        return {
          success: false,
          error: `Note with ID ${id} not found`
        };
      }
      deleteNote(id);
      return {
        success: true,
        id,
        message: `Note ${id} deleted successfully`,
        deleted_preview: note.content.length > 50 ? note.content.substring(0, 50) + "..." : note.content
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to delete note: ${error.message}`
      };
    }
  },
});

const deleteAllNotesTool = defineTool("delete_all_notes", {
  description: "Delete all saved notes. Use with caution - this cannot be undone!",
  parameters: {
    type: "object",
    properties: {
      confirm: {
        type: "boolean",
        description: "Must be set to true to confirm deletion of all notes",
      },
    },
    required: ["confirm"],
  },
  handler: async ({ confirm }: { confirm: boolean }) => {
    if (!confirm) {
      return {
        success: false,
        error: "Confirmation required. Set confirm to true to delete all notes."
      };
    }
    try {
      const countBefore = countNotes();
      deleteAllNotes();
      return {
        success: true,
        deleted_count: countBefore,
        message: `Deleted all ${countBefore} note(s)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to delete all notes: ${error.message}`
      };
    }
  },
});

// Todo tools (SQLite-backed via database.ts)
const createTodoTool = defineTool("create_todo", {
  description: "Create a new todo item/task.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The todo task description",
      },
    },
    required: ["text"],
  },
  handler: async ({ text }: { text: string }) => {
    try {
      const id = createTodo(text);
      return { success: true, id, text, message: `Created todo: "${text}"` };
    } catch (error: any) {
      return { success: false, error: `Failed to create todo: ${error.message}` };
    }
  },
});

const listTodosTool = defineTool("list_todos", {
  description: "List all todo items, optionally filtered by completion status.",
  parameters: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: ["all", "active", "completed"],
        description: "Filter todos by status: all, active (not completed), or completed",
      },
    },
  },
  handler: async ({ filter = "all" }: { filter?: "all" | "active" | "completed" }) => {
    try {
      const todoList = listTodos(filter);
      return {
        success: true,
        count: todoList.length,
        todos: todoList.map(t => ({
          id: t.id,
          text: t.content,
          completed: t.completed,
          createdAt: t.created_at
        })),
        message: `Found ${todoList.length} todo(s)`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to list todos: ${error.message}` };
    }
  },
});

const completeTodoTool = defineTool("complete_todo", {
  description: "Mark a todo item as completed.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "The ID of the todo to complete",
      },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: number }) => {
    try {
      const todo = getTodo(id);
      if (!todo) {
        return { success: false, error: `Todo with ID ${id} not found` };
      }
      completeTodo(id);
      return { success: true, id, text: todo.content, message: `Completed: "${todo.content}"` };
    } catch (error: any) {
      return { success: false, error: `Failed to complete todo: ${error.message}` };
    }
  },
});

const deleteTodoTool = defineTool("delete_todo", {
  description: "Delete a todo item by ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "The ID of the todo to delete",
      },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: number }) => {
    try {
      const todo = getTodo(id);
      if (!todo) {
        return { success: false, error: `Todo with ID ${id} not found` };
      }
      deleteTodo(id);
      return { success: true, id, text: todo.content, message: `Deleted: "${todo.content}"` };
    } catch (error: any) {
      return { success: false, error: `Failed to delete todo: ${error.message}` };
    }
  },
});

export const dataTools = [
  createNoteTool,
  listNotesTool,
  getNoteTool,
  updateNoteTool,
  searchNotesTool,
  deleteNoteTool,
  deleteAllNotesTool,
  createTodoTool,
  listTodosTool,
  completeTodoTool,
  deleteTodoTool,
];
