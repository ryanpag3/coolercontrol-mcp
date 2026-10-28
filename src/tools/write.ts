import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoolerControlClient } from "../client.js";
import {
  resolveByUidOrName,
  resolveDevice,
  resolveSpeedChannel,
  summarizeChannelSettings,
} from "../format.js";
import type { Device } from "../types.js";
import { json } from "./result.js";

// These change real hardware behaviour. The daemon refuses them (403) when the
// token is read-only, which the client reports as a clear error.
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const deviceArg = z
  .string()
  .describe("Device uid, uid prefix (8+ chars) or exact device name, as shown by list_devices");
const channelArg = z.string().describe("Speed channel name (e.g. fan1) or its label");

export function registerWriteTools(
  server: McpServer,
  client: CoolerControlClient,
  opts: { minDuty: number },
): void {
  /** Resolve the target and capture its current setting so the caller can revert. */
  async function target(deviceRef: string, channelRef: string) {
    const [devices, profiles] = await Promise.all([client.devices(), client.profiles()]);
    const device = resolveDevice(devices, deviceRef);
    const channel = resolveSpeedChannel(device, channelRef);
    const previous = summarizeChannelSettings(
      device,
      await client.channelSettings(device.uid),
      profiles,
    ).channels.find((c) => c.channel === channel);
    return { device, channel, profiles, previous };
  }

  server.registerTool(
    "set_fixed_speed",
    {
      title: "Set fixed fan speed",
      description:
        `Set a fan/pump channel to a fixed duty %. Values below ${opts.minDuty}% are refused ` +
        "(COOLERCONTROL_MIN_DUTY). Returns the previous setting so it can be restored.",
      inputSchema: {
        device: deviceArg,
        channel: channelArg,
        duty: z.number().int().min(0).max(100).describe("Duty cycle in percent"),
      },
      annotations: write,
    },
    async ({ device, channel, duty }) => {
      const t = await target(device, channel);
      const opt = speedOptions(t.device, t.channel);
      if (!opt.fixed_enabled) {
        throw new Error(`${t.device.name} ${t.channel} does not support fixed speeds; use a profile.`);
      }
      const floor = Math.max(opts.minDuty, opt.min_duty);
      if (duty < floor || duty > opt.max_duty) {
        throw new Error(
          `Duty ${duty}% is outside the allowed range ${floor}-${opt.max_duty}% for ${t.device.name} ${t.channel}` +
            (floor === opts.minDuty && opts.minDuty > opt.min_duty
              ? ` (floor set by COOLERCONTROL_MIN_DUTY=${opts.minDuty}).`
              : "."),
        );
      }
      await client.setFixedSpeed(t.device.uid, t.channel, duty);
      return json({ ok: true, device: t.device.name, channel: t.channel, duty, previous: t.previous });
    },
  );

  server.registerTool(
    "apply_profile",
    {
      title: "Apply fan profile",
      description:
        "Assign an existing profile (see list_profiles) to a fan/pump channel. Returns the previous setting.",
      inputSchema: {
        device: deviceArg,
        channel: channelArg,
        profile: z.string().describe("Profile uid or exact name"),
      },
      annotations: write,
    },
    async ({ device, channel, profile }) => {
      const t = await target(device, channel);
      const p = resolveByUidOrName(t.profiles, profile, "profile");
      await client.applyProfile(t.device.uid, t.channel, p.uid);
      return json({
        ok: true,
        device: t.device.name,
        channel: t.channel,
        profile: p.name,
        previous: t.previous,
      });
    },
  );

  server.registerTool(
    "reset_channel",
    {
      title: "Reset fan channel",
      description:
        "Reset a fan/pump channel to its hardware default, removing any profile or fixed speed. " +
        "Returns the previous setting.",
      inputSchema: { device: deviceArg, channel: channelArg },
      annotations: write,
    },
    async ({ device, channel }) => {
      const t = await target(device, channel);
      await client.resetChannel(t.device.uid, t.channel);
      return json({ ok: true, device: t.device.name, channel: t.channel, previous: t.previous });
    },
  );

  server.registerTool(
    "activate_mode",
    {
      title: "Activate mode",
      description: "Activate a saved mode (see list_modes), applying all of its channel settings.",
      inputSchema: { mode: z.string().describe("Mode uid or exact name") },
      annotations: write,
    },
    async ({ mode }) => {
      const [modes, active] = await Promise.all([client.modes(), client.activeModes()]);
      const m = resolveByUidOrName(modes, mode, "mode");
      await client.activateMode(m.uid);
      const previous = modes.find((x) => x.uid === active.current_mode_uid)?.name ?? null;
      return json({ ok: true, mode: m.name, previous_mode: previous });
    },
  );
}

function speedOptions(device: Device, channel: string) {
  // resolveSpeedChannel guarantees the channel has speed options.
  return device.info!.channels![channel]!.speed_options!;
}
