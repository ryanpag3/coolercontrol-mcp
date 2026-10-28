import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoolerControlClient } from "../client.js";
import { resolveByUidOrName, resolveDevice, summarizeProfiles } from "../format.js";
import type { Device, Profile } from "../types.js";
import { json } from "./result.js";

const DEFAULT_PROFILE_UID = "0";
const DEFAULT_FUNCTION_UID = "0";

const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const profileFields = {
  speed_fixed: z.number().int().min(0).max(100).optional().describe("Fixed: duty %"),
  curve: z
    .array(z.object({ temp_c: z.number(), duty: z.number().int().min(0).max(100) }))
    .min(2)
    .optional()
    .describe("Graph: temperature → duty points (sorted for you; temps must be unique)"),
  temp_source: z
    .object({
      device: z.string().describe("Device uid, uid prefix or name"),
      sensor: z.string().describe("Sensor name (e.g. temp1) or label (e.g. CPU Temp Tctl)"),
    })
    .optional()
    .describe("Graph: the temperature the curve follows"),
  members: z
    .array(z.string())
    .optional()
    .describe("Mix: member profiles; Overlay: exactly one base profile (uids or names)"),
  mix_function: z.enum(["Min", "Max", "Avg", "Diff", "Sum"]).optional().describe("Mix: how members combine"),
  offset: z
    .array(z.object({ duty: z.number().int().min(0).max(100), offset: z.number().int().min(-100).max(100) }))
    .min(1)
    .optional()
    .describe("Overlay: duty → offset points applied to the base profile; one point is a static offset"),
  function: z.string().optional().describe("Function uid or name (see list_functions); default: Default Function"),
};

type ProfileFields = {
  [K in keyof typeof profileFields]?: z.infer<(typeof profileFields)[K]>;
};

interface Ctx {
  devices: Device[];
  profiles: Profile[];
  functionsByRef: (ref: string) => string;
}

/** Builds a complete, valid Profile from the fields given, on top of `base` for updates. */
function buildProfile(
  uid: string,
  name: string,
  type: Profile["p_type"],
  f: ProfileFields,
  ctx: Ctx,
  base?: Profile,
): Profile {
  const function_uid = f.function ? ctx.functionsByRef(f.function) : base?.function_uid ?? DEFAULT_FUNCTION_UID;
  const common = { uid, name, function_uid };
  const sameType = base?.p_type === type;
  const memberUids = () => {
    if (!f.members) return sameType ? base?.member_profile_uids ?? [] : [];
    return f.members.map((m) => {
      const p = resolveByUidOrName(ctx.profiles, m, "profile");
      if (p.uid === uid) throw new Error("A profile cannot include itself as a member.");
      return p.uid;
    });
  };

  switch (type) {
    case "Fixed": {
      const speed = f.speed_fixed ?? (sameType ? base?.speed_fixed : undefined);
      if (speed == null) throw new Error("A Fixed profile needs speed_fixed.");
      return { ...common, p_type: "Fixed", speed_fixed: speed };
    }
    case "Graph": {
      let source = sameType ? base?.temp_source ?? undefined : undefined;
      let srcDevice: Device | undefined;
      if (f.temp_source) {
        srcDevice = resolveDevice(ctx.devices, f.temp_source.device);
        source = { device_uid: srcDevice.uid, temp_name: resolveSensor(srcDevice, f.temp_source.sensor) };
      } else if (source) {
        srcDevice = ctx.devices.find((d) => d.uid === source!.device_uid);
      }
      if (!source) throw new Error("A Graph profile needs temp_source.");

      let points: [number, number][] | undefined = f.curve
        ? f.curve.map((p) => [p.temp_c, p.duty])
        : sameType
          ? base?.speed_profile ?? undefined
          : undefined;
      if (!points || points.length < 2) throw new Error("A Graph profile needs a curve of at least 2 points.");
      points = [...points].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < points.length; i++) {
        if (points[i]![0] === points[i - 1]![0]) {
          throw new Error(`Curve has two points at ${points[i]![0]}°C; temperatures must be unique.`);
        }
      }
      const lo = srcDevice?.info?.temp_min;
      const hi = srcDevice?.info?.temp_max;
      if (lo != null && hi != null) {
        const out = points.find(([t]) => t < lo || t > hi);
        if (out) throw new Error(`Curve point ${out[0]}°C is outside ${srcDevice!.name}'s range ${lo}-${hi}°C.`);
      }
      return {
        ...common,
        p_type: "Graph",
        speed_profile: points,
        temp_source: source,
        // UI chart bounds only; keep the user's if they set them.
        temp_min: sameType ? base?.temp_min ?? null : null,
        temp_max: sameType ? base?.temp_max ?? null : null,
      };
    }
    case "Mix": {
      const members = memberUids();
      const mix = f.mix_function ?? (sameType ? base?.mix_function_type : undefined);
      if (members.length === 0) throw new Error("A Mix profile needs at least one member.");
      if (!mix) throw new Error("A Mix profile needs mix_function.");
      return { ...common, p_type: "Mix", member_profile_uids: members, mix_function_type: mix };
    }
    case "Overlay": {
      const members = memberUids();
      if (members.length !== 1) throw new Error("An Overlay profile needs exactly one member (its base profile).");
      const offset: [number, number][] | undefined = f.offset
        ? f.offset.map((o) => [o.duty, o.offset])
        : sameType
          ? base?.offset_profile ?? undefined
          : undefined;
      if (!offset?.length) throw new Error("An Overlay profile needs offset points.");
      return {
        ...common,
        p_type: "Overlay",
        member_profile_uids: members,
        offset_profile: [...offset].sort((a, b) => a[0] - b[0]),
      };
    }
    default:
      throw new Error(`Unsupported profile type ${type}.`);
  }
}

