import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/tools/helpers.js", () => ({
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
  writeFileAsync: vi.fn(),
  unlinkAsync: vi.fn(),
}));

import { webTools } from "../../../src/main/tools/web-tools.js";
import { execFileAsync, writeFileAsync, unlinkAsync } from "../../../src/main/tools/helpers.js";

function findTool(name: string) {
  const tool = webTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool as unknown as { handler: (args: any) => Promise<any> };
}

describe("summarize_url", () => {
  it("strips HTML and extracts title", async () => {
    const html = `<html><head><title>Test Page</title></head><body>
      <script>alert(1)</script>
      <p>This is a really long test sentence that should be included in the summary output for sure.</p>
      <p>Another important sentence that adds more context to the page content here please.</p>
    </body></html>`;
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: html, stderr: "" } as any);
    const result = await findTool("summarize_url").handler({ url: "https://example.com" });
    expect(result.success).toBe(true);
    expect(result.title).toBe("Test Page");
    expect(result.summary).not.toContain("<script>");
    expect(result.summary).not.toContain("<p>");
  });

  it("truncates to max_length", async () => {
    const html = `<title>Long</title><p>${"A long sentence that goes on and on forever. ".repeat(50)}</p>`;
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: html, stderr: "" } as any);
    const result = await findTool("summarize_url").handler({ url: "https://example.com", max_length: 50 });
    expect(result.summary.length).toBeLessThanOrEqual(53); // 50 + "..."
  });

  it("returns error on fetch failure", async () => {
    vi.mocked(execFileAsync).mockRejectedValueOnce(new Error("Connection refused"));
    const result = await findTool("summarize_url").handler({ url: "https://bad.example" });
    expect(result.success).toBe(false);
  });
});

describe("get_weather", () => {
  it("encodes location and uses brief format", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "London: ☀ +15°C 10km/h\n", stderr: "" } as any);
    const result = await findTool("get_weather").handler({ location: "London" });
    expect(result.success).toBe(true);
    expect(result.location).toBe("London");
    expect(execFileAsync).toHaveBeenCalledWith(
      "curl",
      ["-s", "wttr.in/London?format=%l:+%c+%t+%w", "--max-time", "10"],
      { timeout: 15000 },
    );
  });

  it("handles spaces in location", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "New York: ☀\n", stderr: "" } as any);
    await findTool("get_weather").handler({ location: "New York" });
    expect(execFileAsync).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([expect.stringContaining("New%20York")]),
      expect.anything(),
    );
  });

  it("returns error for unknown location", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "Unknown location: bad\n", stderr: "" } as any);
    const result = await findTool("get_weather").handler({ location: "bad" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown location");
  });

  it("uses full format when specified", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "Full weather data\n", stderr: "" } as any);
    await findTool("get_weather").handler({ location: "Paris", format: "full" });
    expect(execFileAsync).toHaveBeenCalledWith(
      "curl",
      ["-s", "wttr.in/Paris", "--max-time", "10"],
      { timeout: 15000 },
    );
  });
});

describe("analyze_image", () => {
  it("parses dimensions from sips output", async () => {
    (vi.mocked(execFileAsync).mockImplementation as any)(async (cmd: any, ..._args: any[]) => {
      if (cmd === "mdls") {
        return { stdout: 'kMDItemFSSize = 1048576\nkMDItemContentType = "public.png"\nkMDItemFSCreationDate = 2025-01-01', stderr: "" };
      }
      if (cmd === "sips") {
        return { stdout: "pixelWidth: 1920\npixelHeight: 1080\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const result = await findTool("analyze_image").handler({ path: "/tmp/test.png" });
    expect(result.success).toBe(true);
    expect(result.dimensions).toBe("1920x1080");
    expect(result.file_size).toBe("1.00 MB");
    expect(result.content_type).toBe("public.png");
  });

  it("handles missing sips data", async () => {
    (vi.mocked(execFileAsync).mockImplementation as any)(async (cmd: any, ..._args: any[]) => {
      if (cmd === "mdls") {
        return { stdout: "kMDItemFSSize = 2048", stderr: "" };
      }
      throw new Error("sips failed");
    });
    const result = await findTool("analyze_image").handler({ path: "/tmp/test.png" });
    expect(result.dimensions).toBe("Unknown");
  });
});

describe("run_code", () => {
  it("writes temp file, executes, and cleans up", async () => {
    vi.mocked(writeFileAsync).mockResolvedValueOnce(undefined);
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "42\n", stderr: "" } as any);
    vi.mocked(unlinkAsync).mockResolvedValueOnce(undefined);
    const result = await findTool("run_code").handler({ language: "python", code: "print(42)" });
    expect(result.success).toBe(true);
    expect(result.output).toBe("42\n");
    expect(writeFileAsync).toHaveBeenCalledWith(expect.stringContaining(".py"), "print(42)", "utf-8");
    expect(execFileAsync).toHaveBeenCalledWith("python3", [expect.stringContaining(".py")], { timeout: 30000 });
    expect(unlinkAsync).toHaveBeenCalled();
  });

  it("uses node for javascript", async () => {
    vi.mocked(writeFileAsync).mockResolvedValueOnce(undefined);
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "ok", stderr: "" } as any);
    vi.mocked(unlinkAsync).mockResolvedValueOnce(undefined);
    await findTool("run_code").handler({ language: "javascript", code: "console.log('ok')" });
    expect(execFileAsync).toHaveBeenCalledWith("node", [expect.stringContaining(".js")], expect.anything());
  });

  it("caps timeout at 60 seconds", async () => {
    vi.mocked(writeFileAsync).mockResolvedValueOnce(undefined);
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    vi.mocked(unlinkAsync).mockResolvedValueOnce(undefined);
    await findTool("run_code").handler({ language: "python", code: "", timeout: 120 });
    expect(execFileAsync).toHaveBeenCalledWith("python3", expect.anything(), { timeout: 60000 });
  });

  it("cleans up on error", async () => {
    vi.mocked(writeFileAsync).mockResolvedValueOnce(undefined);
    vi.mocked(execFileAsync).mockRejectedValueOnce(Object.assign(new Error("timeout"), { stdout: "", stderr: "err" }));
    vi.mocked(unlinkAsync).mockResolvedValueOnce(undefined);
    const result = await findTool("run_code").handler({ language: "python", code: "while True: pass" });
    expect(result.success).toBe(false);
    expect(unlinkAsync).toHaveBeenCalled();
  });
});
