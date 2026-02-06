import "dotenv/config";
import { app, ipcMain, shell, nativeImage, globalShortcut } from "electron";
import { menubar } from "menubar";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { CopilotService } from "./copilot-service.js";
import {
  initDb,
  loadConfig,
  getConfig,
  setConfig,
  getConfigPath,
  closeDb,
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  listChatSessions,
  createChatSession,
  renameChatSession,
  deleteChatSession,
  getActiveChatSession,
  setActiveChatSession,
} from "./database.js";
import { captureAndUpload } from "./screenshot-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const copilotService = new CopilotService();

// Create menu bar icon from PNG file
function createIcon(): Electron.NativeImage {
  const iconPath = join(__dirname, "..", "..", "assets", "github-copilot-icon.png");

  if (existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    // Resize to 22x22 for menu bar (if needed)
    const resized = icon.resize({ width: 22, height: 22 });
    resized.setTemplateImage(true);
    return resized;
  }

  // Fallback if file not found
  console.warn("Icon not found at:", iconPath);
  const fallback = nativeImage.createEmpty();
  return fallback;
}

// Track current shortcut for re-registration
let currentShortcut: string | null = null;

// Register global shortcut
function registerShortcut(mb: ReturnType<typeof menubar>, shortcut: string): boolean {
  // Unregister previous shortcut if exists
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut);
  }

  try {
    const registered = globalShortcut.register(shortcut, () => {
      if (mb.window) {
        if (mb.window.isVisible()) {
          mb.hideWindow();
        } else {
          mb.showWindow();
          mb.window.focus();
        }
      }
    });

    if (registered) {
      currentShortcut = shortcut;
      console.log(`Global shortcut registered: ${shortcut}`);
      return true;
    } else {
      console.warn(`Failed to register shortcut: ${shortcut}`);
      return false;
    }
  } catch (error) {
    console.error(`Error registering shortcut: ${error}`);
    return false;
  }
}

app.whenReady().then(async () => {
  // Initialize database first
  console.log("Initializing database...");
  await initDb();
  console.log("Database initialized");

  // Initialize copilot service
  console.log("Initializing Copilot service...");
  await copilotService.initialize();
  console.log("Copilot service initialized");

  // Register IPC handlers BEFORE creating menubar (which preloads window)
  ipcMain.handle("chat", async (_event, prompt: string, sessionId?: number) => {
    try {
      const sid = typeof sessionId === "number" && sessionId > 0 ? sessionId : getActiveChatSession().id;
      const result = await copilotService.chat(prompt, sid);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("open-config", () => {
    shell.openPath(getConfigPath());
  });

  ipcMain.handle("get-config", () => {
    try {
      return loadConfig();
    } catch (error) {
      console.error("Error loading config:", error);
      return {
        model: "gpt-5-mini",
        shortcut: "CommandOrControl+Shift+T",
        theme: "dark",
      };
    }
  });

  ipcMain.handle("get-config-value", (_event, key: string) => {
    return getConfig(key);
  });

  ipcMain.handle("add-chat-message", (_event, role: string, content: string, sessionId?: number) => {
    return addChatMessage(role, content, sessionId);
  });

  ipcMain.handle("get-chat-history", (_event, sessionIdOrLimit?: number, limit?: number) => {
    // Backward compatible:
    // - get-chat-history(limit)
    // - get-chat-history(sessionId, limit)
    if (typeof sessionIdOrLimit === "number" && typeof limit === "undefined") {
      return getChatHistory(undefined, sessionIdOrLimit);
    }
    return getChatHistory(sessionIdOrLimit, limit);
  });

  ipcMain.handle("clear-chat-history", (_event, sessionId?: number) => {
    clearChatHistory(sessionId);
    return { success: true };
  });

  // Chat sessions
  ipcMain.handle("list-sessions", (_event, limit?: number) => {
    return listChatSessions(limit);
  });

  ipcMain.handle("get-active-session", () => {
    return getActiveChatSession();
  });

  ipcMain.handle("set-active-session", (_event, id: number) => {
    return setActiveChatSession(id);
  });

  ipcMain.handle("create-session", (_event, title?: string) => {
    const id = createChatSession(title);
    return getActiveChatSession();
  });

  ipcMain.handle("rename-session", (_event, id: number, title: string) => {
    renameChatSession(id, title);
    return { success: true };
  });

  ipcMain.handle("delete-session", (_event, id: number) => {
    return deleteChatSession(id);
  });

  ipcMain.handle("compact-session", async (_event, sessionId?: number) => {
    try {
      const sid = typeof sessionId === "number" && sessionId > 0 ? sessionId : getActiveChatSession().id;
      const history = getChatHistory(sid);
      const messagesBefore = history.length;

      const result = await copilotService.compactSession(sid);

      if (result.success && result.summary) {
        clearChatHistory(sid);
        addChatMessage("assistant", `**Conversation compacted** (${messagesBefore} messages → summary)\n\n${result.summary}`, sid);
      }

      return { success: true, messagesBefore, summary: result.summary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Compaction failed" };
    }
  });

  ipcMain.handle("quit-app", () => {
    app.quit();
  });

  ipcMain.handle("capture-screenshot", async () => {
    try {
      return await captureAndUpload();
    } catch (error) {
      console.error("Screenshot error:", error);
      return { success: false, error: error instanceof Error ? error.message : "Screenshot failed" };
    }
  });

  const icon = createIcon();

  const mb = menubar({
    index: `file://${join(__dirname, "..", "renderer", "index.html")}`,
    icon: icon,
    browserWindow: {
      width: 420,
      height: 500,
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    },
    preloadWindow: true,
  });

  // set-config needs mb reference, so register after
  ipcMain.handle("set-config", (_event, key: string, value: string) => {
    setConfig(key, value);
    if (key === "shortcut") {
      registerShortcut(mb, value);
    }
    return { success: true };
  });

  mb.on("ready", () => {
    console.log("Copilot Bar is ready");

    // Register global shortcut from config
    const config = loadConfig();
    registerShortcut(mb, config.shortcut);

    // Set up tool event handler to notify renderer
    copilotService.setToolEventHandler((event) => {
      if (mb.window) {
        mb.window.webContents.send("tool-event", event);
      }
    });

    // Set up widget event handler to render widgets in chat
    copilotService.setWidgetEventHandler((event) => {
      if (mb.window) {
        mb.window.webContents.send("render-widget", event);
      }
    });
  });

  // Cleanup on quit
  app.on("before-quit", async () => {
    await copilotService.cleanup();
    globalShortcut.unregisterAll();
    closeDb();
  });

  // Unregister shortcuts when app quits
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
});
