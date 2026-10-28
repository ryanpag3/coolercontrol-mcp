// Small hand-written payloads shaped like CoolerControl 5.1 responses.
import type { ChannelSetting, Device, DeviceStatus, Profile } from "../src/types.js";

export const HUB_UID = "c6d76dc72d383065b8f9126461927f904ea2c08dd869ebec3489b245dfbd64de";
export const CPU_UID = "3145e1a42801faf9cf948df8c705afb4859f084c10a7e7c5e4efecb1e0167127";
export const DIMM_A = "a2e99a9eb08cd6128353bbefd0ae69612316575ce4d4edf774b7f0e66cf10f97";
export const DIMM_B = "1a1f27e4c9a6f31abd2493cf107df416caa9c9605d453cc9e83e4d32cf7572b1";

const speed = { min_duty: 0, max_duty: 100, fixed_enabled: true };

export const devices: Device[] = [
  {
    uid: HUB_UID,
    name: "Lian Li Uni SL-Infinity",
    type: "Liquidctl",
    info: {
      channels: {
        fan1: { label: "Intake", speed_options: speed },
        fan2: { label: null, speed_options: speed },
        rgb: { label: null, speed_options: null },
      },
      temps: {},
    },
  },
  {
    uid: CPU_UID,
    name: "AMD Ryzen 7 9800X3D",
    type: "CPU",
    info: { channels: {}, temps: { temp1: { label: "CPU Temp Tctl" } } },
  },
  { uid: DIMM_A, name: "spd5118", type: "Hwmon", info: { temps: { temp1: { label: "Temp1" } } } },
  { uid: DIMM_B, name: "spd5118", type: "Hwmon", info: { temps: { temp1: { label: "Temp1" } } } },
];

export const statuses: DeviceStatus[] = [
  {
    uid: HUB_UID,
    type: "Liquidctl",
    status_history: [
      {
        timestamp: "2026-10-28T14:00:00Z",
        channels: [
          { name: "fan1", rpm: 465, duty: 8.0 },
          { name: "fan2", rpm: 0 },
        ],
      },
    ],
  },
  {
    uid: CPU_UID,
    type: "CPU",
    status_history: [
      {
        timestamp: "2026-10-28T14:00:00Z",
        temps: [{ name: "temp1", temp: 62.125 }],
        channels: [{ name: "power0", watts: 44.70583 }, { name: "CPU Freq Max", freq: 5234 }],
      },
    ],
  },
];

export const profiles: Profile[] = [
  { uid: "0", name: "Unmanaged", p_type: "Default", function_uid: "0" },
  {
    uid: "p-cpu",
    name: "CPU",
    p_type: "Graph",
    function_uid: "0",
    speed_profile: [
      [70, 40],
      [100, 100],
    ],
    temp_source: { temp_name: "temp1", device_uid: CPU_UID },
  },
];

export const hubSettings: ChannelSetting[] = [{ channel_name: "fan1", profile_uid: "p-cpu" }];
