import { defineTool } from "@github/copilot-sdk";
import { getNativeApis } from "./native-apis.js";

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

export const audioVisualTools = [
  setVolumeTool,
  getVolumeTool,
  muteTool,
  getBrightnessTool,
  setBrightnessTool,
];
