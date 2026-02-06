import { Notification } from "electron";
import { exec, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs";

export const writeFileAsync = promisify(writeFile);
export const unlinkAsync = promisify(unlink);
export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFileCb);

// Run AppleScript via -e flags (no temp files, no sync I/O on main thread)
export async function runAppleScript(script: string, timeout = 10000): Promise<string> {
  const args = script.split("\n").map(l => l.trim()).filter(Boolean).flatMap(line => ["-e", line]);
  const { stdout } = await execFileAsync("osascript", args, { timeout });
  return stdout.trim();
}

// Helper to safely escape a string for embedding in AppleScript double-quoted strings
export function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Reminder storage (in-memory for current session)
export interface Reminder {
  id: string;
  message: string;
  triggerAt: Date;
  timerId: NodeJS.Timeout;
}

const activeReminders: Map<string, Reminder> = new Map();

function generateReminderId(): string {
  return `reminder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function showNotification(title: string, body: string): void {
  const notification = new Notification({
    title,
    body,
    sound: "default",
  });
  notification.show();
}

export function scheduleReminder(message: string, delaySeconds: number): { id: string; triggerAt: Date } {
  const id = generateReminderId();
  const triggerAt = new Date(Date.now() + delaySeconds * 1000);

  const timerId = setTimeout(() => {
    showNotification("Reminder", message);
    activeReminders.delete(id);
  }, delaySeconds * 1000);

  activeReminders.set(id, { id, message, triggerAt, timerId });

  return { id, triggerAt };
}

export function cancelReminder(id: string): boolean {
  const reminder = activeReminders.get(id);
  if (reminder) {
    clearTimeout(reminder.timerId);
    activeReminders.delete(id);
    return true;
  }
  return false;
}

export function listReminders(): Array<{ id: string; message: string; triggerAt: string }> {
  return Array.from(activeReminders.values()).map((r) => ({
    id: r.id,
    message: r.message,
    triggerAt: r.triggerAt.toISOString(),
  }));
}

// Module-level screenshot state for vision analysis
let lastScreenshotPath: string | null = null;
let lastScreenshotTime: number = 0;
const SCREENSHOT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function setLastScreenshot(path: string): void {
  lastScreenshotPath = path;
  lastScreenshotTime = Date.now();
}

export function getLastScreenshot(): string | null {
  // Return null if screenshot is too old
  if (lastScreenshotPath && Date.now() - lastScreenshotTime < SCREENSHOT_EXPIRY_MS) {
    return lastScreenshotPath;
  }
  return null;
}

export function clearLastScreenshot(): void {
  lastScreenshotPath = null;
  lastScreenshotTime = 0;
}
