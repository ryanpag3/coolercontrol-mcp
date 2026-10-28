import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoolerControlClient, type FetchFn } from "../src/client.js";
import { buildServer } from "../src/server.js";
import { devices, HUB_UID, hubSettings, profiles, statuses } from "./fixtures.js";

type Route = { status?: number; body?: unknown };

/** An MCP client wired to the server, backed by a fake daemon keyed on "METHOD /path". */
async function connect(routes: Record<string, Route>, minDuty = 20) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init: { method: string }) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    calls.push(key);
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    return new Response(route.body === undefined ? "" : JSON.stringify(route.body), {
      status: route.status ?? 200,
    });
  });
  const cc = new CoolerControlClient({
    baseUrl: "http://cc",
    token: "cc_test",
    fetch: fetch as unknown as FetchFn,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(cc, { minDuty }).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return { client, calls, close: () => client.close() };
}

const base: Record<string, Route> = {
  "GET /devices": { body: { devices } },
  "GET /profiles": { body: { profiles } },
  "GET /status": { body: { devices: statuses } },
  [`GET /devices/${HUB_UID}/settings`]: { body: { settings: hubSettings } },
};

const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[])[0]!.text;

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

describe("MCP server", () => {
  it("registers read and write tools", async () => {
    const s = await connect(base);
    close = s.close;
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "activate_mode",
      "apply_profile",
      "get_channel_settings",
      "get_health",
      "get_status",
      "list_alerts",
      "list_custom_sensors",
      "list_devices",
      "list_functions",
      "list_modes",
      "list_profiles",
      "reset_channel",
      "set_fixed_speed",
    ]);
    expect(tools.find((t) => t.name === "get_status")?.annotations?.readOnlyHint).toBe(true);
  });

  it("returns condensed status", async () => {
    const s = await connect(base);
    close = s.close;
    const out = JSON.parse(text(await s.client.callTool({ name: "get_status", arguments: {} })));
    expect(out[1].temps_c).toEqual({ "CPU Temp Tctl": 62.1 });
  });

  it("sets a fixed speed and reports the previous setting", async () => {
    const s = await connect({
      ...base,
      [`PUT /devices/${HUB_UID}/settings/fan1/manual`]: {},
    });
    close = s.close;
    const r = await s.client.callTool({
      name: "set_fixed_speed",
      arguments: { device: "Lian Li Uni SL-Infinity", channel: "Intake", duty: 60 },
    });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({
      ok: true,
      channel: "fan1",
      duty: 60,
      previous: { mode: "profile", profile: "CPU" },
    });
    expect(s.calls).toContain(`PUT /devices/${HUB_UID}/settings/fan1/manual`);
  });

  it("refuses duty below the configured floor without calling the daemon", async () => {
    const s = await connect(base, 30);
    close = s.close;
    const r = await s.client.callTool({
      name: "set_fixed_speed",
      arguments: { device: HUB_UID, channel: "fan2", duty: 25 },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/outside the allowed range 30-100%.*COOLERCONTROL_MIN_DUTY=30/);
    expect(s.calls.some((c) => c.startsWith("PUT"))).toBe(false);
  });

  it("explains a read-only token when the daemon refuses a write", async () => {
    const s = await connect({
      ...base,
      [`PUT /devices/${HUB_UID}/settings/fan1/reset`]: { status: 403, body: { error: "Forbidden" } },
    });
    close = s.close;
    const r = await s.client.callTool({
      name: "reset_channel",
      arguments: { device: HUB_UID, channel: "fan1" },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/token is read-only/);
  });

  it("applies a profile by name", async () => {
    const s = await connect({
      ...base,
      [`PUT /devices/${HUB_UID}/settings/fan2/profile`]: {},
    });
    close = s.close;
    const r = await s.client.callTool({
      name: "apply_profile",
      arguments: { device: HUB_UID, channel: "fan2", profile: "CPU" },
    });
    expect(JSON.parse(text(r))).toMatchObject({ ok: true, profile: "CPU", previous: { mode: "default" } });
  });
});
