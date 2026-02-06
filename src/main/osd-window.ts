import { BrowserWindow, screen } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OSD_WIDTH = 200;
const OSD_HEIGHT = 200;
const OSD_DISMISS_MS = 1500;

let osdWindow: BrowserWindow | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function getOrCreateWindow(): BrowserWindow {
  if (osdWindow && !osdWindow.isDestroyed()) return osdWindow;

  osdWindow = new BrowserWindow({
    width: OSD_WIDTH,
    height: OSD_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    vibrancy: "hud",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  osdWindow.setIgnoreMouseEvents(true);
  osdWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep on top even over full-screen apps
  osdWindow.setAlwaysOnTop(true, "screen-saver");

  osdWindow.loadFile(join(__dirname, "..", "renderer", "osd.html"));

  osdWindow.on("closed", () => {
    osdWindow = null;
  });

  return osdWindow;
}

export function showOSD(type: "volume" | "brightness" | "mute", level: number): void {
  const win = getOrCreateWindow();

  // Position at bottom center of primary display
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  win.setPosition(
    Math.round((width - OSD_WIDTH) / 2),
    Math.round(height - OSD_HEIGHT - 60),
  );

  // Send data once the page is ready, or immediately if already loaded
  const send = () => win.webContents.send("osd-update", { type, level });
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }

  win.showInactive();

  // Reset auto-hide timer (debounced for rapid changes)
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (osdWindow && !osdWindow.isDestroyed()) {
      osdWindow.hide();
    }
  }, OSD_DISMISS_MS);
}
