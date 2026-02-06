import { describe, it, expect, vi } from "vitest";

vi.mock("./helpers.js", () => ({
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
}));

// Mock child_process for clipboard tools that use require("node:child_process").spawn
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockProc = {
  stdin: mockStdin,
  on: vi.fn((event: string, cb: Function) => {
    if (event === "close") setTimeout(() => cb(0), 0);
  }),
};
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockProc),
}));

import { systemTools } from "./system-tools.js";
import { execAsync, execFileAsync } from "./helpers.js";

function findTool(name: string) {
  const tool = systemTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("run_shell_command", () => {
  it("returns stdout and stderr", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: "hello\n", stderr: "" } as any);
    const result = await findTool("run_shell_command").handler({ command: "echo hello" });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("hello");
    expect(execAsync).toHaveBeenCalledWith("echo hello", { timeout: 30000 });
  });

  it("returns error on failure", async () => {
    vi.mocked(execAsync).mockRejectedValueOnce(new Error("command not found"));
    const result = await findTool("run_shell_command").handler({ command: "badcmd" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("command not found");
  });
});

describe("open_application", () => {
  it("opens app with correct command", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("open_application").handler({ appName: "Safari" });
    expect(result.success).toBe(true);
    expect(execAsync).toHaveBeenCalledWith('open -a "Safari"', { timeout: 10000 });
  });
});

describe("get_do_not_disturb_status", () => {
  it("parses '1' as enabled", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: "1\n", stderr: "" } as any);
    const result = await findTool("get_do_not_disturb_status").handler({});
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it("parses '0' as disabled", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: "0\n", stderr: "" } as any);
    const result = await findTool("get_do_not_disturb_status").handler({});
    expect(result.enabled).toBe(false);
  });
});

describe("toggle_do_not_disturb", () => {
  it("reads current state and writes opposite", async () => {
    vi.mocked(execAsync)
      .mockResolvedValueOnce({ stdout: "1\n", stderr: "" } as any)  // read
      .mockResolvedValueOnce({ stdout: "", stderr: "" } as any);     // write
    const result = await findTool("toggle_do_not_disturb").handler({});
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

describe("set_do_not_disturb", () => {
  it("enables DND", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("set_do_not_disturb").handler({ enabled: true });
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(true);
  });
});

describe("toggle_airdrop", () => {
  it("enable=true writes DisableAirDrop -bool false (inverted)", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("toggle_airdrop").handler({ enable: true });
    expect(result.success).toBe(true);
    expect(execFileAsync).toHaveBeenCalledWith(
      "defaults",
      ["write", "com.apple.NetworkBrowser", "DisableAirDrop", "-bool", "false"],
    );
  });

  it("enable=false writes DisableAirDrop -bool true", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    await findTool("toggle_airdrop").handler({ enable: false });
    expect(execFileAsync).toHaveBeenCalledWith(
      "defaults",
      ["write", "com.apple.NetworkBrowser", "DisableAirDrop", "-bool", "true"],
    );
  });
});

describe("get_clipboard", () => {
  it("returns clipboard content", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "Hello clipboard", stderr: "" } as any);
    const result = await findTool("get_clipboard").handler({});
    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello clipboard");
  });

  it("reports empty clipboard", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("get_clipboard").handler({});
    expect(result.message).toContain("empty");
  });
});

describe("calculate", () => {
  it("opens Calculator app", async () => {
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("calculate").handler({});
    expect(result.success).toBe(true);
    expect(execFileAsync).toHaveBeenCalledWith("open", ["-a", "Calculator"]);
  });
});
