import { CopilotClient, type CopilotSession, defineTool } from "@github/copilot-sdk";
import { Notification } from "electron";
import { loadConfig, createNote, updateNote, getNote, listNotes, searchNotes, deleteNote, deleteAllNotes, countNotes, createTodo, listTodos, getTodo, completeTodo, deleteTodo, type TodoItem } from "./database.js";
import { captureAndUpload, isS3Configured } from "./screenshot-service.js";
import { exec, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const writeFileAsync = promisify(writeFile);
const unlinkAsync = promisify(unlink);
import { createRequire } from "node:module";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFileCb);

// Run AppleScript via -e flags (no temp files, no sync I/O on main thread)
async function runAppleScript(script: string, timeout = 10000): Promise<string> {
  const args = script.split("\n").map(l => l.trim()).filter(Boolean).flatMap(line => ["-e", line]);
  const { stdout } = await execFileAsync("osascript", args, { timeout });
  return stdout.trim();
}

// Helper to safely escape a string for embedding in AppleScript double-quoted strings
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Reminder storage (in-memory for current session)
interface Reminder {
  id: string;
  message: string;
  triggerAt: Date;
  timerId: NodeJS.Timeout;
}

const activeReminders: Map<string, Reminder> = new Map();

// Module-level screenshot state for vision analysis
let lastScreenshotPath: string | null = null;
let lastScreenshotTime: number = 0;
const SCREENSHOT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function setLastScreenshot(path: string): void {
  lastScreenshotPath = path;
  lastScreenshotTime = Date.now();
}

function getLastScreenshot(): string | null {
  // Return null if screenshot is too old
  if (lastScreenshotPath && Date.now() - lastScreenshotTime < SCREENSHOT_EXPIRY_MS) {
    return lastScreenshotPath;
  }
  return null;
}

function clearLastScreenshot(): void {
  lastScreenshotPath = null;
  lastScreenshotTime = 0;
}

