import { app, ipcMain, shell, nativeImage, globalShortcut } from "electron";
import { menubar } from "menubar";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { CopilotService } from "./copilot-service.js";
import { initDb, loadConfig, getConfig, setConfig, getConfigPath, closeDb } from "./database.js";

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
  await initDb();

  // Initialize copilot service
  await copilotService.initialize();

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

  // IPC handlers
  ipcMain.handle("chat", async (_event, prompt: string) => {
    try {
      const result = await copilotService.chat(prompt);
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
    return loadConfig();
  });

  ipcMain.handle("set-config", (_event, key: string, value: string) => {
    setConfig(key, value);

    // If shortcut changed, re-register it
    if (key === "shortcut") {
      registerShortcut(mb, value);
    }

    return { success: true };
  });

  ipcMain.handle("get-config-value", (_event, key: string) => {
    return getConfig(key);
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
