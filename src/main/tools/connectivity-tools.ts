import { defineTool } from "@github/copilot-sdk";
import { execAsync, execFileAsync } from "./helpers.js";
import { getNativeApis } from "./native-apis.js";

// Cached WiFi interface name — detected once, reused for the session
let _wifiInterface: string | null = null;

async function getWifiInterface(): Promise<string> {
  if (!_wifiInterface) {
    try {
      const { stdout } = await execFileAsync(
        "networksetup", ["-listallhardwareports"],
        { timeout: 5000 }
      );
      const match = stdout.match(/Wi-Fi|AirPort/);
      if (match) {
        const lines = stdout.split("\n");
        const idx = lines.findIndex(l => /Wi-Fi|AirPort/.test(l));
        const deviceLine = lines[idx + 1];
        const deviceMatch = deviceLine?.match(/Device:\s*(\S+)/);
        if (deviceMatch) _wifiInterface = deviceMatch[1];
      }
    } catch { /* fall through to default */ }
    _wifiInterface ??= "en0";
  }
  return _wifiInterface;
}

// WiFi control tools
const setWifiTool = defineTool("set_wifi", {
  description: "Turn WiFi on or off on macOS.",
  parameters: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "True to turn WiFi on, false to turn it off",
      },
    },
    required: ["enabled"],
  },
  handler: async ({ enabled }: { enabled: boolean }) => {
    try {
      const iface = await getWifiInterface();
      await execFileAsync("networksetup", ["-setairportpower", iface, enabled ? "on" : "off"], { timeout: 10000 });
      return { success: true, enabled, message: enabled ? "WiFi turned on" : "WiFi turned off" };
    } catch (error: any) {
      return { success: false, error: `Failed to set WiFi: ${error.message}` };
    }
  },
});

const getWifiStatusTool = defineTool("get_wifi_status", {
  description: "Get the current WiFi status on macOS - whether it's on or off, and the current network name if connected.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      const [powerResult, networkResult] = await Promise.all([
        execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 }),
        execFileAsync("networksetup", ["-getairportnetwork", iface], { timeout: 5000 }).catch(() => null),
      ]);
      const isOn = powerResult.stdout.toLowerCase().includes("on");
      if (!isOn) {
        return { success: true, enabled: false, connected: false, message: "WiFi is OFF" };
      }
      const ssidMatch = networkResult?.stdout.match(/Current Wi-Fi Network: (.+)/);
      const networkName = ssidMatch ? ssidMatch[1].trim() : null;
      return {
        success: true,
        enabled: true,
        connected: !!networkName,
        networkName,
        message: networkName ? `WiFi is ON, connected to "${networkName}"` : "WiFi is ON but not connected"
      };
    } catch (error: any) {
      return { success: false, error: `Failed to get WiFi status: ${error.message}` };
    }
  },
});

const toggleWifiTool = defineTool("toggle_wifi", {
  description: "Toggle WiFi on macOS. If it's on, turn it off. If it's off, turn it on.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      const { stdout } = await execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 });
      const newState = !stdout.toLowerCase().includes("on");
      await execFileAsync("networksetup", ["-setairportpower", iface, newState ? "on" : "off"], { timeout: 10000 });
      return { success: true, enabled: newState, message: newState ? "WiFi turned on" : "WiFi turned off" };
    } catch (error: any) {
      return { success: false, error: `Failed to toggle WiFi: ${error.message}` };
    }
  },
});

const listWifiNetworksTool = defineTool("list_wifi_networks", {
  description: "List saved/preferred WiFi networks on macOS and show the current connection status. Displays an interactive widget.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const iface = await getWifiInterface();
      const [powerResult, networkResult, preferredResult] = await Promise.all([
        execFileAsync("networksetup", ["-getairportpower", iface], { timeout: 5000 }),
        execFileAsync("networksetup", ["-getairportnetwork", iface], { timeout: 5000 }).catch(() => null),
        execFileAsync("networksetup", ["-listpreferredwirelessnetworks", iface], { timeout: 5000 }).catch(() => null),
      ]);
      const isOn = powerResult.stdout.toLowerCase().includes("on");
      if (!isOn) {
        return { widget: "wifi", enabled: false, connected: false, currentNetwork: null, savedNetworks: [], message: "WiFi is turned off" };
      }
      const ssidMatch = networkResult?.stdout.match(/Current Wi-Fi Network: (.+)/);
      const currentNetwork = ssidMatch ? ssidMatch[1].trim() : null;
      const savedNetworks = (preferredResult?.stdout.trim().split("\n").slice(1) ?? [])
        .map(l => l.trim()).filter(Boolean);
      return {
        widget: "wifi",
        enabled: true,
        currentNetwork,
        connected: !!currentNetwork,
        savedNetworks,
        message: currentNetwork ? `Connected to "${currentNetwork}"` : "WiFi is on but not connected"
      };
    } catch (error: any) {
      return { widget: "wifi", enabled: false, error: `Failed to list WiFi networks: ${error.message}` };
    }
  },
});