function generateReminderId(): string {
  return `reminder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function showNotification(title: string, body: string): void {
  const notification = new Notification({
    title,
    body,
    sound: "default",
  });
  notification.show();
}

function scheduleReminder(message: string, delaySeconds: number): { id: string; triggerAt: Date } {
  const id = generateReminderId();
  const triggerAt = new Date(Date.now() + delaySeconds * 1000);

  const timerId = setTimeout(() => {
    showNotification("Reminder", message);
    activeReminders.delete(id);
  }, delaySeconds * 1000);

  activeReminders.set(id, { id, message, triggerAt, timerId });

  return { id, triggerAt };
}

function cancelReminder(id: string): boolean {
  const reminder = activeReminders.get(id);
  if (reminder) {
    clearTimeout(reminder.timerId);
    activeReminders.delete(id);
    return true;
  }
  return false;
}

function listReminders(): Array<{ id: string; message: string; triggerAt: string }> {
  return Array.from(activeReminders.values()).map((r) => ({
    id: r.id,
    message: r.message,
    triggerAt: r.triggerAt.toISOString(),
  }));
}

// Native macOS APIs via koffi (FFI) — lazy-loaded on first use
// Replaces osascript/blueutil with direct framework calls for speed and zero dependencies
interface NativeMacApis {
  brightness: { get: () => number; set: (level: number) => void };
  volume: { get: () => number; set: (level: number) => void; getMute: () => boolean; setMute: (mute: boolean) => void };
  bluetooth: { isEnabled: () => boolean; setEnabled: (enabled: boolean) => void };
  screen: { getWidth: () => number; getHeight: () => number };
}

let _nativeApis: NativeMacApis | null = null;

function getNativeApis(): NativeMacApis {
  if (!_nativeApis) {
    const _require = createRequire(import.meta.url);
    const koffi = _require("koffi");

    // --- CoreGraphics + DisplayServices (brightness & screen) ---
    const CG = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
    const DS = koffi.load("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices");
    const CGMainDisplayID = CG.func("uint32_t CGMainDisplayID()");
    const CGDisplayPixelsWide = CG.func("size_t CGDisplayPixelsWide(uint32_t)");
    const CGDisplayPixelsHigh = CG.func("size_t CGDisplayPixelsHigh(uint32_t)");
    const DSGetBrightness = DS.func("int DisplayServicesGetBrightness(uint32_t, _Out_ float*)");
    const DSSetBrightness = DS.func("int DisplayServicesSetBrightness(uint32_t, float)");
    const displayID = CGMainDisplayID();

    // --- CoreAudio (volume & mute) ---
    const CA = koffi.load("/System/Library/Frameworks/CoreAudio.framework/CoreAudio");
    koffi.struct("AudioObjectPropertyAddress", {
      mSelector: "uint32",
      mScope: "uint32",
      mElement: "uint32",
    });
    const AOGetU32 = CA.func("int AudioObjectGetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, _Inout_ uint32*, _Out_ uint32*)");
    const AOGetF32 = CA.func("int AudioObjectGetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, _Inout_ uint32*, _Out_ float*)");
    const AOSetF32 = CA.func("int AudioObjectSetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, uint32, float*)");
    const AOSetU32 = CA.func("int AudioObjectSetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, uint32, uint32*)");
    // FourCC constants
    const SYS = 1; // kAudioObjectSystemObject
    const SCOPE_GLOBAL = 0x676C6F62; // 'glob'
    const SCOPE_OUTPUT = 0x6F757470; // 'outp'
    const SEL_DEFAULT_OUT = 0x644F7574; // 'dOut' — kAudioHardwarePropertyDefaultOutputDevice
    const SEL_VOLUME = 0x766F6C6D; // 'volm' — kAudioDevicePropertyVolumeScalar
    const SEL_MUTE = 0x6D757465; // 'mute' — kAudioDevicePropertyMute

    function getOutputDevice(): number {
      const size = [4], id = [0];
      const r = AOGetU32(SYS, { mSelector: SEL_DEFAULT_OUT, mScope: SCOPE_GLOBAL, mElement: 0 }, 0, null, size, id);
      if (r !== 0) throw new Error(`Failed to get default output device (${r})`);
      return id[0];
    }

    // --- IOBluetooth (power on/off) ---
    const BT = koffi.load("/System/Library/Frameworks/IOBluetooth.framework/IOBluetooth");
    const BTGetPower = BT.func("int IOBluetoothPreferenceGetControllerPowerState()");
    const BTSetPower = BT.func("void IOBluetoothPreferenceSetControllerPowerState(int)");

    _nativeApis = {
      brightness: {
        get: () => {
          const out = [0];
          const r = DSGetBrightness(displayID, out);
          if (r !== 0) throw new Error(`DisplayServicesGetBrightness failed (${r})`);
          return out[0];
        },
        set: (level: number) => {
          const r = DSSetBrightness(displayID, Math.max(0, Math.min(1, level)));
          if (r !== 0) throw new Error(`DisplayServicesSetBrightness failed (${r})`);
        },
      },
      volume: {
        get: () => {
          const dev = getOutputDevice();
          const size = [4], vol = [0.0];
          const r = AOGetF32(dev, { mSelector: SEL_VOLUME, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, size, vol);
          if (r !== 0) throw new Error(`CoreAudio get volume failed (${r})`);
          return vol[0];
        },
        set: (level: number) => {
          const dev = getOutputDevice();
          const r = AOSetF32(dev, { mSelector: SEL_VOLUME, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, 4, [Math.max(0, Math.min(1, level))]);
          if (r !== 0) throw new Error(`CoreAudio set volume failed (${r})`);
        },
        getMute: () => {
          const dev = getOutputDevice();
          const size = [4], m = [0];
          const r = AOGetU32(dev, { mSelector: SEL_MUTE, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, size, m);
          if (r !== 0) throw new Error(`CoreAudio get mute failed (${r})`);
          return m[0] === 1;
        },
        setMute: (mute: boolean) => {
          const dev = getOutputDevice();
          const r = AOSetU32(dev, { mSelector: SEL_MUTE, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, 4, [mute ? 1 : 0]);
          if (r !== 0) throw new Error(`CoreAudio set mute failed (${r})`);
        },
      },
      bluetooth: {
        isEnabled: () => BTGetPower() === 1,
        setEnabled: (enabled: boolean) => BTSetPower(enabled ? 1 : 0),
      },
      screen: {
        getWidth: () => Number(CGDisplayPixelsWide(displayID)),
        getHeight: () => Number(CGDisplayPixelsHigh(displayID)),
      },
    };
  }
  return _nativeApis;
}

// Custom tools for system control
const setVolumeTool = defineTool("set_volume", {
  description: "Set the system volume level on macOS. Volume should be between 0 (mute) and 100 (max).",
  parameters: {
    type: "object",
    properties: {
      volume: {
        type: "number",
        description: "Volume level from 0 to 100",
      },
    },
    required: ["volume"],
  },
  handler: async ({ volume }: { volume: number }) => {
    try {
      const level = Math.max(0, Math.min(100, volume));
      getNativeApis().volume.set(level / 100);
      return { success: true, message: `Volume set to ${level}%` };
    } catch (error: any) {
      return { success: false, error: `Volume error: ${error.message}` };
    }
  },
});

const getVolumeTool = defineTool("get_volume", {
  description: "Get the current system volume level on macOS.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const raw = getNativeApis().volume.get();
      return { success: true, volume: Math.round(raw * 100), message: `Current volume: ${Math.round(raw * 100)}%` };
    } catch (error: any) {
      return { success: false, error: `Volume error: ${error.message}` };
    }
  },
});

const muteTool = defineTool("toggle_mute", {
  description: "Toggle mute/unmute on macOS.",
  parameters: {
    type: "object",
    properties: {
      mute: {
        type: "boolean",
        description: "True to mute, false to unmute",
      },
    },
    required: ["mute"],
  },
  handler: async ({ mute }: { mute: boolean }) => {
    try {
      getNativeApis().volume.setMute(mute);
      return { success: true, message: mute ? "Muted" : "Unmuted" };
    } catch (error: any) {
      return { success: false, error: `Mute error: ${error.message}` };
    }
  },
});

const getBrightnessTool = defineTool("get_brightness", {
  description: "Get the current screen brightness level on macOS. Returns a percentage (0-100).",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const api = getNativeApis().brightness;
      const raw = api.get();
      return { success: true, brightness: Math.round(raw * 100), message: `Current brightness: ${Math.round(raw * 100)}%` };
    } catch (error: any) {
      return { success: false, error: `Brightness error: ${error.message}` };
    }
  },
});

const setBrightnessTool = defineTool("set_brightness", {
  description: "Adjust the screen brightness on macOS. Use 'set' with a level (0-100) for precise control, or 'up'/'down' to step by a percentage.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["up", "down", "set"],
        description: "'up' to increase, 'down' to decrease, 'set' to target a specific level",
      },
      level: {
        type: "number",
        description: "Target brightness percentage (0-100). Used when action is 'set'.",
      },
      step: {
        type: "number",
        description: "Step size as percentage (default: 10). Used when action is 'up' or 'down'.",
      },
    },
    required: ["action"],
  },
  handler: async ({ action, level, step = 10 }: { action: "up" | "down" | "set"; level?: number; step?: number }) => {
    try {
      const api = getNativeApis().brightness;
      if (action === "set" && level !== undefined) {
        const normalized = Math.max(0, Math.min(100, level)) / 100;
        api.set(normalized);
        return { success: true, brightness: Math.round(normalized * 100), message: `Brightness set to ${Math.round(normalized * 100)}%` };
      } else {
        const current = api.get();
        const delta = (step / 100) * (action === "up" ? 1 : -1);
        const next = Math.max(0, Math.min(1, current + delta));
        api.set(next);
        const pct = Math.round(next * 100);
        return { success: true, brightness: pct, message: `Brightness ${action === "up" ? "increased" : "decreased"} to ${pct}%` };
      }
    } catch (error: any) {
      return { success: false, error: `Brightness error: ${error.message}` };
    }
  },
});

const runShellTool = defineTool("run_shell_command", {
  description: "Run a shell command on macOS. Use this for system tasks like opening apps, running scripts, etc. Be careful with destructive commands.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to run",
      },
    },
    required: ["command"],
  },
  handler: async ({ command }: { command: string }) => {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
});

const openAppTool = defineTool("open_application", {
  description: "Open an application on macOS by name.",
  parameters: {
    type: "object",
    properties: {
      appName: {
        type: "string",
        description: "The name of the application to open (e.g., 'Safari', 'Terminal', 'Finder')",
      },
    },
    required: ["appName"],
  },
  handler: async ({ appName }: { appName: string }) => {
    await execAsync(`open -a "${appName}"`, { timeout: 10000 });
    return { success: true, message: `Opened ${appName}` };
  },
});

// Do Not Disturb / Focus Mode tools
const setDoNotDisturbTool = defineTool("set_do_not_disturb", {
  description: "Turn Do Not Disturb (Focus mode) on or off on macOS. When enabled, notifications will be silenced.",
  parameters: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "True to enable Do Not Disturb, false to disable it",
      },
    },
    required: ["enabled"],
  },
  handler: async ({ enabled }: { enabled: boolean }) => {
    try {
      await execAsync(
        `defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean ${enabled} && killall NotificationCenter 2>/dev/null || true`,
        { timeout: 5000 }
      );
      return {
        success: true,
        enabled,
        message: enabled ? "Do Not Disturb enabled" : "Do Not Disturb disabled"
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to toggle Do Not Disturb: ${error.message}`
      };
    }
  },
});

const getDoNotDisturbStatusTool = defineTool("get_do_not_disturb_status", {
  description: "Check if Do Not Disturb (Focus mode) is currently enabled on macOS.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      // Check the DND status using defaults
      const { stdout } = await execAsync(
        `defaults -currentHost read com.apple.notificationcenterui doNotDisturb 2>/dev/null || echo "0"`,
        { timeout: 5000 }
      );
      const isEnabled = stdout.trim() === "1";
      return { 
        success: true, 
        enabled: isEnabled,
        message: isEnabled ? "Do Not Disturb is ON" : "Do Not Disturb is OFF"
      };
    } catch (error: any) {
      // If the key doesn't exist, DND is off
      return { 
        success: true, 
        enabled: false,
        message: "Do Not Disturb is OFF"
      };
    }
  },
});

