import { afterEach, describe, expect, it } from "vitest";
import { HUB_UID } from "./fixtures.js";
import { base, call, connect } from "./harness.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function open(...args: Parameters<typeof connect>) {
  const s = await connect(...args);
  close = s.close;
  return s;
}

describe("MCP server", () => {
  it("registers every tool", async () => {
    const s = await open(base);
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "activate_mode",
      "apply_profile",
      "call_api",
      "create_alert",
      "create_custom_sensor",
      "create_function",
      "create_mode",
      "create_profile",
      "delete_alert",
      "delete_custom_sensor",
      "delete_function",
      "delete_mode",
      "delete_profile",
      "duplicate_mode",
      "get_channel_settings",
      "get_health",
      "get_mode",
      "get_status",
      "list_alerts",
      "list_api_endpoints",
      "list_custom_sensors",
      "list_devices",
      "list_functions",
      "list_modes",
      "list_profiles",
      "reset_channel",
      "set_fixed_speed",
      "update_alert",
      "update_custom_sensor",
      "update_function",
      "update_mode",
      "update_profile",
    ]);
    expect(tools.find((t) => t.name === "get_status")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "delete_profile")?.annotations?.destructiveHint).toBe(true);
  });

  it("returns condensed status", async () => {
    const s = await open(base);
    const out = (await call(s, "get_status", {})).json();
    expect(out[1].temps_c).toEqual({ "CPU Temp Tctl": 62.1 });
  });

  it("sets a fixed speed and reports the previous setting", async () => {
    const s = await open({ ...base, [`PUT /devices/${HUB_UID}/settings/fan1/manual`]: {} });
    const r = await call(s, "set_fixed_speed", {
      device: "Lian Li Uni SL-Infinity",
      channel: "Intake",
      duty: 60,
    });
    expect(r.isError).toBe(false);
    expect(r.json()).toMatchObject({
      ok: true,
      channel: "fan1",
      duty: 60,
      previous: { mode: "profile", profile: "CPU" },
    });
    expect(s.sent(`PUT /devices/${HUB_UID}/settings/fan1/manual`)).toEqual([{ speed_fixed: 60 }]);
  });

  it("refuses duty below the configured floor without calling the daemon", async () => {
    const s = await open(base, 30);
    const r = await call(s, "set_fixed_speed", { device: HUB_UID, channel: "fan2", duty: 25 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside the allowed range 30-100%.*COOLERCONTROL_MIN_DUTY=30/);
    expect(s.calls.some((c) => c.key.startsWith("PUT"))).toBe(false);
  });

  it("explains a read-only token when the daemon refuses a write", async () => {
    const s = await open({
      ...base,
      [`PUT /devices/${HUB_UID}/settings/fan1/reset`]: { status: 403, body: { error: "Forbidden" } },
    });
    const r = await call(s, "reset_channel", { device: HUB_UID, channel: "fan1" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/token is read-only/);
  });

  it("applies a profile by name", async () => {
    const s = await open({ ...base, [`PUT /devices/${HUB_UID}/settings/fan2/profile`]: {} });
    const r = await call(s, "apply_profile", { device: HUB_UID, channel: "fan2", profile: "CPU" });
    expect(r.json()).toMatchObject({ ok: true, profile: "CPU", previous: { mode: "default" } });
  });
});
