import { describe, it, expect, vi } from "vitest";

const mockVolume = {
  get: vi.fn(() => 0.5),
  set: vi.fn(),
  getMute: vi.fn(() => false),
  setMute: vi.fn(),
};

const mockBrightness = {
  get: vi.fn(() => 0.75),
  set: vi.fn(),
};

vi.mock("./native-apis.js", () => ({
  getNativeApis: vi.fn(() => ({
    volume: mockVolume,
    brightness: mockBrightness,
  })),
}));

import { audioVisualTools } from "./audio-visual-tools.js";

function findTool(name: string) {
  const tool = audioVisualTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("set_volume", () => {
  it("sets volume as fraction of 100", async () => {
    const result = await findTool("set_volume").handler({ volume: 50 });
    expect(mockVolume.set).toHaveBeenCalledWith(0.5);
    expect(result.success).toBe(true);
    expect(result.message).toContain("50%");
  });

  it("clamps negative to 0", async () => {
    const result = await findTool("set_volume").handler({ volume: -10 });
    expect(mockVolume.set).toHaveBeenCalledWith(0);
    expect(result.message).toContain("0%");
  });

  it("clamps above 100 to 100", async () => {
    const result = await findTool("set_volume").handler({ volume: 150 });
    expect(mockVolume.set).toHaveBeenCalledWith(1);
    expect(result.message).toContain("100%");
  });

  it("returns error when native API throws", async () => {
    mockVolume.set.mockImplementationOnce(() => { throw new Error("FFI fail"); });
    const result = await findTool("set_volume").handler({ volume: 50 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("FFI fail");
  });
});

describe("get_volume", () => {
  it("returns rounded percentage", async () => {
    mockVolume.get.mockReturnValueOnce(0.753);
    const result = await findTool("get_volume").handler({});
    expect(result.success).toBe(true);
    expect(result.volume).toBe(75);
  });

  it("returns error on failure", async () => {
    mockVolume.get.mockImplementationOnce(() => { throw new Error("no audio"); });
    const result = await findTool("get_volume").handler({});
    expect(result.success).toBe(false);
  });
});

describe("toggle_mute", () => {
  it("mutes when true", async () => {
    const result = await findTool("toggle_mute").handler({ mute: true });
    expect(mockVolume.setMute).toHaveBeenCalledWith(true);
    expect(result.success).toBe(true);
    expect(result.message).toBe("Muted");
  });

  it("unmutes when false", async () => {
    const result = await findTool("toggle_mute").handler({ mute: false });
    expect(mockVolume.setMute).toHaveBeenCalledWith(false);
    expect(result.message).toBe("Unmuted");
  });
});

describe("get_brightness", () => {
  it("returns rounded percentage", async () => {
    mockBrightness.get.mockReturnValueOnce(0.826);
    const result = await findTool("get_brightness").handler({});
    expect(result.success).toBe(true);
    expect(result.brightness).toBe(83);
  });
});

describe("set_brightness", () => {
  it("action=set calls brightness.set with normalized value", async () => {
    const result = await findTool("set_brightness").handler({ action: "set", level: 80 });
    expect(mockBrightness.set).toHaveBeenCalledWith(0.8);
    expect(result.success).toBe(true);
    expect(result.brightness).toBe(80);
  });

  it("action=set clamps to 0-100", async () => {
    await findTool("set_brightness").handler({ action: "set", level: 120 });
    expect(mockBrightness.set).toHaveBeenCalledWith(1);
  });

  it("action=up increases by step", async () => {
    mockBrightness.get.mockReturnValueOnce(0.5);
    const result = await findTool("set_brightness").handler({ action: "up", step: 20 });
    expect(mockBrightness.set).toHaveBeenCalledWith(0.7);
    expect(result.brightness).toBe(70);
  });

  it("action=down decreases by step, clamped at 0", async () => {
    mockBrightness.get.mockReturnValueOnce(0.05);
    const result = await findTool("set_brightness").handler({ action: "down", step: 10 });
    expect(mockBrightness.set).toHaveBeenCalledWith(0);
    expect(result.brightness).toBe(0);
  });

  it("uses default step of 10", async () => {
    mockBrightness.get.mockReturnValueOnce(0.5);
    await findTool("set_brightness").handler({ action: "up" });
    expect(mockBrightness.set).toHaveBeenCalledWith(0.6);
  });

  it("returns error when native API throws", async () => {
    mockBrightness.get.mockImplementationOnce(() => { throw new Error("no display"); });
    const result = await findTool("set_brightness").handler({ action: "up" });
    expect(result.success).toBe(false);
  });
});
