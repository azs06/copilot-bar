import { defineTool } from "@github/copilot-sdk";
import { execAsync, execFileAsync } from "./helpers.js";

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
      const { stdout } = await execAsync(
        `defaults -currentHost read com.apple.notificationcenterui doNotDisturb 2>/dev/null || echo "0"`,
        { timeout: 5000 }
      );
      const currentlyEnabled = stdout.trim() === "1";
      const newState = !currentlyEnabled;

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

// Clipboard tools
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

export const systemTools = [
  runShellTool,
  openAppTool,
  setDoNotDisturbTool,
  getDoNotDisturbStatusTool,
  toggleDoNotDisturbTool,
  toggleAirDropTool,
  getClipboardTool,
  setClipboardTool,
  clearClipboardTool,
  calculatorTool,
];
