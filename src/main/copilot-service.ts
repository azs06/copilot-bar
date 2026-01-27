import { CopilotClient, type CopilotSession, defineTool } from "@github/copilot-sdk";
import { loadConfig } from "./database.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

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
    const level = Math.max(0, Math.min(100, volume));
    await execAsync(`osascript -e "set volume output volume ${level}"`, { timeout: 5000 });
    return { success: true, message: `Volume set to ${level}%` };
  },
});

const getVolumeTool = defineTool("get_volume", {
  description: "Get the current system volume level on macOS.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const { stdout } = await execAsync(`osascript -e "output volume of (get volume settings)"`, { timeout: 5000 });
    return { volume: parseInt(stdout.trim(), 10) };
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
    await execAsync(`osascript -e "set volume output muted ${mute}"`, { timeout: 5000 });
    return { success: true, message: mute ? "Muted" : "Unmuted" };
  },
});

const setBrightnessTool = defineTool("set_brightness", {
  description: "Set the screen brightness on macOS. Brightness should be between 0 (dark) and 1 (bright). Note: This requires 'brightness' CLI tool installed via: brew install brightness",
  parameters: {
    type: "object",
    properties: {
      brightness: {
        type: "number",
        description: "Brightness level from 0.0 to 1.0",
      },
    },
    required: ["brightness"],
  },
  handler: async ({ brightness }: { brightness: number }) => {
    const level = Math.max(0, Math.min(1, brightness));
    try {
      await execAsync(`/opt/homebrew/bin/brightness ${level}`, { timeout: 5000 });
      return { success: true, message: `Brightness set to ${Math.round(level * 100)}%` };
    } catch (error: any) {
      return { success: false, message: `Brightness error: ${error.message}` };
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

const systemTools = [setVolumeTool, getVolumeTool, muteTool, setBrightnessTool, runShellTool, openAppTool, startTimerTool, startCountdownTool, startPomodoroTool];

export interface ToolEvent {
  type: "start" | "complete";
  toolName: string;
  toolCallId: string;
}

export interface WidgetEvent {
  type: "timer" | "countdown" | "pomodoro";
  duration?: number;
  label?: string;
}

export class CopilotService {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
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

  async chat(prompt: string): Promise<string> {
    if (!this.client) {
      await this.initialize();
    }

    const config = loadConfig();

    // Recreate session if model changed
    if (this.session && this.currentModel !== config.model) {
      await this.session.destroy();
      this.session = null;
    }

    if (!this.session) {
      this.session = await this.client!.createSession({
        model: config.model,
        tools: systemTools, // Add custom system control tools
      });
      this.currentModel = config.model;

      // Set up event handler for tool executions
      this.session.on((event) => {
        if (event.type === "tool.execution_start" && this.onToolEvent) {
          // Track active tool
          this.activeTools.set(event.data.toolCallId, event.data.toolName);
          this.onToolEvent({
            type: "start",
            toolName: event.data.toolName,
            toolCallId: event.data.toolCallId,
          });
        } else if (event.type === "tool.execution_complete") {
          // Get tool name from tracked active tools
          const toolName = this.activeTools.get(event.data.toolCallId) || "tool";
          this.activeTools.delete(event.data.toolCallId);

          if (this.onToolEvent) {
            this.onToolEvent({
              type: "complete",
              toolName,
              toolCallId: event.data.toolCallId,
            });
          }

          // Check if this is a widget tool and emit widget event
          if (this.onWidgetEvent && event.data.result?.content) {
            try {
              const result = JSON.parse(event.data.result.content);
              if (result.widget) {
                this.onWidgetEvent({
                  type: result.widget,
                  duration: result.duration,
                  label: result.label,
                });
              }
            } catch {
              // Not JSON or no widget, ignore
            }
          }
        }
      });
    }

    const response = await this.session.sendAndWait(
      { prompt },
      120000 // 2 minute timeout
    );

    return response?.data.content || "";
  }

  async cleanup(): Promise<void> {
    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
