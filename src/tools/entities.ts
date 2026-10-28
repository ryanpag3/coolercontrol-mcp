import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoolerControlClient } from "../client.js";
import type { Alert, CustomSensor, Fn, Profile } from "../types.js";
import { json } from "./result.js";

// Functions, alerts and custom sensors have large schemas that grow between
// CoolerControl releases, so these tools take the daemon's own field names
// rather than re-modelling every field. Updates fetch the current object and
// merge the changes in, so a partial edit never drops the other fields.

type Item = Record<string, unknown>;

interface EntitySpec<T extends Item> {
  kind: string;
  /** Name of the identifying field: `uid`, or `id` for custom sensors. */
  idField: "uid" | "id";
  /** Whether the client must generate the id (uids) or the caller names it (custom sensor ids). */
  generateId: boolean;
  list: () => Promise<T[]>;
  create: (item: T) => Promise<void>;
  update: (item: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Defaults merged under the caller's fields on create. */
  defaults?: () => Promise<Item>;
  /** Where the item is referenced; non-empty blocks delete unless forced. */
  usage?: (item: T) => Promise<string[]>;
  fieldsHelp: string;
  protectedIds?: string[];
}

function registerEntity<T extends Item>(server: McpServer, spec: EntitySpec<T>): void {
  const { kind, idField } = spec;
  const nameOf = (i: T) => String(i.name ?? i[idField]);

  async function resolve(ref: string): Promise<T> {
    const items = await spec.list();
    const exact = items.find((i) => i[idField] === ref);
    if (exact) return exact;
    const needle = ref.trim().toLowerCase();
    const matches = items.filter((i) => typeof i.name === "string" && i.name.toLowerCase() === needle);
    if (matches.length === 1) return matches[0]!;
    const list = items.map((i) => `${nameOf(i)} (${String(i[idField])})`).join(", ") || "none";
    if (matches.length > 1) throw new Error(`"${ref}" matches several ${kind}s. Use the ${idField}: ${list}`);
    throw new Error(`No ${kind} matches "${ref}". Known ${kind}s: ${list}`);
  }

  const fields = z.record(z.string(), z.unknown());
  const ref = z.string().describe(`${kind} ${idField} or exact name`);
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  server.registerTool(
    `create_${kind}`,
    {
      title: `Create ${kind}`,
      description: `Create a ${kind.replace("_", " ")}. ${spec.fieldsHelp}`,
      inputSchema: { fields: fields.describe("Fields using the daemon's names, as returned by the list tool") },
      annotations: write,
    },
    async ({ fields }) => {
      const base = spec.defaults ? await spec.defaults() : {};
      const item = { ...base, ...fields } as T;
      if (spec.generateId) (item as Item)[idField] = randomUUID();
      else if (typeof item[idField] !== "string" || !item[idField]) {
        throw new Error(`fields.${idField} is required for a ${kind}.`);
      }
      await spec.create(item);
      return json({ ok: true, created: item });
    },
  );

  server.registerTool(
    `update_${kind}`,
    {
      title: `Update ${kind}`,
      description: `Change fields of an existing ${kind.replace("_", " ")}; fields not given keep their values.`,
      inputSchema: { [kind]: ref, changes: fields.describe("Fields to change") },
      annotations: { ...write, idempotentHint: true },
    },
    async (args: Record<string, unknown>) => {
      const existing = await resolve(String(args[kind]));
      const id = String(existing[idField]);
      if (spec.protectedIds?.includes(id)) throw new Error(`The built-in ${kind} ${nameOf(existing)} cannot be changed.`);
      const updated = { ...existing, ...(args.changes as Item), [idField]: id } as T;
      await spec.update(updated);
      return json({ ok: true, before: existing, after: updated });
    },
  );

  server.registerTool(
    `delete_${kind}`,
    {
      title: `Delete ${kind}`,
      description: `Delete a ${kind.replace("_", " ")}.` + (spec.usage ? " Refuses if it is in use unless force is true." : ""),
      inputSchema: {
        [kind]: ref,
        ...(spec.usage ? { force: z.boolean().optional().describe("Delete even if in use") } : {}),
      },
      annotations: { ...write, destructiveHint: true },
    },
    async (args: Record<string, unknown>) => {
      const existing = await resolve(String(args[kind]));
      const id = String(existing[idField]);
      if (spec.protectedIds?.includes(id)) throw new Error(`The built-in ${kind} ${nameOf(existing)} cannot be deleted.`);
      const usedBy = spec.usage ? await spec.usage(existing) : [];
      if (usedBy.length && !args.force) {
        throw new Error(`${kind} "${nameOf(existing)}" is used by: ${usedBy.join(", ")}. Pass force: true to delete anyway.`);
      }
      await spec.remove(id);
      return json({ ok: true, deleted: existing, was_used_by: usedBy });
    },
  );
}

export function registerEntityTools(server: McpServer, client: CoolerControlClient): void {
  registerEntity<Fn>(server, {
    kind: "function",
    idField: "uid",
    generateId: true,
    list: () => client.functions(),
    create: (f) => client.createFunction(f),
    update: (f) => client.updateFunction(f),
    remove: (uid) => client.deleteFunction(uid),
    protectedIds: ["0"],
    // Start from the built-in Default Function so required fields are present.
    defaults: async () => {
      const { uid: _uid, name: _name, ...rest } =
        (await client.functions()).find((f) => f.uid === "0") ?? ({} as Fn);
      return rest;
    },
    usage: async (f) =>
      (await client.profiles()).filter((p: Profile) => p.function_uid === f.uid).map((p) => `profile ${p.name}`),
    fieldsHelp:
      "Required: name. Unset fields copy the Default Function. Common fields: f_type (Identity | Standard), " +
      "duty_minimum / duty_maximum (step size per change, %), step_size_min_decreasing / step_size_max_decreasing, " +
      "threshold_hopping, bypass_min_at_extremes; Standard also takes deviance, response_delay, only_downward.",
  });

  registerEntity<Alert>(server, {
    kind: "alert",
    idField: "uid",
    generateId: true,
    list: async () => (await client.alerts()).alerts,
    create: (a) => client.createAlert(a),
    update: (a) => client.updateAlert(a),
    remove: (uid) => client.deleteAlert(uid),
    fieldsHelp:
      "Required: name, min, max, warmup_duration (s), channel_sources: [{device_uid, channel_name, channel_metric}] " +
      "where channel_metric is Temp | Duty | Load | RPM | Freq (all sources share one metric; channel_name is the " +
      "sensor/channel name, e.g. temp1 or fan1). Optional: cooldown_duration, repeat_interval, enabled, " +
      "desktop_notify, desktop_notify_audio, desktop_notify_recovery, shutdown_on_activation.",
  });

  registerEntity<CustomSensor>(server, {
    kind: "custom_sensor",
    idField: "id",
    generateId: false,
    list: () => client.customSensors(),
    create: (s) => client.createCustomSensor(s),
    update: (s) => client.updateCustomSensor(s),
    remove: (id) => client.deleteCustomSensor(id),
    usage: async (s) => {
      // Custom sensors are exposed as temps of the single "CustomSensors" device.
      const [devices, profiles] = await Promise.all([client.devices(), client.profiles()]);
      const csDevice = devices.find((d) => d.type === "CustomSensors")?.uid;
      const used = profiles
        .filter((p) => p.temp_source?.temp_name === s.id && p.temp_source.device_uid === csDevice)
        .map((p) => `profile ${p.name}`);
      const parents = Array.isArray(s.parents) ? s.parents.map((p) => `custom sensor ${String(p)}`) : [];
      return [...used, ...parents];
    },
    fieldsHelp:
      "Required: id (unique; becomes the sensor's name) and cs_type. cs_type Mix: mix_function " +
      "(Min | Max | Delta | Avg | WeightedAvg | Sum) and sources: [{temp_source: {device_uid, temp_name}, weight}]. " +
      "File: file_path. Offset: offset, optional scale, one source. TimeAverage / ExponentialMovingAvg: " +
      "time_window_seconds (1-300), one source. Optional metric (Temp default; Duty | Load | RPM | Freq use " +
      "channel_source instead of temp_source in sources).",
  });
}
