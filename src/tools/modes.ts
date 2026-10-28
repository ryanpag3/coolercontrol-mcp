import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoolerControlClient } from "../client.js";
import { resolveByUidOrName } from "../format.js";
import type { Device, Mode, Profile } from "../types.js";
import { json } from "./result.js";

const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const modeArg = z.string().describe("Mode uid or exact name");

/** A mode's saved settings with device and profile names filled in. */
function describeMode(mode: Mode, devices: Device[], profiles: Profile[]) {
  const deviceName = new Map(devices.map((d) => [d.uid, d.name]));
  const profileName = new Map(profiles.map((p) => [p.uid, p.name]));
  return {
    uid: mode.uid,
    name: mode.name,
    devices: (mode.device_settings ?? []).map(([uid, settings]) => ({
      device: deviceName.get(uid) ?? uid,
      uid,
      channels: settings.map((s) => {
        const { channel_name, profile_uid, speed_fixed, ...rest } = s;
        return {
          channel: channel_name,
          ...(profile_uid ? { profile: profileName.get(profile_uid) ?? profile_uid } : {}),
          ...(speed_fixed != null ? { duty: speed_fixed } : {}),
          ...rest,
        };
      }),
    })),
  };
}

export function registerModeTools(server: McpServer, client: CoolerControlClient): void {
  const resolve = async (ref: string) => resolveByUidOrName(await client.modes(), ref, "mode");

  server.registerTool(
    "get_mode",
    {
      title: "Get mode",
      description: "The channel settings saved in a mode, with device and profile names.",
      inputSchema: { mode: modeArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ mode }) => {
      const m = await resolve(mode);
      const [full, devices, profiles] = await Promise.all([
        client.mode(m.uid),
        client.devices(),
        client.profiles(),
      ]);
      return json(describeMode(full, devices, profiles));
    },
  );

  server.registerTool(
    "create_mode",
    {
      title: "Create mode",
      description:
        "Save the current settings of every channel as a new mode, which activate_mode can restore later.",
      inputSchema: { name: z.string().min(1) },
      annotations,
    },
    async ({ name }) => {
      const modes = await client.modes();
      if (modes.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`A mode named "${name}" already exists; use update_mode to re-save it.`);
      }
      const created = await client.createMode(name);
      return json({ ok: true, mode: { uid: created.uid, name: created.name } });
    },
  );

  server.registerTool(
    "update_mode",
    {
      title: "Update mode",
      description:
        "Rename a mode and/or overwrite its saved settings with the current channel settings.",
      inputSchema: {
        mode: modeArg,
        name: z.string().min(1).optional().describe("New name"),
        save_current_settings: z
          .boolean()
          .optional()
          .describe("Replace the mode's saved settings with what is applied right now"),
      },
      annotations: { ...annotations, idempotentHint: true },
    },
    async ({ mode, name, save_current_settings }) => {
      if (!name && !save_current_settings) throw new Error("Give a new name and/or save_current_settings: true.");
      const m = await resolve(mode);
      if (name && name !== m.name) await client.renameMode(m.uid, name);
      if (save_current_settings) await client.updateModeSettings(m.uid);
      return json({ ok: true, mode: { uid: m.uid, name: name ?? m.name }, saved_current_settings: !!save_current_settings });
    },
  );

  server.registerTool(
    "duplicate_mode",
    {
      title: "Duplicate mode",
      description: "Copy a mode, including its saved settings.",
      inputSchema: { mode: modeArg },
      annotations,
    },
    async ({ mode }) => {
      const copy = await client.duplicateMode((await resolve(mode)).uid);
      return json({ ok: true, mode: { uid: copy.uid, name: copy.name } });
    },
  );

  server.registerTool(
    "delete_mode",
    {
      title: "Delete mode",
      description: "Delete a saved mode. Channel settings currently applied are not changed.",
      inputSchema: { mode: modeArg },
      annotations: { ...annotations, destructiveHint: true },
    },
    async ({ mode }) => {
      const m = await resolve(mode);
      await client.deleteMode(m.uid);
      return json({ ok: true, deleted: { uid: m.uid, name: m.name } });
    },
  );
}
