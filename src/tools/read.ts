import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoolerControlClient } from "../client.js";
import {
  describeModes,
  resolveDevice,
  summarizeChannelSettings,
  summarizeDevices,
  summarizeProfiles,
  summarizeStatus,
} from "../format.js";
import { json } from "./result.js";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

const deviceArg = z
  .string()
  .describe("Device uid, uid prefix (8+ chars) or exact device name, as shown by list_devices");
const rawArg = z
  .boolean()
  .optional()
  .describe("Return the daemon's raw JSON instead of the condensed summary");

export function registerReadTools(server: McpServer, client: CoolerControlClient): void {
  server.registerTool(
    "get_health",
    {
      title: "Daemon health",
      description: "CoolerControl daemon health: version, uptime, warning/error counts.",
      annotations: readOnly,
    },
    async () => json(await client.health()),
  );

  server.registerTool(
    "list_devices",
    {
      title: "List devices",
      description:
        "List hardware CoolerControl knows about (CPU, GPUs, fan hubs, AIOs, PSUs, drives) with their " +
        "speed-controllable channels and temperature sensors. Use the uids and channel names here for other tools.",
      inputSchema: { raw: rawArg },
      annotations: readOnly,
    },
    async ({ raw }) => {
      const devices = await client.devices();
      return json(raw ? devices : summarizeDevices(devices));
    },
  );

  server.registerTool(
    "get_status",
    {
      title: "Current temperatures and fan speeds",
      description:
        "Latest sensor readings: temperatures (°C), fan rpm, duty (%), power (W) and frequencies (MHz). " +
        "Optionally limited to one device and channel.",
      inputSchema: {
        device: deviceArg.optional(),
        channel: z
          .string()
          .optional()
          .describe("Channel name to limit to (e.g. fan1); requires device"),
        raw: rawArg,
      },
      annotations: readOnly,
    },
    async ({ device, channel, raw }) => {
      if (channel && !device) throw new Error("channel requires device");
      const devices = await client.devices();
      const target = device ? resolveDevice(devices, device) : undefined;
      const statuses = await client.status(target?.uid);
      if (raw) return json(statuses);
      return json(summarizeStatus(devices, statuses, channel));
    },
  );

  server.registerTool(
    "get_channel_settings",
    {
      title: "Fan channel settings",
      description:
        "What each speed-controllable channel is set to: a profile (by name), a fixed duty, or the default. " +
        "Covers all devices unless one is given.",
      inputSchema: { device: deviceArg.optional() },
      annotations: readOnly,
    },
    async ({ device }) => {
      const [devices, profiles] = await Promise.all([client.devices(), client.profiles()]);
      const targets = device
        ? [resolveDevice(devices, device)]
        : devices.filter((d) => Object.values(d.info?.channels ?? {}).some((c) => c.speed_options));
      const result = [];
      // Sequential on purpose: the daemon limits concurrent connections per client.
      for (const d of targets) {
        result.push(summarizeChannelSettings(d, await client.channelSettings(d.uid), profiles));
      }
      return json(result);
    },
  );

  server.registerTool(
    "list_profiles",
    {
      title: "List fan profiles",
      description:
        "Fan profiles (fixed, graph curves temp→duty, mixes) with their temperature source.",
      inputSchema: { raw: rawArg },
      annotations: readOnly,
    },
    async ({ raw }) => {
      const profiles = await client.profiles();
      if (raw) return json(profiles);
      return json(summarizeProfiles(profiles, await client.devices()));
    },
  );

  server.registerTool(
    "list_functions",
    {
      title: "List profile functions",
      description:
        "Functions that shape how profiles apply duty changes (min/max duty, step sizes, hysteresis).",
      annotations: readOnly,
    },
    async () => json(await client.functions()),
  );

  server.registerTool(
    "list_modes",
    {
      title: "List modes",
      description: "Saved modes (snapshots of all channel settings) and which one is active.",
      annotations: readOnly,
    },
    async () => {
      const [modes, active] = await Promise.all([client.modes(), client.activeModes()]);
      return json(describeModes(modes, active));
    },
  );

  server.registerTool(
    "list_alerts",
    {
      title: "List alerts",
      description: "Configured alerts and the recent alert log.",
      annotations: readOnly,
    },
    async () => json(await client.alerts()),
  );

  server.registerTool(
    "list_custom_sensors",
    {
      title: "List custom sensors",
      description: "User-defined custom sensors (mixes of other temps, or file-based sensors).",
      annotations: readOnly,
    },
    async () => json(await client.customSensors()),
  );
}
