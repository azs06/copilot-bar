import { createRequire } from "node:module";

// Native macOS APIs via koffi (FFI) — lazy-loaded on first use
// Replaces osascript/blueutil with direct framework calls for speed and zero dependencies
export interface NativeMacApis {
  brightness: { get: () => number; set: (level: number) => void };
  volume: { get: () => number; set: (level: number) => void; getMute: () => boolean; setMute: (mute: boolean) => void };
  bluetooth: { isEnabled: () => boolean; setEnabled: (enabled: boolean) => void };
  screen: { getWidth: () => number; getHeight: () => number };
}

let _nativeApis: NativeMacApis | null = null;

export function getNativeApis(): NativeMacApis {
  if (!_nativeApis) {
    const _require = createRequire(import.meta.url);
    const koffi = _require("koffi");

    // --- CoreGraphics + DisplayServices (brightness & screen) ---
    const CG = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
    const DS = koffi.load("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices");
    const CGMainDisplayID = CG.func("uint32_t CGMainDisplayID()");
    const CGDisplayPixelsWide = CG.func("size_t CGDisplayPixelsWide(uint32_t)");
    const CGDisplayPixelsHigh = CG.func("size_t CGDisplayPixelsHigh(uint32_t)");
    const DSGetBrightness = DS.func("int DisplayServicesGetBrightness(uint32_t, _Out_ float*)");
    const DSSetBrightness = DS.func("int DisplayServicesSetBrightness(uint32_t, float)");
    const displayID = CGMainDisplayID();

    // --- CoreAudio (volume & mute) ---
    const CA = koffi.load("/System/Library/Frameworks/CoreAudio.framework/CoreAudio");
    koffi.struct("AudioObjectPropertyAddress", {
      mSelector: "uint32",
      mScope: "uint32",
      mElement: "uint32",
    });
    const AOGetU32 = CA.func("int AudioObjectGetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, _Inout_ uint32*, _Out_ uint32*)");
    const AOGetF32 = CA.func("int AudioObjectGetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, _Inout_ uint32*, _Out_ float*)");
    const AOSetF32 = CA.func("int AudioObjectSetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, uint32, float*)");
    const AOSetU32 = CA.func("int AudioObjectSetPropertyData(uint32, AudioObjectPropertyAddress*, uint32, void*, uint32, uint32*)");
    // FourCC constants
    const SYS = 1; // kAudioObjectSystemObject
    const SCOPE_GLOBAL = 0x676C6F62; // 'glob'
    const SCOPE_OUTPUT = 0x6F757470; // 'outp'
    const SEL_DEFAULT_OUT = 0x644F7574; // 'dOut' — kAudioHardwarePropertyDefaultOutputDevice
    const SEL_VOLUME = 0x766F6C6D; // 'volm' — kAudioDevicePropertyVolumeScalar
    const SEL_MUTE = 0x6D757465; // 'mute' — kAudioDevicePropertyMute

    function getOutputDevice(): number {
      const size = [4], id = [0];
      const r = AOGetU32(SYS, { mSelector: SEL_DEFAULT_OUT, mScope: SCOPE_GLOBAL, mElement: 0 }, 0, null, size, id);
      if (r !== 0) throw new Error(`Failed to get default output device (${r})`);
      return id[0];
    }

    // --- IOBluetooth (power on/off) ---
    const BT = koffi.load("/System/Library/Frameworks/IOBluetooth.framework/IOBluetooth");
    const BTGetPower = BT.func("int IOBluetoothPreferenceGetControllerPowerState()");
    const BTSetPower = BT.func("void IOBluetoothPreferenceSetControllerPowerState(int)");

    _nativeApis = {
      brightness: {
        get: () => {
          const out = [0];
          const r = DSGetBrightness(displayID, out);
          if (r !== 0) throw new Error(`DisplayServicesGetBrightness failed (${r})`);
          return out[0];
        },
        set: (level: number) => {
          const r = DSSetBrightness(displayID, Math.max(0, Math.min(1, level)));
          if (r !== 0) throw new Error(`DisplayServicesSetBrightness failed (${r})`);
        },
      },
      volume: {
        get: () => {
          const dev = getOutputDevice();
          const size = [4], vol = [0.0];
          const r = AOGetF32(dev, { mSelector: SEL_VOLUME, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, size, vol);
          if (r !== 0) throw new Error(`CoreAudio get volume failed (${r})`);
          return vol[0];
        },
        set: (level: number) => {
          const dev = getOutputDevice();
          const r = AOSetF32(dev, { mSelector: SEL_VOLUME, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, 4, [Math.max(0, Math.min(1, level))]);
          if (r !== 0) throw new Error(`CoreAudio set volume failed (${r})`);
        },
        getMute: () => {
          const dev = getOutputDevice();
          const size = [4], m = [0];
          const r = AOGetU32(dev, { mSelector: SEL_MUTE, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, size, m);
          if (r !== 0) throw new Error(`CoreAudio get mute failed (${r})`);
          return m[0] === 1;
        },
        setMute: (mute: boolean) => {
          const dev = getOutputDevice();
          const r = AOSetU32(dev, { mSelector: SEL_MUTE, mScope: SCOPE_OUTPUT, mElement: 0 }, 0, null, 4, [mute ? 1 : 0]);
          if (r !== 0) throw new Error(`CoreAudio set mute failed (${r})`);
        },
      },
      bluetooth: {
        isEnabled: () => BTGetPower() === 1,
        setEnabled: (enabled: boolean) => BTSetPower(enabled ? 1 : 0),
      },
      screen: {
        getWidth: () => Number(CGDisplayPixelsWide(displayID)),
        getHeight: () => Number(CGDisplayPixelsHigh(displayID)),
      },
    };
  }
  return _nativeApis;
}
