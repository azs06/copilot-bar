import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock helpers
vi.mock("./helpers.js", () => ({
  scheduleReminder: vi.fn(() => ({
    id: "reminder_123_abc",
    triggerAt: new Date("2025-01-01T01:05:00Z"),
  })),
  listReminders: vi.fn(() => []),
  cancelReminder: vi.fn(() => true),
  showNotification: vi.fn(),
  setLastScreenshot: vi.fn(),
}));

// Mock screenshot-service
vi.mock("../screenshot-service.js", () => ({
  captureAndUpload: vi.fn(),
  isS3Configured: vi.fn(() => false),
}));

import { widgetTools } from "./widget-tools.js";
import { scheduleReminder, listReminders, cancelReminder, setLastScreenshot } from "./helpers.js";
import { captureAndUpload } from "../screenshot-service.js";

function findTool(name: string) {
  const tool = widgetTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("start_timer", () => {
  it("returns timer widget", async () => {
    const result = await findTool("start_timer").handler({});
    expect(result.widget).toBe("timer");
    expect(result.message).toContain("timer");
  });
});

describe("start_countdown", () => {
  it("formats duration as mm:ss", async () => {
    const result = await findTool("start_countdown").handler({ duration: 300 });
    expect(result.widget).toBe("countdown");
    expect(result.duration).toBe(300);
    expect(result.message).toContain("5:00");
  });

  it("formats partial minutes correctly", async () => {
    const result = await findTool("start_countdown").handler({ duration: 90 });
    expect(result.message).toContain("1:30");
  });

  it("includes label when provided", async () => {
    const result = await findTool("start_countdown").handler({ duration: 60, label: "Tea" });
    expect(result.label).toBe("Tea");
  });
});

describe("start_pomodoro", () => {
  it("returns pomodoro widget", async () => {
    const result = await findTool("start_pomodoro").handler({});
    expect(result.widget).toBe("pomodoro");
    expect(result.message).toContain("25min");
  });
});

describe("set_reminder", () => {
  it("rejects delay_seconds <= 0", async () => {
    const result = await findTool("set_reminder").handler({ message: "Test", delay_seconds: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive");
  });

  it("calls scheduleReminder and returns formatted time", async () => {
    const result = await findTool("set_reminder").handler({ message: "Test", delay_seconds: 125 });
    expect(scheduleReminder).toHaveBeenCalledWith("Test", 125);
    expect(result.success).toBe(true);
    expect(result.message).toContain("2m 5s");
    expect(result.id).toBe("reminder_123_abc");
  });

  it("formats seconds-only time correctly", async () => {
    const result = await findTool("set_reminder").handler({ message: "Quick", delay_seconds: 30 });
    expect(result.message).toContain("30s");
  });
});

describe("list_reminders", () => {
  it("returns empty list", async () => {
    const result = await findTool("list_reminders").handler({});
    expect(result.count).toBe(0);
    expect(result.reminders).toHaveLength(0);
  });

  it("returns reminders from helper", async () => {
    vi.mocked(listReminders).mockReturnValueOnce([
      { id: "r1", message: "Test", triggerAt: new Date() },
    ] as any);
    const result = await findTool("list_reminders").handler({});
    expect(result.count).toBe(1);
  });
});

describe("cancel_reminder", () => {
  it("returns success when cancelled", async () => {
    const result = await findTool("cancel_reminder").handler({ id: "r1" });
    expect(cancelReminder).toHaveBeenCalledWith("r1");
    expect(result.success).toBe(true);
  });

  it("returns failure when not found", async () => {
    vi.mocked(cancelReminder).mockReturnValueOnce(false);
    const result = await findTool("cancel_reminder").handler({ id: "nonexistent" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });
});

describe("show_world_clock", () => {
  it("uses default cities when none provided", async () => {
    const result = await findTool("show_world_clock").handler({});
    expect(result.widget).toBe("worldclock");
    expect(result.cities).toHaveLength(4);
    expect(result.cities[1].name).toBe("New York");
  });

  it("uses provided cities", async () => {
    const cities = [{ name: "Berlin", timezone: "Europe/Berlin" }];
    const result = await findTool("show_world_clock").handler({ cities });
    expect(result.cities).toEqual(cities);
  });
});

describe("get_time", () => {
  it("returns formatted time for a timezone", async () => {
    const result = await findTool("get_time").handler({ timezone: "America/New_York" });
    expect(result.timezone).toBe("America/New_York");
    expect(result.formatted).toBeDefined();
    expect(result.iso).toBeDefined();
  });

  it("resolves 'local' to system timezone", async () => {
    const result = await findTool("get_time").handler({ timezone: "local" });
    expect(result.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("show_unit_converter", () => {
  it("returns widget with default category", async () => {
    const result = await findTool("show_unit_converter").handler({});
    expect(result.widget).toBe("unitconverter");
    expect(result.category).toBe("length");
  });

  it("passes specified category", async () => {
    const result = await findTool("show_unit_converter").handler({ category: "temperature" });
    expect(result.category).toBe("temperature");
  });
});

describe("convert_unit", () => {
  it("converts celsius to fahrenheit", async () => {
    const result = await findTool("convert_unit").handler({
      value: 100, from_unit: "celsius", to_unit: "fahrenheit", category: "temperature",
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(212);
  });

  it("converts fahrenheit to celsius", async () => {
    const result = await findTool("convert_unit").handler({
      value: 32, from_unit: "fahrenheit", to_unit: "celsius", category: "temperature",
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(0);
  });

  it("converts meters to feet", async () => {
    const result = await findTool("convert_unit").handler({
      value: 1, from_unit: "meters", to_unit: "feet", category: "length",
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(3.28084);
  });

  it("converts kilograms to pounds", async () => {
    const result = await findTool("convert_unit").handler({
      value: 1, from_unit: "kilograms", to_unit: "pounds", category: "weight",
    });
    expect(result.success).toBe(true);
    expect(result.result).toBe(2.20462);
  });

  it("returns error for invalid units", async () => {
    const result = await findTool("convert_unit").handler({
      value: 1, from_unit: "bananas", to_unit: "apples", category: "length",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("returns error for invalid category", async () => {
    const result = await findTool("convert_unit").handler({
      value: 1, from_unit: "meters", to_unit: "feet", category: "magic",
    });
    expect(result.success).toBe(false);
  });

  it("rounds to 6 decimal places", async () => {
    const result = await findTool("convert_unit").handler({
      value: 1, from_unit: "miles", to_unit: "kilometers", category: "length",
    });
    expect(result.success).toBe(true);
    const decimals = String(result.result).split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it("includes formatted string", async () => {
    const result = await findTool("convert_unit").handler({
      value: 100, from_unit: "celsius", to_unit: "fahrenheit", category: "temperature",
    });
    expect(result.formatted).toBe("100 celsius = 212 fahrenheit");
  });
});

describe("capture_screenshot", () => {
  it("sets lastScreenshot on local save", async () => {
    vi.mocked(captureAndUpload).mockResolvedValueOnce({
      success: true,
      path: "/tmp/screenshot.png",
      copied: true,
    });
    const result = await findTool("capture_screenshot").handler({});
    expect(result.success).toBe(true);
    expect(setLastScreenshot).toHaveBeenCalledWith("/tmp/screenshot.png");
  });

  it("returns URL on S3 upload success", async () => {
    vi.mocked(captureAndUpload).mockResolvedValueOnce({
      success: true,
      url: "https://bucket.example.com/screenshots/abc.png",
    });
    const result = await findTool("capture_screenshot").handler({});
    expect(result.success).toBe(true);
    expect(result.url).toContain("abc.png");
  });

  it("returns error on failure", async () => {
    vi.mocked(captureAndUpload).mockResolvedValueOnce({
      success: false,
      error: "No screen sources",
    });
    const result = await findTool("capture_screenshot").handler({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("No screen sources");
  });

  it("catches thrown errors", async () => {
    vi.mocked(captureAndUpload).mockRejectedValueOnce(new Error("crash"));
    const result = await findTool("capture_screenshot").handler({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("crash");
  });
});