const toggleDoNotDisturbTool = defineTool("toggle_do_not_disturb", {
  description: "Toggle Do Not Disturb (Focus mode) on macOS. If it's on, turn it off. If it's off, turn it on.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      // Check current status
      const { stdout } = await execAsync(
        `defaults -currentHost read com.apple.notificationcenterui doNotDisturb 2>/dev/null || echo "0"`,
        { timeout: 5000 }
      );
      const currentlyEnabled = stdout.trim() === "1";
      const newState = !currentlyEnabled;
      
      // Toggle it
      await execAsync(
        `defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean ${newState} && killall NotificationCenter 2>/dev/null || true`,
        { timeout: 5000 }
      );
      
      return { 
        success: true, 
        enabled: newState,
        message: newState ? "Do Not Disturb enabled" : "Do Not Disturb disabled"
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to toggle Do Not Disturb: ${error.message}` 
      };
    }
  },
});

// Cached WiFi interface name — detected once, reused for the session
let _wifiInterface: string | null = null;

async function getWifiInterface(): Promise<string> {
  if (!_wifiInterface) {
    try {
      const { stdout } = await execFileAsync(
        "networksetup", ["-listallhardwareports"],
        { timeout: 5000 }
      );
      const match = stdout.match(/Wi-Fi|AirPort/);
      if (match) {
        // The device line follows the hardware port line
        const lines = stdout.split("\n");
        const idx = lines.findIndex(l => /Wi-Fi|AirPort/.test(l));
        const deviceLine = lines[idx + 1];
        const deviceMatch = deviceLine?.match(/Device:\s*(\S+)/);
        if (deviceMatch) _wifiInterface = deviceMatch[1];
      }
    } catch { /* fall through to default */ }
    _wifiInterface ??= "en0";
  }
  return _wifiInterface;
}

// WiFi control tools
const setWifiTool = defineTool("set_wifi", {
  description: "Turn WiFi on or off on macOS.",
  parameters: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "True to turn WiFi on, false to turn it off",
      },
    },
    required: ["enabled"],
  },
  handler: async ({ enabled }: { enabled: boolean }) => {
    try {
      const iface = await getWifiInterface();
      await execFileAsync("networksetup", ["-setairportpower", iface, enabled ? "on" : "off"], { timeout: 10000 });
      return { success: true, enabled, message: enabled ? "WiFi turned on" : "WiFi turned off" };
    } catch (error: any) {
      return { success: false, error: `Failed to set WiFi: ${error.message}` };
    }
  },
});

const getWifiStatusTool = defineTool("get_wifi_status", {
  description: "Get the current WiFi status on macOS - whether it's on or off, and the current network name if connected.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      // Run power check and network name in parallel
      const [powerResult, networkResult] = await Promise.all([
        execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 }),
        execFileAsync("networksetup", ["-getairportnetwork", iface], { timeout: 5000 }).catch(() => null),
      ]);
      const isOn = powerResult.stdout.toLowerCase().includes("on");
      if (!isOn) {
        return { success: true, enabled: false, connected: false, message: "WiFi is OFF" };
      }
      const ssidMatch = networkResult?.stdout.match(/Current Wi-Fi Network: (.+)/);
      const networkName = ssidMatch ? ssidMatch[1].trim() : null;
      return {
        success: true,
        enabled: true,
        connected: !!networkName,
        networkName,
        message: networkName ? `WiFi is ON, connected to "${networkName}"` : "WiFi is ON but not connected"
      };
    } catch (error: any) {
      return { success: false, error: `Failed to get WiFi status: ${error.message}` };
    }
  },
});

const toggleWifiTool = defineTool("toggle_wifi", {
  description: "Toggle WiFi on macOS. If it's on, turn it off. If it's off, turn it on.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      const { stdout } = await execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 });
      const newState = !stdout.toLowerCase().includes("on");
      await execFileAsync("networksetup", ["-setairportpower", iface, newState ? "on" : "off"], { timeout: 10000 });
      return { success: true, enabled: newState, message: newState ? "WiFi turned on" : "WiFi turned off" };
    } catch (error: any) {
      return { success: false, error: `Failed to toggle WiFi: ${error.message}` };
    }
  },
});

const listWifiNetworksTool = defineTool("list_wifi_networks", {
  description: "List saved/preferred WiFi networks on macOS and show the current connection status. Displays an interactive widget.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      // Run all three queries in parallel
      const [powerResult, networkResult, preferredResult] = await Promise.all([
        execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 }),
        execFileAsync("networksetup", ["-getairportnetwork", iface], { timeout: 5000 }).catch(() => null),
        execFileAsync("networksetup", ["-listpreferredwirelessnetworks", iface], { timeout: 5000 }).catch(() => null),
      ]);
      const isOn = powerResult.stdout.toLowerCase().includes("on");
      if (!isOn) {
        return { widget: "wifi", enabled: false, connected: false, currentNetwork: null, savedNetworks: [], message: "WiFi is turned off" };
      }
      const ssidMatch = networkResult?.stdout.match(/Current Wi-Fi Network: (.+)/);
      const currentNetwork = ssidMatch ? ssidMatch[1].trim() : null;
      const savedNetworks = (preferredResult?.stdout.trim().split("\n").slice(1) ?? [])
        .map(l => l.trim()).filter(Boolean);
      return {
        widget: "wifi",
        enabled: true,
        currentNetwork,
        connected: !!currentNetwork,
        savedNetworks,
        message: currentNetwork ? `Connected to "${currentNetwork}"` : "WiFi is on but not connected"
      };
    } catch (error: any) {
      return { widget: "wifi", enabled: false, error: `Failed to list WiFi networks: ${error.message}` };
    }
  },
});

// Bluetooth tools
const setBluetoothTool = defineTool("set_bluetooth", {
  description: "Turn Bluetooth on or off on macOS.",
  parameters: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "True to turn Bluetooth on, false to turn it off",
      },
    },
    required: ["enabled"],
  },
  handler: async ({ enabled }: { enabled: boolean }) => {
    try {
      getNativeApis().bluetooth.setEnabled(enabled);
      return {
        success: true,
        enabled,
        message: enabled ? "Bluetooth turned on" : "Bluetooth turned off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const getBluetoothStatusTool = defineTool("get_bluetooth_status", {
  description: "Check if Bluetooth is enabled on macOS.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const enabled = getNativeApis().bluetooth.isEnabled();
      return {
        success: true,
        enabled,
        message: enabled ? "Bluetooth is on" : "Bluetooth is off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const toggleBluetoothTool = defineTool("toggle_bluetooth", {
  description: "Toggle Bluetooth on or off on macOS (flips the current state).",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const bt = getNativeApis().bluetooth;
      const newState = !bt.isEnabled();
      bt.setEnabled(newState);
      return {
        success: true,
        enabled: newState,
        message: newState ? "Bluetooth turned on" : "Bluetooth turned off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const listBluetoothDevicesTool = defineTool("list_bluetooth_devices", {
  description: "List paired and connected Bluetooth devices on macOS.",
  parameters: {
    type: "object",
    properties: {
      connected_only: {
        type: "boolean",
        description: "If true, only show currently connected devices",
      },
    },
  },
  handler: async ({ connected_only }: { connected_only?: boolean }) => {
    try {
      // Use system_profiler (built-in, no external dependencies)
      const { stdout } = await execAsync("system_profiler SPBluetoothDataType -json", { timeout: 15000 });
      const data = JSON.parse(stdout);
      const btData = data?.SPBluetoothDataType?.[0] ?? {};

      const devices: Array<{ name: string; address: string; connected: boolean }> = [];

      // Parse connected devices
      const connected = btData.device_connected ?? btData.devices_connected ?? [];
      for (const entry of (Array.isArray(connected) ? connected : [])) {
        for (const [name, info] of Object.entries(entry as Record<string, any>)) {
          devices.push({
            name,
            address: (info as any).device_address ?? "unknown",
            connected: true,
          });
        }
      }

      if (!connected_only) {
        // Parse not-connected (paired) devices
        const notConnected = btData.device_not_connected ?? btData.devices_not_connected ?? [];
        for (const entry of (Array.isArray(notConnected) ? notConnected : [])) {
          for (const [name, info] of Object.entries(entry as Record<string, any>)) {
            devices.push({
              name,
              address: (info as any).device_address ?? "unknown",
              connected: false,
            });
          }
        }
      }

      const connectedCount = devices.filter(d => d.connected).length;
      return {
        success: true,
        devices,
        count: devices.length,
        connected_count: connectedCount,
        message: connected_only
          ? `Found ${devices.length} connected Bluetooth device(s)`
          : `Found ${devices.length} Bluetooth device(s) (${connectedCount} connected)`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to list Bluetooth devices: ${error.message}` };
    }
  },
});

