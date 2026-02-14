import { app, BrowserWindow, screen } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 700;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

let desktopWindow: BrowserWindow | null = null;
let isQuitting = false;

// Allow window to actually close when the app is quitting
app.on("before-quit", () => {
  isQuitting = true;
});

export function getOrCreateDesktopWindow(): BrowserWindow {
  // Reuse existing window if available (may be hidden after close)
  if (desktopWindow && !desktopWindow.isDestroyed()) {
    if (!desktopWindow.isVisible()) {
      if (app.dock) app.dock.show();
      desktopWindow.show();
    }
    desktopWindow.focus();
    return desktopWindow;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(DEFAULT_WIDTH, width - 100);
  const windowHeight = Math.min(DEFAULT_HEIGHT, height - 100);

  desktopWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "Copilot Bar",
    show: false,
    vibrancy: "under-window",
    visualEffectState: "active",
    trafficLightPosition: { x: 16, y: 16 },
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Center the window
  desktopWindow.center();

  // Load the same renderer but with a query param to indicate desktop mode
  desktopWindow.loadFile(join(__dirname, "..", "renderer", "index.html"), {
    query: { mode: "desktop" },
  }).catch((err) => {
    console.error("Failed to load desktop window:", err);
    if (desktopWindow && !desktopWindow.isDestroyed()) {
      desktopWindow.destroy();
      desktopWindow = null;
    }
  });

  desktopWindow.once("ready-to-show", () => {
    // Show dock icon so macOS allows foreground window focus
    if (app.dock) {
      app.dock.show();
    }
    desktopWindow?.show();
    desktopWindow?.focus();
  });

  // When the desktop window becomes visible again after being hidden,
  // tell the renderer to reload chat from DB (it missed IPC events while hidden)
  desktopWindow.on("show", () => {
    if (desktopWindow && !desktopWindow.isDestroyed() && !desktopWindow.webContents.isDestroyed()) {
      desktopWindow.webContents.send("reload-chat");
    }
  });

  // Intercept close: hide instead of destroy to return to menubar mode
  desktopWindow.on("close", (event) => {
    if (!isQuitting && desktopWindow && !desktopWindow.isDestroyed()) {
      event.preventDefault();
      desktopWindow.hide();
      if (app.dock) {
        app.dock.hide();
      }
    }
  });

  // Cleanup reference if the window is actually destroyed (app quit / crash)
  desktopWindow.on("closed", () => {
    desktopWindow = null;
  });

  desktopWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Desktop window renderer crashed:", details.reason);
    if (desktopWindow && !desktopWindow.isDestroyed()) {
      desktopWindow.destroy();
    }
    desktopWindow = null;
  });

  return desktopWindow;
}

export function getDesktopWindow(): BrowserWindow | null {
  return desktopWindow && !desktopWindow.isDestroyed() ? desktopWindow : null;
}

