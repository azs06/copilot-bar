import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/tools/helpers.js", () => ({
  runAppleScript: vi.fn(),
  execFileAsync: vi.fn(),
}));

import { mediaTools } from "../../../src/main/tools/media-tools.js";
import { runAppleScript, execFileAsync } from "../../../src/main/tools/helpers.js";

function findTool(name: string) {
  const tool = mediaTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool as unknown as { handler: (args: any) => Promise<any> };
}

describe("play_music", () => {
  it("plays Spotify", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("play_music").handler({ app: "spotify" });
    expect(result.success).toBe(true);
    expect(runAppleScript).toHaveBeenCalledWith('tell application "Spotify" to play');
  });

  it("plays Apple Music", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("play_music").handler({ app: "music" });
    expect(runAppleScript).toHaveBeenCalledWith('tell application "Music" to play');
    expect(result.app).toBe("music");
  });
});

describe("pause_music", () => {
  it("pauses the app", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("pause_music").handler({ app: "spotify" });
    expect(result.success).toBe(true);
    expect(result.action).toBe("pause");
  });
});

describe("next_track", () => {
  it("skips to next track", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("next_track").handler({ app: "spotify" });
    expect(result.action).toBe("next");
    expect(runAppleScript).toHaveBeenCalledWith('tell application "Spotify" to next track');
  });
});

describe("previous_track", () => {
  it("goes to previous track", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("previous_track").handler({ app: "music" });
    expect(result.action).toBe("previous");
    expect(runAppleScript).toHaveBeenCalledWith('tell application "Music" to previous track');
  });
});

describe("get_music_status", () => {
  it("returns parsed status", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("Playing: Song Name by Artist");
    const result = await findTool("get_music_status").handler({ app: "spotify" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("Playing: Song Name by Artist");
  });

  it("returns error on failure", async () => {
    vi.mocked(runAppleScript).mockRejectedValueOnce(new Error("App not running"));
    const result = await findTool("get_music_status").handler({ app: "spotify" });
    expect(result.success).toBe(false);
  });
});

describe("speech_to_text", () => {
  it("activates dictation via keycode", async () => {
    vi.mocked(runAppleScript).mockResolvedValueOnce("");
    const result = await findTool("speech_to_text").handler({});
    expect(result.success).toBe(true);
    expect(runAppleScript).toHaveBeenCalledWith(
      expect.stringContaining("key code 63"),
      5000,
    );
  });
});

describe("speak_text", () => {
  it("builds args with voice and rate", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("speak_text").handler({ text: "Hello", voice: "Alex", rate: 200 });
    expect(result.success).toBe(true);
    expect(result.voice).toBe("Alex");
    expect(result.rate).toBe(200);
    // execFileAsync is called fire-and-forget (.catch), but the args are passed
    expect(execFileAsync).toHaveBeenCalledWith("say", ["Hello", "-r", "200", "-v", "Alex"]);
  });

  it("uses default rate and voice", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("speak_text").handler({ text: "Test" });
    expect(result.voice).toBe("default");
    expect(result.rate).toBe(175);
    expect(execFileAsync).toHaveBeenCalledWith("say", ["Test", "-r", "175"]);
  });

  it("truncates long text in response", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const long = "a".repeat(200);
    const result = await findTool("speak_text").handler({ text: long });
    expect(result.text).toBe("a".repeat(100) + "...");
  });
});