// Window organizer tools
const listWindowsTool = defineTool("list_windows", {
  description: "List all visible/running applications and their windows on macOS.",
  parameters: {
    type: "object",
    properties: {
      include_hidden: {
        type: "boolean",
        description: "If true, include hidden/minimized applications",
      },
    },
  },
  handler: async ({ include_hidden }: { include_hidden?: boolean }) => {
    try {
      // Get list of running applications with visible windows
      const includeHiddenAS = include_hidden ? "true" : "false";
      const script = `
        tell application "System Events"
          set appList to {}
          set includeHidden to ${includeHiddenAS}
          set allApps to every application process whose background only is false
          repeat with appProc in allApps
            set appName to name of appProc
            set winCount to count of windows of appProc
            set isVisible to visible of appProc
            set isFrontmost to frontmost of appProc
            if winCount > 0 or includeHidden then
              set end of appList to {appName, winCount, isVisible, isFrontmost}
            end if
          end repeat
          return appList
        end tell
      `;

      const stdout = await runAppleScript(script, 10000);
      
      // Parse AppleScript list format
      const apps: Array<{ name: string; windows: number; visible: boolean; frontmost: boolean }> = [];
      const lines = stdout.trim().split(", ");
      
      for (let i = 0; i < lines.length; i += 4) {
        if (lines[i] && lines[i] !== "") {
          apps.push({
            name: lines[i].replace(/^\["?|"?\]$/g, ""),
            windows: parseInt(lines[i + 1]) || 0,
            visible: lines[i + 2] === "true",
            frontmost: lines[i + 3] === "true"
          });
        }
      }
      
      return {
        success: true,
        apps: apps.filter(a => a.name && a.name !== ""),
        count: apps.length,
        message: `Found ${apps.length} running application(s)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list windows: ${error.message}`
      };
    }
  },
});

const arrangeWindowsTool = defineTool("arrange_windows", {
  description: "Arrange windows on macOS using different layouts: split screen (left/right), cascade, or maximize specific apps. Great for organizing your workspace.",
  parameters: {
    type: "object",
    properties: {
      layout: {
        type: "string",
        enum: ["split", "cascade", "maximize", "minimize_all", "restore_all"],
        description: "Layout type: 'split' for left/right, 'cascade' for overlapping windows, 'maximize' to maximize an app, 'minimize_all' to minimize all, 'restore_all' to restore minimized windows",
      },
      app_name: {
        type: "string",
        description: "For maximize layout: the application name to maximize (e.g., 'Safari', 'Code')",
      },
      left_app: {
        type: "string",
        description: "For split layout: app name for left side (optional, defaults to current frontmost)",
      },
      right_app: {
        type: "string",
        description: "For split layout: app name for right side (optional, auto-detected if not specified)",
      },
    },
    required: ["layout"],
  },
  handler: async ({ layout, app_name, left_app, right_app }: { layout: string; app_name?: string; left_app?: string; right_app?: string }) => {
    try {
      if (layout === "maximize" && app_name) {
        const escaped = escapeAppleScriptString(app_name);
        const { getWidth, getHeight } = getNativeApis().screen;
        const sw = getWidth();
        const sh = getHeight();
        await runAppleScript(`
          tell application "System Events"
            tell application process "${escaped}"
              set frontmost to true
              tell window 1
                set position to {0, 25}
                set size to {${sw}, ${sh - 25}}
              end tell
            end tell
          end tell
        `);
        return { success: true, message: `Maximized ${app_name} (${sw}x${sh})` };
      } else if (layout === "split") {
        // Use native screen size (instant) instead of AppleScript Finder query
        const { getWidth, getHeight } = getNativeApis().screen;
        const screenWidth = getWidth();
        const screenHeight = getHeight();
        const halfWidth = Math.floor(screenWidth / 2);

        // Get frontmost app in parallel with nothing else blocking
        let leftAppName = left_app;
        if (!leftAppName) {
          leftAppName = await runAppleScript(`
            tell application "System Events"
              return name of first application process whose frontmost is true
            end tell
          `, 5000);
        }

        const leftEscaped = escapeAppleScriptString(leftAppName);

        // Position both windows in parallel if both apps are known
        const leftScript = `
          tell application "System Events"
            tell application process "${leftEscaped}"
              set frontmost to true
              if exists window 1 then
                tell window 1
                  set position to {0, 25}
                  set size to {${halfWidth}, ${screenHeight - 25}}
                end tell
              end if
            end tell
          end tell
        `;

        if (right_app) {
          const rightEscaped = escapeAppleScriptString(right_app);
          const rightScript = `
            tell application "System Events"
              tell application process "${rightEscaped}"
                set frontmost to true
                if exists window 1 then
                  tell window 1
                    set position to {${halfWidth}, 25}
                    set size to {${halfWidth}, ${screenHeight - 25}}
                  end tell
                end if
              end tell
            end tell
          `;
          await Promise.all([runAppleScript(leftScript), runAppleScript(rightScript)]);
        } else {
          await runAppleScript(leftScript);
        }

        return {
          success: true,
          message: `Arranged windows in split layout${right_app ? ` with ${leftAppName} on left and ${right_app} on right` : ` with ${leftAppName} on left`}`
        };
      } else if (layout === "cascade") {
        await runAppleScript(`
          tell application "System Events"
            set allApps to every application process whose background only is false and visible is true
            set xPos to 50
            set yPos to 50
            repeat with appProc in allApps
              if count of windows of appProc > 0 then
                tell window 1 of appProc
                  set position to {xPos, yPos}
                end tell
                set xPos to xPos + 30
                set yPos to yPos + 30
              end if
            end repeat
          end tell
        `, 15000);
        return { success: true, message: "Arranged windows in cascade layout" };
      } else if (layout === "minimize_all") {
        await runAppleScript(`
          tell application "System Events"
            set allApps to every application process whose background only is false
            repeat with appProc in allApps
              if count of windows of appProc > 0 then
                set visible of appProc to false
              end if
            end repeat
          end tell
        `, 15000);
        return { success: true, message: "Minimized all windows" };
      } else if (layout === "restore_all") {
        await runAppleScript(`
          tell application "System Events"
            set allApps to every application process whose background only is false
            repeat with appProc in allApps
              if count of windows of appProc > 0 then
                set visible of appProc to true
              end if
            end repeat
          end tell
        `, 15000);
        return { success: true, message: "Restored all windows" };
      }

      return { success: false, error: `Unknown layout: ${layout}` };
    } catch (error: any) {
      return { success: false, error: `Failed to arrange windows: ${error.message}` };
    }
  },
});

