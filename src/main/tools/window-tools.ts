import { defineTool } from "@github/copilot-sdk";
import { runAppleScript, escapeAppleScriptString } from "./helpers.js";
import { getNativeApis } from "./native-apis.js";

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
        const { getWidth, getHeight } = getNativeApis().screen;
        const screenWidth = getWidth();
        const screenHeight = getHeight();
        const halfWidth = Math.floor(screenWidth / 2);

        let leftAppName = left_app;
        if (!leftAppName) {
          leftAppName = await runAppleScript(`
            tell application "System Events"
              return name of first application process whose frontmost is true
            end tell
          `, 5000);
        }

        const leftEscaped = escapeAppleScriptString(leftAppName);

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

export const windowTools = [
  listWindowsTool,
  arrangeWindowsTool,
  focusWindowTool,
  closeWindowTool,
];