// Bluetooth tools
const setBluetoothTool = defineTool("set_bluetooth", {
  description: "Turn Bluetooth on or off on macOS.",
  parameters: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "True to turn Bluetooth on, false to turn it off",
      },
    },
    required: ["enabled"],
  },
  handler: async ({ enabled }: { enabled: boolean }) => {
    try {
      getNativeApis().bluetooth.setEnabled(enabled);
      return {
        success: true,
        enabled,
        message: enabled ? "Bluetooth turned on" : "Bluetooth turned off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const getBluetoothStatusTool = defineTool("get_bluetooth_status", {
  description: "Check if Bluetooth is enabled on macOS.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const enabled = getNativeApis().bluetooth.isEnabled();
      return {
        success: true,
        enabled,
        message: enabled ? "Bluetooth is on" : "Bluetooth is off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const toggleBluetoothTool = defineTool("toggle_bluetooth", {
  description: "Toggle Bluetooth on or off on macOS (flips the current state).",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    try {
      const bt = getNativeApis().bluetooth;
      const newState = !bt.isEnabled();
      bt.setEnabled(newState);
      return {
        success: true,
        enabled: newState,
        message: newState ? "Bluetooth turned on" : "Bluetooth turned off"
      };
    } catch (error: any) {
      return { success: false, error: `Bluetooth error: ${error.message}` };
    }
  },
});

const listBluetoothDevicesTool = defineTool("list_bluetooth_devices", {
  description: "List paired and connected Bluetooth devices on macOS.",
  parameters: {
    type: "object",
    properties: {
      connected_only: {
        type: "boolean",
        description: "If true, only show currently connected devices",
      },
    },
  },
  handler: async ({ connected_only }: { connected_only?: boolean }) => {
    try {
      const { stdout } = await execAsync("system_profiler SPBluetoothDataType -json", { timeout: 15000 });
      const data = JSON.parse(stdout);
      const btData = data?.SPBluetoothDataType?.[0] ?? {};

      const devices: Array<{ name: string; address: string; connected: boolean }> = [];

      const connected = btData.device_connected ?? btData.devices_connected ?? [];
      for (const entry of (Array.isArray(connected) ? connected : [])) {
        for (const [name, info] of Object.entries(entry as Record<string, any>)) {
          devices.push({
            name,
            address: (info as any).device_address ?? "unknown",
            connected: true,
          });
        }
      }

      if (!connected_only) {
        const notConnected = btData.device_not_connected ?? btData.devices_not_connected ?? [];
        for (const entry of (Array.isArray(notConnected) ? notConnected : [])) {
          for (const [name, info] of Object.entries(entry as Record<string, any>)) {
            devices.push({
              name,
              address: (info as any).device_address ?? "unknown",
              connected: false,
            });
          }
        }
      }

      const connectedCount = devices.filter(d => d.connected).length;
      return {
        success: true,
        devices,
        count: devices.length,
        connected_count: connectedCount,
        message: connected_only
          ? `Found ${devices.length} connected Bluetooth device(s)`
          : `Found ${devices.length} Bluetooth device(s) (${connectedCount} connected)`
      };
    } catch (error: any) {
      return { success: false, error: `Failed to list Bluetooth devices: ${error.message}` };
    }
  },
});

export const connectivityTools = [
  setWifiTool,
  getWifiStatusTool,
  toggleWifiTool,
  listWifiNetworksTool,
  setBluetoothTool,
  getBluetoothStatusTool,
  toggleBluetoothTool,
  listBluetoothDevicesTool,
];