const focusWindowTool = defineTool("focus_window", {
  description: "Bring a specific application window to the front and make it active/focused on macOS.",
  parameters: {
    type: "object",
    properties: {
      app_name: {
        type: "string",
        description: "The application name to focus (e.g., 'Safari', 'Visual Studio Code', 'Terminal')",
      },
    },
    required: ["app_name"],
  },
  handler: async ({ app_name }: { app_name: string }) => {
    try {
      const escaped = escapeAppleScriptString(app_name);
      await runAppleScript(`
        tell application "System Events"
          tell application process "${escaped}"
            set frontmost to true
          end tell
        end tell
      `, 5000);
      return { success: true, message: `Focused ${app_name}` };
    } catch (error: any) {
      return { success: false, error: `Failed to focus ${app_name}: ${error.message}. Make sure the app is running.` };
    }
  },
});

const closeWindowTool = defineTool("close_window", {
  description: "Close the frontmost window of a specific application or the currently focused window on macOS.",
  parameters: {
    type: "object",
    properties: {
      app_name: {
        type: "string",
        description: "The application name whose window to close (e.g., 'Safari'). If not specified, closes the currently focused window.",
      },
    },
  },
  handler: async ({ app_name }: { app_name?: string }) => {
    try {
      if (app_name) {
        const escaped = escapeAppleScriptString(app_name);
        await runAppleScript(`
          tell application "System Events"
            tell application process "${escaped}"
              if count of windows > 0 then
                click button 1 of window 1
              end if
            end tell
          end tell
        `, 5000);
        return { success: true, message: `Closed window of ${app_name}` };
      } else {
        await runAppleScript('tell application "System Events" to keystroke "w" using command down', 3000);
        return { success: true, message: "Closed currently focused window" };
      }
    } catch (error: any) {
      return { success: false, error: `Failed to close window: ${error.message}` };
    }
  },
});

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

// Calculator tool — opens macOS Calculator app
const calculatorTool = defineTool("calculate", {
  description: "Open the macOS Calculator app.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      await execFileAsync("open", ["-a", "Calculator"]);
      return { success: true, message: "Opened Calculator app" };
    } catch (error: any) {
      return { success: false, error: `Failed to open Calculator: ${error.message}` };
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

// Code runner tool
const runCodeTool = defineTool("run_code", {
  description: "Execute Python or JavaScript code. Use with caution and only run trusted code.",
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["python", "javascript"],
        description: "Programming language to execute",
      },
      code: {
        type: "string",
        description: "The code to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (default: 30)",
      },
    },
    required: ["language", "code"],
  },
  handler: async ({ language, code, timeout = 30 }: { language: "python" | "javascript"; code: string; timeout?: number }) => {
    const maxTimeout = Math.min(timeout, 60); // Cap at 60 seconds
    const ext = language === "python" ? ".py" : ".js";
    const tmpFile = join(tmpdir(), `copilot-bar-code-${Date.now()}${ext}`);
    try {
      // Write code to a temp file to avoid shell escaping issues entirely
      await writeFileAsync(tmpFile, code, "utf-8");
      const cmd = language === "python" ? "python3" : "node";
      const { stdout, stderr } = await execFileAsync(cmd, [tmpFile], { timeout: maxTimeout * 1000 });
      return {
        success: true,
        language,
        output: stdout || "(no output)",
        error: stderr || null,
        message: stderr ? `Execution completed with warnings` : `Execution successful`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Execution failed: ${error.message}`,
        output: error.stdout || "",
        stderr: error.stderr || ""
      };
    } finally {
      try { await unlinkAsync(tmpFile); } catch {}
    }
  },
});

// AirDrop toggle tool
const toggleAirDropTool = defineTool("toggle_airdrop", {
  description: "Enable or disable AirDrop on macOS.",
  parameters: {
    type: "object",
    properties: {
      enable: {
        type: "boolean",
        description: "true to enable AirDrop, false to disable",
      },
    },
    required: ["enable"],
  },
  handler: async ({ enable }: { enable: boolean }) => {
    try {
      const value = enable ? "false" : "true";
      await execFileAsync("defaults", ["write", "com.apple.NetworkBrowser", "DisableAirDrop", "-bool", value]);
      return {
        success: true,
        enabled: enable,
        message: `AirDrop ${enable ? "enabled" : "disabled"}. You may need to restart Finder for changes to take effect.`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to toggle AirDrop: ${error.message}`
      };
    }
  },
});

// Clipboard history tools
const getClipboardTool = defineTool("get_clipboard", {
  description: "Get the current contents of the clipboard.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const { stdout } = await execFileAsync("pbpaste", []);
      return {
        success: true,
        content: stdout,
        message: stdout ? "Clipboard content retrieved" : "Clipboard is empty"
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read clipboard: ${error.message}`
      };
    }
  },
});

const setClipboardTool = defineTool("set_clipboard", {
  description: "Set the clipboard contents.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to copy to clipboard",
      },
    },
    required: ["text"],
  },
  handler: async ({ text }: { text: string }) => {
    try {
      // Use execFile with stdin to avoid shell injection
      const proc = require("node:child_process").spawn("pbcopy");
      proc.stdin.write(text);
      proc.stdin.end();
      await new Promise<void>((resolve, reject) => {
        proc.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`pbcopy exited with code ${code}`)));
        proc.on("error", reject);
      });
      return {
        success: true,
        message: `Copied to clipboard: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to set clipboard: ${error.message}` };
    }
  },
});

const clearClipboardTool = defineTool("clear_clipboard", {
  description: "Clear the clipboard contents.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const proc = require("node:child_process").spawn("pbcopy");
      proc.stdin.write("");
      proc.stdin.end();
      await new Promise<void>((resolve, reject) => {
        proc.on("close", (code: number) => code === 0 ? resolve() : reject(new Error(`pbcopy exited with code ${code}`)));
        proc.on("error", reject);
      });
      return { success: true, message: "Clipboard cleared" };
    } catch (error: any) {
      return { success: false, error: `Failed to clear clipboard: ${error.message}` };
    }
  },
});

// URL summarizer tool
const summarizeUrlTool = defineTool("summarize_url", {
  description: "Fetch and summarize content from a web page URL.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch and summarize",
      },
      max_length: {
        type: "number",
        description: "Maximum length of summary in characters (default: 500)",
      },
    },
    required: ["url"],
  },
  handler: async ({ url, max_length = 500 }: { url: string; max_length?: number }) => {
    try {
      // Use execFile to avoid shell injection via URL
      const { stdout } = await execFileAsync("curl", ["-sL", url, "--max-time", "10"], { timeout: 15000 });
      
      // Simple HTML to text extraction (remove tags)
      let text = stdout
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Extract title
      const titleMatch = stdout.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Unknown';
      
      // Get first paragraph or meaningful content (simplified)
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
      let summary = sentences.slice(0, 3).join('. ').trim();
      
      if (summary.length > max_length) {
        summary = summary.substring(0, max_length) + '...';
      }
      
      return {
        success: true,
        url,
        title,
        summary,
        full_length: text.length,
        message: `Summarized "${title}"`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to fetch URL: ${error.message}`
      };
    }
  },
});

// Music control tools - helper to get the AppleScript app name
function musicAppName(app: "spotify" | "music"): string {
  return app === "spotify" ? "Spotify" : "Music";
}

