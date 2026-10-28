import { describe, expect, it } from "vitest";
import {
  resolveByUidOrName,
  resolveDevice,
  resolveSpeedChannel,
  summarizeChannelSettings,
  summarizeProfiles,
  summarizeStatus,
} from "../src/format.js";
import { CPU_UID, devices, HUB_UID, hubSettings, profiles, statuses } from "./fixtures.js";

const hub = devices[0]!;

describe("resolvers", () => {
  it("finds devices by uid, uid prefix or name", () => {
    expect(resolveDevice(devices, HUB_UID).name).toBe("Lian Li Uni SL-Infinity");
    expect(resolveDevice(devices, HUB_UID.slice(0, 8)).uid).toBe(HUB_UID);
    expect(resolveDevice(devices, "amd ryzen 7 9800x3d").uid).toBe(CPU_UID);
  });

  it("refuses ambiguous or unknown device names", () => {
    expect(() => resolveDevice(devices, "spd5118")).toThrow(/matches several devices/);
    expect(() => resolveDevice(devices, "nope")).toThrow(/No device matches "nope"/);
  });

  it("finds speed channels by name or label, never non-speed channels", () => {
    expect(resolveSpeedChannel(hub, "fan2")).toBe("fan2");
    expect(resolveSpeedChannel(hub, "intake")).toBe("fan1");
    expect(() => resolveSpeedChannel(hub, "rgb")).toThrow(/Available: fan1 \(Intake\), fan2/);
  });

  it("resolves profiles by uid or name", () => {
    expect(resolveByUidOrName(profiles, "p-cpu", "profile").name).toBe("CPU");
    expect(resolveByUidOrName(profiles, "cpu", "profile").uid).toBe("p-cpu");
    expect(() => resolveByUidOrName(profiles, "GPU", "profile")).toThrow(/No profile matches/);
  });
});

describe("summaries", () => {
  it("condenses status with labels and rounding", () => {
    expect(summarizeStatus(devices, statuses)).toEqual([
      {
        uid: HUB_UID,
        name: "Lian Li Uni SL-Infinity",
        type: "Liquidctl",
        timestamp: "2026-10-28T14:00:00Z",
        channels: { fan1: { label: "Intake", rpm: 465, duty: 8 }, fan2: { rpm: 0 } },
      },
      {
        uid: CPU_UID,
        name: "AMD Ryzen 7 9800X3D",
        type: "CPU",
        timestamp: "2026-10-28T14:00:00Z",
        temps_c: { "CPU Temp Tctl": 62.1 },
        channels: { power0: { watts: 44.7 }, "CPU Freq Max": { mhz: 5234 } },
      },
    ]);
  });

  it("filters status to one channel", () => {
    const out = summarizeStatus(devices, statuses.slice(0, 1), "fan1");
    expect(out).toEqual([expect.objectContaining({ channels: { fan1: expect.any(Object) } })]);
  });

  it("names profile temp sources and curves", () => {
    expect(summarizeProfiles(profiles, devices)[1]).toEqual({
      uid: "p-cpu",
      name: "CPU",
      type: "Graph",
      temp_source: "AMD Ryzen 7 9800X3D / CPU Temp Tctl",
      curve: [
        { temp_c: 70, duty: 40 },
        { temp_c: 100, duty: 100 },
      ],
      function_uid: "0",
    });
  });

  it("describes channel settings with profile names", () => {
    expect(summarizeChannelSettings(hub, hubSettings, profiles).channels).toEqual([
      { channel: "fan1", label: "Intake", mode: "profile", profile: "CPU", profile_uid: "p-cpu" },
      { channel: "fan2", mode: "default" },
    ]);
  });
});
