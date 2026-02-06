import { CopilotClient, type CopilotSession, type ModelInfo } from "@github/copilot-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./database.js";
import { allTools } from "./tools/index.js";
import { getLastScreenshot, clearLastScreenshot } from "./tools/helpers.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

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

export interface StreamDelta {
  messageId: string;
  content: string;
}

export interface ScreenshotEvent {
  path?: string;
  url?: string;
}

export interface ModelUsageEvent {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export { ModelInfo };

export class CopilotService {
  private client: CopilotClient | null = null;
  private sessions: Map<number, CopilotSession> = new Map();
  private currentModel: string = "";
  private onToolEvent: ((event: ToolEvent) => void) | null = null;
  private onWidgetEvent: ((event: WidgetEvent) => void) | null = null;
  private onStreamDelta: ((delta: StreamDelta) => void) | null = null;
  private onScreenshotEvent: ((event: ScreenshotEvent) => void) | null = null;
  private onModelUsage: ((event: ModelUsageEvent) => void) | null = null;
  private activeTools: Map<string, string> = new Map(); // toolCallId -> toolName

  setToolEventHandler(handler: (event: ToolEvent) => void) {
    this.onToolEvent = handler;
  }

  setWidgetEventHandler(handler: (event: WidgetEvent) => void) {
    this.onWidgetEvent = handler;
  }

  setStreamHandler(handler: (delta: StreamDelta) => void) {
    this.onStreamDelta = handler;
  }

  setScreenshotEventHandler(handler: (event: ScreenshotEvent) => void) {
    this.onScreenshotEvent = handler;
  }

  setModelUsageHandler(handler: (event: ModelUsageEvent) => void) {
    this.onModelUsage = handler;
  }

  async initialize(): Promise<void> {
    this.client = new CopilotClient();
    await this.client.start();
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client) await this.initialize();
    return this.client!.listModels();
  }

  /** Destroy a session and permanently delete its persisted data so it doesn't
   *  appear in VS Code's Copilot Chat sessions list. */
  private async destroyAndDelete(session: CopilotSession): Promise<void> {
    const sid = session.sessionId;
    try { await session.destroy(); } catch {}
    try { await this.client!.deleteSession(sid); } catch {}
  }

  private async getOrCreateSession(sessionId: number, model: string): Promise<CopilotSession> {
    if (!this.client) {
      await this.initialize();
    }

    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = await this.client!.createSession({
      model,
      streaming: true,
      tools: allTools,
      configDir: join(homedir(), ".copilot-bar", "copilot-state"),
      systemMessage: {
        mode: "append",
        content: SYSTEM_PROMPT,
      },
    });

    session.on((event) => {
      console.log("[session event]", event.type, JSON.stringify(event.data).substring(0, 120));
      if (event.type === "session.error") {
        console.error("[session] error, evicting session:", sessionId);
        this.sessions.delete(sessionId);
      }
      // Forward SDK automatic compaction events to the renderer
      if (event.type === "session.compaction_start" && this.onToolEvent) {
        this.onToolEvent({ type: "start", toolName: "context_compaction", toolCallId: "compaction" });
      } else if (event.type === "session.compaction_complete" && this.onToolEvent) {
        this.onToolEvent({ type: "complete", toolName: "context_compaction", toolCallId: "compaction" });
      }

      // Forward streaming deltas to the renderer (top-level messages only)
      if (event.type === "assistant.message_delta" && this.onStreamDelta) {
        if (event.data.deltaContent && !event.data.parentToolCallId) {
          this.onStreamDelta({
            messageId: event.data.messageId,
            content: event.data.deltaContent,
          });
        }
      }

      // Capture the actual model used per response
      if (event.type === "assistant.usage" && this.onModelUsage && event.data.model) {
        this.onModelUsage({
          model: event.data.model,
          inputTokens: event.data.inputTokens,
          outputTokens: event.data.outputTokens,
          cost: event.data.cost,
        });
      }

      // Log selected model on session start
      if (event.type === "session.start" && event.data.selectedModel) {
        console.log("[session] selected model:", event.data.selectedModel);
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

        if (event.data.result?.content) {
          try {
            const result = JSON.parse(event.data.result.content);
            if (this.onWidgetEvent && result.widget) {
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
            if (this.onScreenshotEvent && toolName === "capture_screenshot" && result.success) {
              if (result.path || result.url) {
                this.onScreenshotEvent({ path: result.path, url: result.url });
              }
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
      await Promise.allSettled(Array.from(this.sessions.values()).map((s) => this.destroyAndDelete(s)));
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
      // Session may be dead — evict and delete so it doesn't linger in Copilot history
      this.sessions.delete(sessionId);
      await this.destroyAndDelete(session);
      throw error;
    }
  }

  async compactSession(sessionId: number): Promise<{ success: boolean; summary?: string; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: "No active session to compact" };
    }

    try {
      // Ask the current session to summarize the conversation
      const summaryResponse = await session.sendAndWait({
        prompt:
          "Summarize our entire conversation concisely. Include key topics, decisions made, tools used, and any ongoing tasks. This summary will be used to continue in a fresh context window.",
      }, 60000);

      const summary = summaryResponse?.data?.content || "";
      if (!summary) {
        return { success: false, error: "Failed to generate summary" };
      }

      // Destroy old session and delete its persisted data
      await this.destroyAndDelete(session);
      this.sessions.delete(sessionId);

      // Create a fresh session primed with the summary
      const config = loadConfig();
      this.currentModel = config.model;
      const newSession = await this.getOrCreateSession(sessionId, config.model);

      await newSession.sendAndWait({
        prompt: `[Context from compacted conversation]\n\n${summary}\n\nAcknowledge briefly that you have this context.`,
      }, 30000);

      return { success: true, summary };
    } catch (error: any) {
      this.sessions.delete(sessionId);
      return { success: false, error: error.message };
    }
  }

  async cleanup(): Promise<void> {
    if (this.client && this.sessions.size > 0) {
      await Promise.allSettled(Array.from(this.sessions.values()).map((s) => this.destroyAndDelete(s)));
      this.sessions.clear();
    }
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