const playMusicTool = defineTool("play_music", {
  description: "Play music in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to play`);
      return { success: true, app, action: "play", message: `Started playing in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to play music: ${error.message}` };
    }
  },
});

const pauseMusicTool = defineTool("pause_music", {
  description: "Pause music in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to pause`);
      return { success: true, app, action: "pause", message: `Paused ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to pause music: ${error.message}` };
    }
  },
});

const nextTrackTool = defineTool("next_track", {
  description: "Skip to the next track in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to next track`);
      return { success: true, app, action: "next", message: `Skipped to next track in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to skip track: ${error.message}` };
    }
  },
});

const previousTrackTool = defineTool("previous_track", {
  description: "Go to the previous track in Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to control: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      await runAppleScript(`tell application "${musicAppName(app)}" to previous track`);
      return { success: true, app, action: "previous", message: `Went to previous track in ${musicAppName(app)}` };
    } catch (error: any) {
      return { success: false, error: `Failed to go to previous track: ${error.message}` };
    }
  },
});

const getMusicStatusTool = defineTool("get_music_status", {
  description: "Get current playback status from Spotify or Apple Music.",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", enum: ["spotify", "music"], description: "Which app to check: 'spotify' or 'music' (Apple Music)" },
    },
    required: ["app"],
  },
  handler: async ({ app }: { app: "spotify" | "music" }) => {
    try {
      const appName = musicAppName(app);
      const stdout = await runAppleScript(`tell application "${appName}"
        if player state is playing then
          return "Playing: " & name of current track & " by " & artist of current track
        else
          return "Paused: " & name of current track & " by " & artist of current track
        end if
      end tell`);
      return { success: true, app, status: stdout, message: stdout };
    } catch (error: any) {
      return { success: false, error: `Failed to get music status: ${error.message}` };
    }
  },
});

// Voice input tool (speech to text simulation)
const speechToTextTool = defineTool("speech_to_text", {
  description: "Activate macOS dictation/speech recognition to convert speech to text. Note: This opens the dictation interface.",
  parameters: {
    type: "object",
    properties: {
      duration: {
        type: "number",
        description: "Duration in seconds to listen for (default: 10)",
      },
    },
  },
  handler: async ({ duration = 10 }: { duration?: number }) => {
    try {
      await runAppleScript('tell application "System Events" to key code 63 using {fn down}', 5000);
      return {
        success: true,
        message: `Speech recognition activated. Please speak for up to ${duration} seconds. Note: You'll need to manually stop dictation when done.`,
        note: "This opens macOS dictation. The actual transcription happens in the active text field."
      };
    } catch (error: any) {
      return {
        success: false,
        message: "Failed to activate speech dictation. You may need to press Fn twice manually.",
        note: "macOS dictation must be enabled in System Preferences > Keyboard > Dictation",
        error: error.message
      };
    }
  },
});

// Text-to-speech tool
const speakTextTool = defineTool("speak_text", {
  description: "Convert text to speech using macOS say command.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to speak aloud",
      },
      voice: {
        type: "string",
        description: "Voice to use (e.g., 'Alex', 'Samantha', 'Victoria'). Default: system default",
      },
      rate: {
        type: "number",
        description: "Speech rate (words per minute). Default: 175",
      },
    },
    required: ["text"],
  },
  handler: async ({ text, voice, rate = 175 }: { text: string; voice?: string; rate?: number }) => {
    try {
      // Use execFile to avoid shell injection; run in background with .catch()
      const args = [text, "-r", String(rate)];
      if (voice) {
        args.push("-v", voice);
      }
      execFileAsync("say", args).catch((err) => {
        console.error("TTS error:", err.message);
      });

      return {
        success: true,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        voice: voice || "default",
        rate,
        message: `Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to speak text: ${error.message}` };
    }
  },
});

// Weather tool
const getWeatherTool = defineTool("get_weather", {
  description: "Get current weather information for a location using wttr.in API.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City name or location (e.g., 'London', 'New York', 'Tokyo')",
      },
      format: {
        type: "string",
        enum: ["brief", "full"],
        description: "Weather format: brief (one line) or full (detailed)",
      },
    },
    required: ["location"],
  },
  handler: async ({ location, format = "brief" }: { location: string; format?: "brief" | "full" }) => {
    try {
      const encodedLocation = encodeURIComponent(location);
      const formatFlag = format === "brief" ? "?format=%l:+%c+%t+%w" : "";
      const { stdout } = await execFileAsync("curl", ["-s", `wttr.in/${encodedLocation}${formatFlag}`, "--max-time", "10"], { timeout: 15000 });
      
      if (stdout.includes("Unknown location")) {
        return {
          success: false,
          error: `Unknown location: "${location}"`
        };
      }
      
      return {
        success: true,
        location,
        weather: stdout.trim(),
        message: `Weather for ${location}: ${stdout.trim().substring(0, 100)}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to fetch weather: ${error.message}`
      };
    }
  },
});

// Image drop/analysis tool
const analyzeImageTool = defineTool("analyze_image", {
  description: "Analyze or describe an image file. Uses macOS system tools to extract basic image information.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the image file to analyze",
      },
    },
    required: ["path"],
  },
  handler: async ({ path: imagePath }: { path: string }) => {
    try {
      // Run mdls and sips in parallel
      const [mdlsResult, sipsResult] = await Promise.all([
        execFileAsync("mdls", [imagePath]),
        execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath]).catch(() => null),
      ]);
      const mdlsOutput = mdlsResult.stdout;

      let dimensions = "Unknown";
      if (sipsResult) {
        const widthMatch = sipsResult.stdout.match(/pixelWidth: (\d+)/);
        const heightMatch = sipsResult.stdout.match(/pixelHeight: (\d+)/);
        if (widthMatch && heightMatch) {
          dimensions = `${widthMatch[1]}x${heightMatch[2]}`;
        }
      }

      // Extract relevant metadata
      const fileSizeMatch = mdlsOutput.match(/kMDItemFSSize = (\d+)/);
      const contentTypeMatch = mdlsOutput.match(/kMDItemContentType = "([^"]+)"/);
      const creationDateMatch = mdlsOutput.match(/kMDItemFSCreationDate = ([^\n]+)/);
      
      return {
        success: true,
        path: imagePath,
        dimensions,
        file_size: fileSizeMatch ? `${(parseInt(fileSizeMatch[1]) / 1024 / 1024).toFixed(2)} MB` : "Unknown",
        content_type: contentTypeMatch ? contentTypeMatch[1] : "Unknown",
        created: creationDateMatch ? creationDateMatch[1] : "Unknown",
        message: `Image analysis complete: ${dimensions}, ${fileSizeMatch ? (parseInt(fileSizeMatch[1]) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown size'}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to analyze image: ${error.message}`
      };
    }
  },
});

// Widget tools for interactive UI elements
const startTimerTool = defineTool("start_timer", {
  description: "Start an interactive stopwatch/timer widget that counts up from 0. The widget will appear in the chat with start/pause/reset controls.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    return { widget: "timer", message: "Started a timer widget" };
  },
});

const startCountdownTool = defineTool("start_countdown", {
  description: "Start a countdown timer widget. The widget will appear in the chat with start/pause/reset controls and will beep when done.",
  parameters: {
    type: "object",
    properties: {
      duration: {
        type: "number",
        description: "Duration in seconds (e.g., 300 for 5 minutes)",
      },
      label: {
        type: "string",
        description: "Optional label for the countdown (e.g., 'Tea timer', 'Break')",
      },
    },
    required: ["duration"],
  },
  handler: async ({ duration, label }: { duration: number; label?: string }) => {
    return { widget: "countdown", duration, label, message: `Started a ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")} countdown` };
  },
});

