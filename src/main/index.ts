import { app, ipcMain, shell, nativeImage } from "electron";
import { menubar } from "menubar";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { CopilotService } from "./copilot-service.js";
import { getConfigPath, loadConfig } from "./config.js";

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

app.whenReady().then(async () => {
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

  // Cleanup on quit
  app.on("before-quit", async () => {
    await copilotService.cleanup();
  });
});
