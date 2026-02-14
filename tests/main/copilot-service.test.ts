import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the copilot SDK
const mockDestroy = vi.fn();
const mockSendAndWait = vi.fn();
const mockOn = vi.fn();
const mockSession = {
  destroy: mockDestroy,
  sendAndWait: mockSendAndWait,
  on: mockOn,
};

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockCreateSession = vi.fn(() => mockSession);

vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: vi.fn(() => ({
    start: mockStart,
    stop: mockStop,
    createSession: mockCreateSession,
  })),
}));

vi.mock("../../src/main/database.js", () => ({
  loadConfig: vi.fn(() => ({
    model: "gpt-5-mini",
    shortcut: "CommandOrControl+Shift+T",
    theme: "dark",
  })),
}));

vi.mock("../../src/main/tools/index.js", () => ({
  allTools: [],
}));

vi.mock("../../src/main/tools/helpers.js", () => ({
  getLastScreenshot: vi.fn(() => null),
  clearLastScreenshot: vi.fn(),
}));

import { CopilotService } from "../../src/main/copilot-service.js";
import { loadConfig } from "../../src/main/database.js";
import { getLastScreenshot, clearLastScreenshot } from "../../src/main/tools/helpers.js";

let service: CopilotService;

beforeEach(() => {
  service = new CopilotService();
  mockDestroy.mockReset();
  mockSendAndWait.mockReset();
  mockOn.mockReset();
  mockStart.mockReset();
  mockStop.mockReset();
  mockCreateSession.mockReset().mockReturnValue(mockSession);
});

describe("initialize", () => {
  it("creates client and calls start()", async () => {
    await service.initialize();
    expect(mockStart).toHaveBeenCalledOnce();
  });
});

describe("chat", () => {
  it("creates session on first call", async () => {
    mockSendAndWait.mockResolvedValueOnce({ data: { content: "Hello!" } });
    const reply = await service.chat("Hi", 1);
    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(reply).toBe("Hello!");
  });

  it("reuses session on second call", async () => {
    mockSendAndWait.mockResolvedValue({ data: { content: "ok" } });
    await service.chat("First", 1);
    await service.chat("Second", 1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it("recreates sessions when model changes", async () => {
    mockSendAndWait.mockResolvedValue({ data: { content: "ok" } });
    await service.chat("Hello", 1);

    vi.mocked(loadConfig).mockReturnValueOnce({
      model: "gpt-5",
      shortcut: "CommandOrControl+Shift+T",
      theme: "dark",
    });

    await service.chat("New model", 1);
    // First call creates one session, model change clears and creates another
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("attaches screenshot when available", async () => {
    vi.mocked(getLastScreenshot).mockReturnValueOnce("/tmp/screenshot.png");
    mockSendAndWait.mockResolvedValueOnce({ data: { content: "I see your screen" } });
    await service.chat("What's on my screen?", 1);
    expect(mockSendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ type: "file", path: "/tmp/screenshot.png", displayName: "screenshot.png" }],
      }),
      120000,
    );
    expect(clearLastScreenshot).toHaveBeenCalled();
  });

  it("evicts session on sendAndWait failure", async () => {
    mockSendAndWait.mockRejectedValueOnce(new Error("session dead"));
    await expect(service.chat("fail", 1)).rejects.toThrow("session dead");
    expect(mockDestroy).toHaveBeenCalled();

    // Next call should create a new session
    mockSendAndWait.mockResolvedValueOnce({ data: { content: "back" } });
    await service.chat("retry", 1);
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
  });
});

describe("event handling", () => {
  it("emits tool start/complete events", async () => {
    const events: Array<any> = [];
    service.setToolEventHandler((e) => events.push(e));

    mockSendAndWait.mockResolvedValueOnce({ data: { content: "ok" } });
    await service.chat("Hi", 1);

    // Get the event handler registered via session.on
    const onHandler = mockOn.mock.calls[0][0];

    // Simulate tool execution start
    onHandler({ type: "tool.execution_start", data: { toolName: "set_volume", toolCallId: "call_1" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "start", toolName: "set_volume", toolCallId: "call_1" });

    // Simulate tool execution complete
    onHandler({ type: "tool.execution_complete", data: { toolCallId: "call_1", result: { content: "{}" } } });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: "complete", toolName: "set_volume", toolCallId: "call_1" });
  });

  it("parses widget from tool result JSON", async () => {
    const widgets: Array<any> = [];
    service.setWidgetEventHandler((e) => widgets.push(e));
    service.setToolEventHandler(() => {});

    mockSendAndWait.mockResolvedValueOnce({ data: { content: "ok" } });
    await service.chat("Hi", 1);

    const onHandler = mockOn.mock.calls[0][0];

    // Start then complete with widget result
    onHandler({ type: "tool.execution_start", data: { toolName: "start_timer", toolCallId: "c1" } });
    onHandler({
      type: "tool.execution_complete",
      data: { toolCallId: "c1", result: { content: JSON.stringify({ widget: "timer" }) } },
    });

    expect(widgets).toHaveLength(1);
    expect(widgets[0].type).toBe("timer");
  });
});

describe("cleanup", () => {
  it("destroys all sessions and stops client", async () => {
    mockSendAndWait.mockResolvedValue({ data: { content: "ok" } });
    await service.chat("Hi", 1);
    await service.chat("Hi", 2);

    await service.cleanup();
    expect(mockDestroy).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
  });
});
