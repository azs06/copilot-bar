import { defineTool } from "@github/copilot-sdk";
import { scheduleReminder, listReminders, cancelReminder, showNotification, setLastScreenshot } from "./helpers.js";
import { captureAndUpload, isS3Configured } from "../screenshot-service.js";

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
    if (fromUnit === "celsius") celsius = value;
    else if (fromUnit === "fahrenheit") celsius = (value - 32) * 5 / 9;
    else if (fromUnit === "kelvin") celsius = value - 273.15;
    else return null;

    if (toUnit === "celsius") return celsius;
    if (toUnit === "fahrenheit") return celsius * 9 / 5 + 32;
    if (toUnit === "kelvin") return celsius + 273.15;
    return null;
  }

  const categoryData = unitConversions[category];
  if (!categoryData || !categoryData[fromUnit] || !categoryData[toUnit]) {
    return null;
  }

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
      result: Math.round(result * 1000000) / 1000000,
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

export const widgetTools = [
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