function resolveSensor(device: Device, ref: string): string {
  const temps = Object.entries(device.info?.temps ?? {});
  const needle = ref.trim().toLowerCase();
  const match =
    temps.find(([name]) => name === ref) ??
    temps.find(([name]) => name.toLowerCase() === needle) ??
    temps.find(([, t]) => t.label?.toLowerCase() === needle);
  if (match) return match[0];
  const known = temps.map(([n, t]) => (t.label && t.label !== n ? `${n} (${t.label})` : n)).join(", ");
  throw new Error(`${device.name} has no temperature sensor "${ref}". Available: ${known || "none"}`);
}

/** Every place a profile is referenced: channels, Mix/Overlay members, saved modes. */
export async function profileUsage(client: CoolerControlClient, uid: string, devices: Device[], profiles: Profile[]) {
  const channels: string[] = [];
  for (const d of devices) {
    if (!Object.values(d.info?.channels ?? {}).some((c) => c.speed_options)) continue;
    for (const s of await client.channelSettings(d.uid)) {
      if (s.profile_uid === uid) channels.push(`${d.name} ${s.channel_name}`);
    }
  }
  const parents = profiles.filter((p) => p.member_profile_uids?.includes(uid)).map((p) => p.name);
  const modes = (await client.modes())
    .filter((m) => m.device_settings?.some(([, settings]) => settings.some((s) => s.profile_uid === uid)))
    .map((m) => m.name);
  return { channels, member_of: parents, modes };
}

export function registerProfileTools(server: McpServer, client: CoolerControlClient): void {
  async function context(): Promise<Ctx> {
    const [devices, profiles, functions] = await Promise.all([
      client.devices(),
      client.profiles(),
      client.functions(),
    ]);
    return {
      devices,
      profiles,
      functionsByRef: (ref) => resolveByUidOrName(functions, ref, "function").uid,
    };
  }

  server.registerTool(
    "create_profile",
    {
      title: "Create fan profile",
      description:
        "Create a fan profile. Fixed: a constant duty. Graph: a temperature→duty curve following one sensor. " +
        "Mix: combines member profiles (Min/Max/Avg/Diff/Sum). Overlay: offsets one base profile. " +
        "Assign it to a channel afterwards with apply_profile.",
      inputSchema: {
        name: z.string().min(1),
        type: z.enum(["Fixed", "Graph", "Mix", "Overlay"]),
        ...profileFields,
      },
      annotations,
    },
    async ({ name, type, ...fields }) => {
      const ctx = await context();
      if (ctx.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`A profile named "${name}" already exists; use update_profile or pick another name.`);
      }
      const profile = buildProfile(randomUUID(), name, type, fields, ctx);
      await client.createProfile(profile);
      return json({ ok: true, created: summarizeProfiles([...ctx.profiles, profile], ctx.devices).at(-1) });
    },
  );

  server.registerTool(
    "update_profile",
    {
      title: "Update fan profile",
      description:
        "Change an existing profile. Only the fields given change; a new curve or offset replaces the old one. " +
        "Changing type requires the new type's fields. Channels using the profile pick up the change immediately.",
      inputSchema: {
        profile: z.string().describe("Profile uid or exact name"),
        name: z.string().min(1).optional().describe("New name"),
        type: z.enum(["Fixed", "Graph", "Mix", "Overlay"]).optional(),
        ...profileFields,
      },
      annotations: { ...annotations, idempotentHint: true },
    },
    async ({ profile, name, type, ...fields }) => {
      const ctx = await context();
      const existing = resolveByUidOrName(ctx.profiles, profile, "profile");
      if (existing.uid === DEFAULT_PROFILE_UID) throw new Error("The built-in Unmanaged profile cannot be changed.");
      const updated = buildProfile(
        existing.uid,
        name ?? existing.name,
        type ?? existing.p_type,
        fields,
        ctx,
        existing,
      );
      await client.updateProfile(updated);
      // Summarize alongside every profile so member uids resolve to names.
      const all = summarizeProfiles([...ctx.profiles, existing, updated], ctx.devices);
      return json({ ok: true, before: all.at(-2), after: all.at(-1) });
    },
  );

  server.registerTool(
    "delete_profile",
    {
      title: "Delete fan profile",
      description:
        "Delete a profile. Refuses if any channel, Mix/Overlay profile or mode uses it, listing where, unless " +
        "force is true; with force, channels using it fall back to their default and modes drop it.",
      inputSchema: {
        profile: z.string().describe("Profile uid or exact name"),
        force: z.boolean().optional().describe("Delete even if in use"),
      },
      annotations: { ...annotations, destructiveHint: true },
    },
    async ({ profile, force }) => {
      const [devices, profiles] = await Promise.all([client.devices(), client.profiles()]);
      const p = resolveByUidOrName(profiles, profile, "profile");
      if (p.uid === DEFAULT_PROFILE_UID) throw new Error("The built-in Unmanaged profile cannot be deleted.");
      const usage = await profileUsage(client, p.uid, devices, profiles);
      const inUse = usage.channels.length + usage.member_of.length + usage.modes.length > 0;
      if (inUse && !force) {
        throw new Error(
          `Profile "${p.name}" is in use: ${JSON.stringify(usage)}. ` +
            "Reassign those first, or pass force: true (channels then fall back to their default).",
        );
      }
      await client.deleteProfile(p.uid);
      return json({ ok: true, deleted: summarizeProfiles(profiles, devices).find((x) => x.uid === p.uid), was_used_by: usage });
    },
  );
}
