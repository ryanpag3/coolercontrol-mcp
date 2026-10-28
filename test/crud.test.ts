import { afterEach, describe, expect, it } from "vitest";
import { findEndpoint } from "../src/tools/api.js";
import { CPU_UID, HUB_UID } from "./fixtures.js";
import { base, call, connect, defaultFunction } from "./harness.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => close?.());

async function open(routes: Parameters<typeof connect>[0]) {
  const s = await connect(routes);
  close = s.close;
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("profiles", () => {
  it("creates a graph profile with a sorted curve and a sensor found by label", async () => {
    const s = await open({ ...base, "POST /profiles": {} });
    const r = await call(s, "create_profile", {
      name: "Quiet CPU",
      type: "Graph",
      temp_source: { device: "AMD Ryzen 7 9800X3D", sensor: "cpu temp tctl" },
      curve: [
        { temp_c: 80, duty: 60 },
        { temp_c: 40, duty: 20 },
      ],
    });
    expect(r.isError).toBe(false);
    const [sent] = s.sent("POST /profiles") as Record<string, unknown>[];
    expect(sent).toMatchObject({
      name: "Quiet CPU",
      p_type: "Graph",
      function_uid: "0",
      temp_source: { device_uid: CPU_UID, temp_name: "temp1" },
      speed_profile: [
        [40, 20],
        [80, 60],
      ],
    });
    expect(sent!.uid).toMatch(UUID);
  });

  it("validates per-type requirements before calling the daemon", async () => {
    const s = await open(base);
    expect((await call(s, "create_profile", { name: "X", type: "Fixed" })).text).toMatch(/needs speed_fixed/);
    expect((await call(s, "create_profile", { name: "X", type: "Mix", members: ["CPU"] })).text).toMatch(
      /needs mix_function/,
    );
    expect(
      (
        await call(s, "create_profile", {
          name: "X",
          type: "Graph",
          temp_source: { device: CPU_UID, sensor: "temp1" },
          curve: [
            { temp_c: 50, duty: 10 },
            { temp_c: 50, duty: 90 },
          ],
        })
      ).text,
    ).toMatch(/two points at 50°C/);
    expect((await call(s, "create_profile", { name: "cpu", type: "Fixed", speed_fixed: 50 })).text).toMatch(
      /already exists/,
    );
    expect(s.calls.some((c) => c.key === "POST /profiles")).toBe(false);
  });

  it("updates only the given fields", async () => {
    const s = await open({ ...base, "PUT /profiles": {} });
    const r = await call(s, "update_profile", { profile: "CPU", name: "CPU v2" });
    expect(r.isError).toBe(false);
    expect(s.sent("PUT /profiles")[0]).toMatchObject({
      uid: "p-cpu",
      name: "CPU v2",
      p_type: "Graph",
      speed_profile: [
        [70, 40],
        [100, 100],
      ],
      temp_source: { device_uid: CPU_UID, temp_name: "temp1" },
    });
  });

  it("refuses to delete a profile in use unless forced", async () => {
    const s = await open({ ...base, "DELETE /profiles/p-cpu": {} });
    const refused = await call(s, "delete_profile", { profile: "CPU" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Lian Li Uni SL-Infinity fan1");
    expect(s.calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);

    const forced = await call(s, "delete_profile", { profile: "CPU", force: true });
    expect(forced.json()).toMatchObject({ ok: true, was_used_by: { channels: ["Lian Li Uni SL-Infinity fan1"] } });
  });

  it("protects the built-in Unmanaged profile", async () => {
    const s = await open(base);
    expect((await call(s, "delete_profile", { profile: "Unmanaged" })).text).toMatch(/cannot be deleted/);
  });
});

describe("modes", () => {
  it("creates, renames and re-saves a mode", async () => {
    const mode = { uid: "m1", name: "Quiet", device_settings: [] };
    const s = await open({
      ...base,
      "GET /modes": { body: { modes: [mode] } },
      "POST /modes": { body: { uid: "m2", name: "Gaming", device_settings: [] } },
      "PUT /modes": {},
      "PUT /modes/m1/settings": { body: mode },
    });
    expect((await call(s, "create_mode", { name: "Gaming" })).json()).toMatchObject({ mode: { uid: "m2" } });
    expect(s.sent("POST /modes")).toEqual([{ name: "Gaming" }]);

    await call(s, "update_mode", { mode: "quiet", name: "Silent", save_current_settings: true });
    expect(s.sent("PUT /modes")).toEqual([{ uid: "m1", name: "Silent" }]);
    expect(s.calls.map((c) => c.key)).toContain("PUT /modes/m1/settings");
  });

  it("describes a mode's settings with names", async () => {
    const s = await open({
      ...base,
      "GET /modes": { body: { modes: [{ uid: "m1", name: "Quiet" }] } },
      "GET /modes/m1": {
        body: {
          uid: "m1",
          name: "Quiet",
          device_settings: [[HUB_UID, [{ channel_name: "fan1", profile_uid: "p-cpu" }]]],
        },
      },
    });
    expect((await call(s, "get_mode", { mode: "Quiet" })).json().devices[0]).toEqual({
      device: "Lian Li Uni SL-Infinity",
      uid: HUB_UID,
      channels: [{ channel: "fan1", profile: "CPU" }],
    });
  });
});

describe("functions, alerts, custom sensors", () => {
  it("creates a function from Default Function defaults with a fresh uid", async () => {
    const s = await open({ ...base, "POST /functions": {} });
    await call(s, "create_function", { fields: { name: "Smooth", duty_minimum: 1, duty_maximum: 5 } });
    const [sent] = s.sent("POST /functions") as Record<string, unknown>[];
    expect(sent).toMatchObject({ ...defaultFunction, uid: expect.stringMatching(UUID), name: "Smooth", duty_minimum: 1, duty_maximum: 5 });
  });

  it("refuses to delete a function used by profiles", async () => {
    const s = await open({
      ...base,
      "GET /functions": { body: { functions: [defaultFunction, { ...defaultFunction, uid: "f1", name: "Smooth" }] } },
      "GET /profiles": { body: { profiles: [{ uid: "p1", name: "Uses it", p_type: "Fixed", function_uid: "f1" }] } },
    });
    expect((await call(s, "delete_function", { function: "Smooth" })).text).toMatch(/used by: profile Uses it/);
    expect((await call(s, "update_function", { function: "0", changes: { duty_maximum: 9 } })).text).toMatch(
      /cannot be changed/,
    );
  });

  it("merges alert updates onto the existing alert", async () => {
    const alert = { uid: "a1", name: "Hot CPU", min: 0, max: 90, warmup_duration: 5, enabled: true };
    const s = await open({ ...base, "GET /alerts": { body: { alerts: [alert], logs: [] } }, "PUT /alerts": {} });
    await call(s, "update_alert", { alert: "hot cpu", changes: { max: 85 } });
    expect(s.sent("PUT /alerts")).toEqual([{ ...alert, max: 85 }]);
  });

  it("requires an id for custom sensors", async () => {
    const s = await open({ ...base, "GET /custom-sensors": { body: { custom_sensors: [] } } });
    expect((await call(s, "create_custom_sensor", { fields: { cs_type: "File" } })).text).toMatch(
      /fields.id is required/,
    );
  });
});

describe("call_api", () => {
  it("matches path templates, including wildcards", () => {
    expect(findEndpoint("put", `/devices/${HUB_UID}/settings/fan1/lighting`)?.path).toBe(
      "/devices/{device_uid}/settings/{channel_name}/lighting",
    );
    expect(findEndpoint("GET", "/stats")?.summary).toBe("Retrieve Channel Stats");
    expect(findEndpoint("POST", "/shutdown")).toBeUndefined(); // cookie-only
    expect(findEndpoint("GET", "/sse")).toBeUndefined();
  });

  it("passes JSON and query through and returns text responses", async () => {
    const s = await open({
      ...base,
      "PATCH /settings": {},
      "GET /metrics": { body: "# HELP cc_temp\ncc_temp 42", contentType: "text/plain" },
    });
    await call(s, "call_api", { method: "PATCH", path: "/settings", body: { apply_on_boot: true } });
    expect(s.sent("PATCH /settings")).toEqual([{ apply_on_boot: true }]);
    expect((await call(s, "call_api", { method: "GET", path: "/metrics" })).text).toContain("cc_temp 42");
  });

  it("explains unsupported methods and unknown paths", async () => {
    const s = await open(base);
    expect((await call(s, "call_api", { method: "DELETE", path: "/devices" })).text).toMatch(
      /\/devices supports GET, not DELETE/,
    );
    expect((await call(s, "call_api", { method: "POST", path: "/shutdown" })).text).toMatch(
      /not a token-accessible/,
    );
  });
});
