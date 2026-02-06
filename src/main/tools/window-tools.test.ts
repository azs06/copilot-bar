import { describe, it, expect, vi } from "vitest";

vi.mock("./helpers.js", () => ({
  runAppleScript: vi.fn(),
  escapeAppleScriptString: vi.fn((s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')),
}));

vi.mock("./native-apis.js", () => ({
  getNativeApis: vi.fn(() => ({
    screen: { getWidth: vi.fn(() => 1920), getHeight: vi.fn(() => 1080) },
  })),
}));

import { windowTools } from "./window-tools.js";
import { runAppleScript } from "./helpers.js";

function findTool(name: string) {
  const tool = windowTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("list_windows", () => {
  it("parses AppleScript comma-separated output", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("Safari, 3, true, true, Terminal, 1, true, false");
    const result = await findTool("list_windows").handler({});
    expect(result.success).toBe(true);
    expect(result.apps).toHaveLength(2);
    expect(result.apps[0].name).toBe("Safari");
    expect(result.apps[0].windows).toBe(3);
    expect(result.apps[0].frontmost).toBe(true);
  });

  it("returns error on failure", async () => {
    vi.mocked(runAppleScript).mockRejectedValueOnce(new Error("not allowed"));
    const result = await findTool("list_windows").handler({});
    expect(result.success).toBe(false);
  });
});

describe("arrange_windows", () => {
  it("maximize uses screen dimensions", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("arrange_windows").handler({ layout: "maximize", app_name: "Safari" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("1920x1080");
    expect(runAppleScript).toHaveBeenCalledWith(expect.stringContaining("1920"));
  });

  it("split computes half width", async () => {
    vi.mocked(runAppleScript)
      .mockResolvedValueOnce("") // left script
      .mockResolvedValueOnce(""); // right script
    const result = await findTool("arrange_windows").handler({
      layout: "split", left_app: "Safari", right_app: "Terminal",
    });
    expect(result.success).toBe(true);
    // Check left gets position 0 and right gets position 960 (1920/2)
    const calls = vi.mocked(runAppleScript).mock.calls;
    expect(calls[0][0]).toContain("960");
  });

  it("returns error for unknown layout", async () => {
    const result = await findTool("arrange_windows").handler({ layout: "unknown" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown layout");
  });

  it("cascade arranges windows", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("arrange_windows").handler({ layout: "cascade" });
    expect(result.success).toBe(true);
    expect(result.message).toContain("cascade");
  });
});

describe("focus_window", () => {
  it("sets app frontmost", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("focus_window").handler({ app_name: "Safari" });
    expect(result.success).toBe(true);
    expect(runAppleScript).toHaveBeenCalledWith(expect.stringContaining("frontmost"), 5000);
  });
});

describe("close_window", () => {
  it("closes specific app window", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("close_window").handler({ app_name: "Safari" });
    expect(result.success).toBe(true);
    expect(runAppleScript).toHaveBeenCalledWith(expect.stringContaining("Safari"), 5000);
  });

  it("sends Cmd+W when no app_name", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("close_window").handler({});
    expect(result.success).toBe(true);
    expect(runAppleScript).toHaveBeenCalledWith(
      expect.stringContaining("keystroke"),
      3000,
    );
  });
});