const startPomodoroTool = defineTool("start_pomodoro", {
  description: "Start a Pomodoro timer widget (25 minutes work, 5 minutes break). Great for productivity and focus sessions.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    return { widget: "pomodoro", message: "Started a Pomodoro timer (25min work / 5min break)" };
  },
});

// Reminder tools
const setReminderTool = defineTool("set_reminder", {
  description: "Set a reminder that will show a native macOS notification after the specified time. Use this when the user wants to be reminded about something.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The reminder message to display in the notification",
      },
      delay_seconds: {
        type: "number",
        description: "Number of seconds from now until the reminder triggers. Examples: 60 for 1 minute, 300 for 5 minutes, 3600 for 1 hour",
      },
    },
    required: ["message", "delay_seconds"],
  },
  handler: async ({ message, delay_seconds }: { message: string; delay_seconds: number }) => {
    if (delay_seconds <= 0) {
      return { success: false, error: "Delay must be positive" };
    }
    const { id, triggerAt } = scheduleReminder(message, delay_seconds);
    const minutes = Math.floor(delay_seconds / 60);
    const seconds = delay_seconds % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    return {
      success: true,
      id,
      message: `Reminder set for ${timeStr} from now`,
      triggerAt: triggerAt.toISOString(),
    };
  },
});

const listRemindersTool = defineTool("list_reminders", {
  description: "List all active reminders that are scheduled.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const reminders = listReminders();
    return {
      count: reminders.length,
      reminders,
    };
  },
});

const cancelReminderTool = defineTool("cancel_reminder", {
  description: "Cancel a scheduled reminder by its ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The ID of the reminder to cancel",
      },
    },
    required: ["id"],
  },
  handler: async ({ id }: { id: string }) => {
    const cancelled = cancelReminder(id);
    return {
      success: cancelled,
      message: cancelled ? "Reminder cancelled" : "Reminder not found",
    };
  },
});

// World clock tool
const showWorldClockTool = defineTool("show_world_clock", {
  description: "Show an interactive world clock widget displaying current times in multiple cities/timezones. The widget updates in real-time.",
  parameters: {
    type: "object",
    properties: {
      cities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "City name to display (e.g., 'New York', 'London', 'Tokyo')" },
            timezone: { type: "string", description: "IANA timezone identifier (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo')" },
          },
          required: ["name", "timezone"],
        },
        description: "List of cities with their timezones to display. If not provided, shows common defaults.",
      },
    },
  },
  handler: async ({ cities }: { cities?: Array<{ name: string; timezone: string }> }) => {
    const defaultCities = [
      { name: "Local", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { name: "New York", timezone: "America/New_York" },
      { name: "London", timezone: "Europe/London" },
      { name: "Tokyo", timezone: "Asia/Tokyo" },
    ];
    return {
      widget: "worldclock",
      cities: cities || defaultCities,
      message: "Showing world clock",
    };
  },
});

// Get current time in a timezone
const getTimeTool = defineTool("get_time", {
  description: "Get the current time in a specific timezone or city.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone identifier (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles'). Use 'local' for local time.",
      },
    },
    required: ["timezone"],
  },
  handler: async ({ timezone }: { timezone: string }) => {
    const tz = timezone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timezone;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    return {
      timezone: tz,
      formatted: formatter.format(now),
      iso: now.toISOString(),
    };
  },
});

// Unit conversion data
const unitConversions: Record<string, Record<string, number>> = {
  length: {
    meters: 1,
    kilometers: 0.001,
    centimeters: 100,
    millimeters: 1000,
    miles: 0.000621371,
    yards: 1.09361,
    feet: 3.28084,
    inches: 39.3701,
  },
  weight: {
    kilograms: 1,
    grams: 1000,
    milligrams: 1000000,
    pounds: 2.20462,
    ounces: 35.274,
    stones: 0.157473,
  },
  temperature: {
    celsius: 1, // special handling needed
    fahrenheit: 1,
    kelvin: 1,
  },
  volume: {
    liters: 1,
    milliliters: 1000,
    gallons: 0.264172,
    quarts: 1.05669,
    pints: 2.11338,
    cups: 4.22675,
    fluid_ounces: 33.814,
  },
  area: {
    square_meters: 1,
    square_kilometers: 0.000001,
    square_feet: 10.7639,
    square_yards: 1.19599,
    acres: 0.000247105,
    hectares: 0.0001,
  },
  speed: {
    meters_per_second: 1,
    kilometers_per_hour: 3.6,
    miles_per_hour: 2.23694,
    knots: 1.94384,
  },
};

function convertUnit(value: number, fromUnit: string, toUnit: string, category: string): number | null {
  // Special handling for temperature
  if (category === "temperature") {
    let celsius: number;
    // Convert to Celsius first
    if (fromUnit === "celsius") celsius = value;
    else if (fromUnit === "fahrenheit") celsius = (value - 32) * 5 / 9;
    else if (fromUnit === "kelvin") celsius = value - 273.15;
    else return null;

    // Convert from Celsius to target
    if (toUnit === "celsius") return celsius;
    if (toUnit === "fahrenheit") return celsius * 9 / 5 + 32;
    if (toUnit === "kelvin") return celsius + 273.15;
    return null;
  }

  const categoryData = unitConversions[category];
  if (!categoryData || !categoryData[fromUnit] || !categoryData[toUnit]) {
    return null;
  }

  // Convert to base unit, then to target unit
  const baseValue = value / categoryData[fromUnit];
  return baseValue * categoryData[toUnit];
}

// Unit converter tools
const showUnitConverterTool = defineTool("show_unit_converter", {
  description: "ALWAYS use this tool when the user asks for a unit converter, temperature converter, length converter, weight converter, or wants to convert between units. Shows an interactive widget in the chat. Do NOT generate HTML code - use this tool instead.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["length", "weight", "temperature", "volume", "area", "speed"],
        description: "Category of units to convert. Use 'temperature' for temperature conversions, 'length' for distance/length, 'weight' for mass, etc.",
      },
    },
  },
  handler: async ({ category }: { category?: string }) => {
    return {
      widget: "unitconverter",
      category: category || "length",
      message: `Showing ${category || "length"} unit converter`,
    };
  },
});

const convertUnitTool = defineTool("convert_unit", {
  description: "Convert a specific value from one unit to another and return the result. Use this when the user asks 'what is X in Y' or 'convert X to Y'. For interactive converter widget, use show_unit_converter instead.",
  parameters: {
    type: "object",
    properties: {
      value: { type: "number", description: "The value to convert" },
      from_unit: { type: "string", description: "Source unit (e.g., 'meters', 'pounds', 'celsius')" },
      to_unit: { type: "string", description: "Target unit (e.g., 'feet', 'kilograms', 'fahrenheit')" },
      category: {
        type: "string",
        enum: ["length", "weight", "temperature", "volume", "area", "speed"],
        description: "Category of the units",
      },
    },
    required: ["value", "from_unit", "to_unit", "category"],
  },
  handler: async ({ value, from_unit, to_unit, category }: { value: number; from_unit: string; to_unit: string; category: string }) => {
    const result = convertUnit(value, from_unit, to_unit, category);
    if (result === null) {
      return { success: false, error: "Invalid unit conversion" };
    }
    return {
      success: true,
      value,
      from_unit,
      to_unit,
      result: Math.round(result * 1000000) / 1000000, // Round to 6 decimal places
      formatted: `${value} ${from_unit} = ${Math.round(result * 1000000) / 1000000} ${to_unit}`,
    };
  },
});

