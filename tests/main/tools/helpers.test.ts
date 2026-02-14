import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron before importing helpers
const mockShow = vi.fn();
vi.mock("electron", () => ({
  Notification: class MockNotification {
    constructor(public opts: any) {}
    show = mockShow;
  },
}));

// Mock child_process to prevent real exec calls
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

import {
  escapeAppleScriptString,
  scheduleReminder,
  cancelReminder,
  listReminders,
  showNotification,
  setLastScreenshot,
  getLastScreenshot,
  clearLastScreenshot,
} from "../../../src/main/tools/helpers.js";

describe("escapeAppleScriptString", () => {
  it("escapes backslashes", () => {
    expect(escapeAppleScriptString("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(escapeAppleScriptString('say "hi"')).toBe('say \\"hi\\"');
  });

  it("escapes both backslashes and quotes", () => {
    expect(escapeAppleScriptString('path\\to\\"file"')).toBe('path\\\\to\\\\\\"file\\"');
  });

  it("handles empty string", () => {
    expect(escapeAppleScriptString("")).toBe("");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeAppleScriptString("hello world")).toBe("hello world");
  });
});

describe("reminder system", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Cancel all existing reminders
    for (const r of listReminders()) {
      cancelReminder(r.id);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scheduleReminder creates a reminder with valid ID and triggerAt", () => {
    const { id, triggerAt } = scheduleReminder("Test reminder", 60);
    expect(id).toMatch(/^reminder_\d+_[a-z0-9]+$/);
    expect(triggerAt).toBeInstanceOf(Date);
    expect(triggerAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("listReminders returns active reminders", () => {
    scheduleReminder("First", 60);
    scheduleReminder("Second", 120);
    const reminders = listReminders();
    expect(reminders).toHaveLength(2);
    expect(reminders[0].message).toBe("First");
    expect(reminders[1].message).toBe("Second");
    expect(reminders[0].triggerAt).toBeDefined();
  });

  it("cancelReminder returns true for existing reminder", () => {
    const { id } = scheduleReminder("Cancel me", 60);
    expect(cancelReminder(id)).toBe(true);
    expect(listReminders()).toHaveLength(0);
  });

  it("cancelReminder returns false for unknown ID", () => {
    expect(cancelReminder("nonexistent_id")).toBe(false);
  });

  it("reminder is auto-removed after triggering", () => {
    scheduleReminder("Trigger me", 10);
    expect(listReminders()).toHaveLength(1);
    vi.advanceTimersByTime(10 * 1000);
    expect(listReminders()).toHaveLength(0);
  });

  it("reminder triggers notification with correct message", () => {
    mockShow.mockClear();
    scheduleReminder("Hello from timer", 5);
    vi.advanceTimersByTime(5 * 1000);
    expect(mockShow).toHaveBeenCalled();
  });
});

describe("showNotification", () => {
  it("creates and shows a notification", () => {
    mockShow.mockClear();
    showNotification("Test Title", "Test Body");
    expect(mockShow).toHaveBeenCalled();
  });
});

describe("screenshot state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearLastScreenshot();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getLastScreenshot returns null when nothing is set", () => {
    expect(getLastScreenshot()).toBeNull();
  });

  it("setLastScreenshot then getLastScreenshot returns the path", () => {
    setLastScreenshot("/tmp/screenshot.png");
    expect(getLastScreenshot()).toBe("/tmp/screenshot.png");
  });

  it("getLastScreenshot returns null after 5 minutes", () => {
    setLastScreenshot("/tmp/screenshot.png");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getLastScreenshot()).toBeNull();
  });

  it("getLastScreenshot returns path before 5 minutes", () => {
    setLastScreenshot("/tmp/screenshot.png");
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(getLastScreenshot()).toBe("/tmp/screenshot.png");
  });

  it("clearLastScreenshot resets state", () => {
    setLastScreenshot("/tmp/screenshot.png");
    clearLastScreenshot();
    expect(getLastScreenshot()).toBeNull();
  });
});
