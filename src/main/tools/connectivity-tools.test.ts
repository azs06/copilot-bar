import { describe, it, expect, vi } from "vitest";

vi.mock("./helpers.js", () => ({
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
}));

const mockBluetooth = {
  isEnabled: vi.fn(() => true),
  setEnabled: vi.fn(),
};

vi.mock("./native-apis.js", () => ({
  getNativeApis: vi.fn(() => ({
    bluetooth: mockBluetooth,
  })),
}));

import { connectivityTools } from "./connectivity-tools.js";
import { execAsync, execFileAsync } from "./helpers.js";

function findTool(name: string) {
  const tool = connectivityTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

describe("get_wifi_status", () => {
  it("parses ON + connected network", async () => {
    // First call: listallhardwareports to detect interface
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: "Hardware Port: Wi-Fi\nDevice: en0\n", stderr: "" } as any)
      // getairportpower
      .mockResolvedValueOnce({ stdout: "Wi-Fi Power (en0): On\n", stderr: "" } as any)
      // getairportnetwork
      .mockResolvedValueOnce({ stdout: "Current Wi-Fi Network: MyNetwork\n", stderr: "" } as any);
    const result = await findTool("get_wifi_status").handler({});
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.networkName).toBe("MyNetwork");
  });

  it("parses OFF status", async () => {
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: "Hardware Port: Wi-Fi\nDevice: en0\n", stderr: "" } as any)
      .mockResolvedValueOnce({ stdout: "Wi-Fi Power (en0): Off\n", stderr: "" } as any)
      .mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("get_wifi_status").handler({});
    expect(result.enabled).toBe(false);
    expect(result.connected).toBe(false);
  });
});

describe("set_wifi", () => {
  it("turns wifi on", async () => {
    // _wifiInterface is cached from get_wifi_status tests, so no detection call needed
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("set_wifi").handler({ enabled: true });
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(true);
  });
});

describe("toggle_wifi", () => {
  it("flips current state", async () => {
    // _wifiInterface is cached from earlier tests, so no detection call needed
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: "Wi-Fi Power (en0): On\n", stderr: "" } as any)
      .mockResolvedValueOnce({ stdout: "", stderr: "" } as any);
    const result = await findTool("toggle_wifi").handler({});
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

describe("list_wifi_networks", () => {
  it("returns widget with saved networks", async () => {
    // _wifiInterface is cached from earlier tests, so no detection call needed
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: "Wi-Fi Power (en0): On\n", stderr: "" } as any)
      .mockResolvedValueOnce({ stdout: "Current Wi-Fi Network: Home\n", stderr: "" } as any)
      .mockResolvedValueOnce({ stdout: "Preferred networks on en0:\n\tHome\n\tOffice\n", stderr: "" } as any);
    const result = await findTool("list_wifi_networks").handler({});
    expect(result.widget).toBe("wifi");
    expect(result.enabled).toBe(true);
    expect(result.currentNetwork).toBe("Home");
    expect(result.savedNetworks).toContain("Home");
    expect(result.savedNetworks).toContain("Office");
  });
});

describe("set_bluetooth", () => {
  it("enables bluetooth via native API", async () => {
    const result = await findTool("set_bluetooth").handler({ enabled: true });
    expect(mockBluetooth.setEnabled).toHaveBeenCalledWith(true);
    expect(result.success).toBe(true);
  });
});

describe("get_bluetooth_status", () => {
  it("returns current status", async () => {
    mockBluetooth.isEnabled.mockReturnValueOnce(false);
    const result = await findTool("get_bluetooth_status").handler({});
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

describe("toggle_bluetooth", () => {
  it("flips native API state", async () => {
    mockBluetooth.isEnabled.mockReturnValueOnce(true);
    const result = await findTool("toggle_bluetooth").handler({});
    expect(mockBluetooth.setEnabled).toHaveBeenCalledWith(false);
    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

describe("list_bluetooth_devices", () => {
  const sampleJson = JSON.stringify({
    SPBluetoothDataType: [{
      device_connected: [
        { "AirPods Pro": { device_address: "AA:BB:CC:DD:EE:FF" } },
      ],
      device_not_connected: [
        { "Keyboard": { device_address: "11:22:33:44:55:66" } },
      ],
    }],
  });

  it("lists all devices", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: sampleJson, stderr: "" } as any);
    const result = await findTool("list_bluetooth_devices").handler({});
    expect(result.success).toBe(true);
    expect(result.devices).toHaveLength(2);
    expect(result.connected_count).toBe(1);
  });

  it("filters to connected only", async () => {
    vi.mocked(execAsync).mockResolvedValueOnce({ stdout: sampleJson, stderr: "" } as any);
    const result = await findTool("list_bluetooth_devices").handler({ connected_only: true });
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].name).toBe("AirPods Pro");
    expect(result.devices[0].connected).toBe(true);
  });
});