// Screenshot tool
const captureScreenshotTool = defineTool("capture_screenshot", {
  description: "Capture a screenshot of the user's screen. After capturing, you can analyze what's on screen. Use this when the user asks to take a screenshot, capture their screen, or asks about what's visible on their display.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const result = await captureAndUpload();
      if (result.success) {
        if (result.url) {
          return {
            success: true,
            url: result.url,
            message: `Screenshot captured and uploaded: ${result.url}`,
          };
        } else {
          // Store the path for vision analysis in follow-up messages
          if (result.path) {
            setLastScreenshot(result.path);
          }
          return {
            success: true,
            path: result.path,
            copied: result.copied,
            message: `Screenshot saved to ${result.path} and copied to clipboard. I can now see what's on your screen.`,
            hasVisionContext: true,
          };
        }
      } else {
        return {
          success: false,
          error: result.error || "Failed to capture screenshot",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot capture failed",
      };
    }
  },
});

const systemTools = [
  setVolumeTool,
  getVolumeTool,
  muteTool,
  getBrightnessTool,
  setBrightnessTool,
  runShellTool,
  openAppTool,
  setDoNotDisturbTool,
  getDoNotDisturbStatusTool,
  toggleDoNotDisturbTool,
  setWifiTool,
  getWifiStatusTool,
  toggleWifiTool,
  listWifiNetworksTool,
  setBluetoothTool,
  getBluetoothStatusTool,
  toggleBluetoothTool,
  listBluetoothDevicesTool,
  listWindowsTool,
  arrangeWindowsTool,
  focusWindowTool,
  closeWindowTool,
  createNoteTool,
  listNotesTool,
  getNoteTool,
  updateNoteTool,
  searchNotesTool,
  deleteNoteTool,
  deleteAllNotesTool,
  calculatorTool,
  createTodoTool,
  listTodosTool,
  completeTodoTool,
  deleteTodoTool,
  runCodeTool,
  toggleAirDropTool,
  getClipboardTool,
  setClipboardTool,
  clearClipboardTool,
  summarizeUrlTool,
  playMusicTool,
  pauseMusicTool,
  nextTrackTool,
  previousTrackTool,
  getMusicStatusTool,
  speechToTextTool,
  speakTextTool,
  getWeatherTool,
  analyzeImageTool,
  startTimerTool,
  startCountdownTool,
  startPomodoroTool,
  setReminderTool,
  listRemindersTool,
  cancelReminderTool,
  showWorldClockTool,
  getTimeTool,
  showUnitConverterTool,
  convertUnitTool,
  captureScreenshotTool,
];

export interface ToolEvent {
  type: "start" | "complete";
  toolName: string;
  toolCallId: string;
}

export interface WidgetEvent {
  type: "timer" | "countdown" | "pomodoro" | "worldclock" | "unitconverter" | "wifi";
  duration?: number;
  label?: string;
  cities?: Array<{ name: string; timezone: string }>;
  category?: string;
  // WiFi widget properties
  enabled?: boolean;
  connected?: boolean;
  currentNetwork?: string | null;
  savedNetworks?: string[];
  error?: string;
}

export class CopilotService {
  private client: CopilotClient | null = null;
  private sessions: Map<number, CopilotSession> = new Map();
  private currentModel: string = "";
  private onToolEvent: ((event: ToolEvent) => void) | null = null;
  private onWidgetEvent: ((event: WidgetEvent) => void) | null = null;
  private activeTools: Map<string, string> = new Map(); // toolCallId -> toolName

  setToolEventHandler(handler: (event: ToolEvent) => void) {
    this.onToolEvent = handler;
  }

  setWidgetEventHandler(handler: (event: WidgetEvent) => void) {
    this.onWidgetEvent = handler;
  }

  async initialize(): Promise<void> {
    this.client = new CopilotClient();
    await this.client.start();
  }

  private async getOrCreateSession(sessionId: number, model: string): Promise<CopilotSession> {
    if (!this.client) {
      await this.initialize();
    }

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = await this.client!.createSession({
      model,
      tools: systemTools,
    });

    session.on((event) => {
      console.log("[session event]", event.type, JSON.stringify(event.data).substring(0, 120));
      if (event.type === "session.error") {
        console.error("[session] error, evicting session:", sessionId);
        this.sessions.delete(sessionId);
      }
      if (event.type === "tool.execution_start" && this.onToolEvent) {
        this.activeTools.set(event.data.toolCallId, event.data.toolName);
        this.onToolEvent({
          type: "start",
          toolName: event.data.toolName,
          toolCallId: event.data.toolCallId,
        });
      } else if (event.type === "tool.execution_complete") {
        const toolName = this.activeTools.get(event.data.toolCallId) || "tool";
        this.activeTools.delete(event.data.toolCallId);

        if (this.onToolEvent) {
          this.onToolEvent({
            type: "complete",
            toolName,
            toolCallId: event.data.toolCallId,
          });
        }

        if (this.onWidgetEvent && event.data.result?.content) {
          try {
            const result = JSON.parse(event.data.result.content);
            if (result.widget) {
              this.onWidgetEvent({
                type: result.widget,
                duration: result.duration,
                label: result.label,
                cities: result.cities,
                category: result.category,
                enabled: result.enabled,
                connected: result.connected,
                currentNetwork: result.currentNetwork ?? null,
                savedNetworks: result.savedNetworks,
                error: result.error,
              });
            }
          } catch {
            // ignore
          }
        }
      }
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  async chat(prompt: string, sessionId: number = 1): Promise<string> {
    if (!this.client) {
      await this.initialize();
    }

    const config = loadConfig();

    // Recreate session if model changed
    if (this.sessions.size > 0 && this.currentModel !== config.model) {
      await Promise.allSettled(Array.from(this.sessions.values()).map((s) => s.destroy()));
      this.sessions.clear();
    }

    this.currentModel = config.model;
    const session = await this.getOrCreateSession(sessionId, config.model);

    // Build message options with optional screenshot attachment for vision
    const messageOptions: { prompt: string; attachments?: Array<{ type: "file"; path: string; displayName?: string }> } = { prompt };

    const screenshotPath = getLastScreenshot();
    if (screenshotPath) {
      messageOptions.attachments = [
        { type: "file", path: screenshotPath, displayName: "screenshot.png" }
      ];
      // Clear the screenshot after attaching so it's not sent repeatedly
      clearLastScreenshot();
    }

    console.log("[chat] sending prompt:", prompt.substring(0, 80));
    try {
      const response = await session.sendAndWait(
        messageOptions,
        120000 // 2 minute timeout
      );

      console.log("[chat] response received:", response?.data?.content?.substring(0, 100) || "(empty)");
      return response?.data.content || "";
    } catch (error: any) {
      console.error("[chat] sendAndWait failed:", error.message);
      // Session may be dead — evict it so a fresh one is created next time
      this.sessions.delete(sessionId);
      try { await session.destroy(); } catch {}
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.sessions.size > 0) {
      await Promise.allSettled(Array.from(this.sessions.values()).map((s) => s.destroy()));
      this.sessions.clear();
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
