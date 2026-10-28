import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const token = "cc_550e8400e29b41d4a716446655440000";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ COOLERCONTROL_TOKEN: token })).toEqual({
      url: "http://localhost:11987",
      token,
      minDuty: 20,
      insecureTls: false,
    });
  });

  it("parses overrides and strips trailing slashes", () => {
    const c = loadConfig({
      COOLERCONTROL_TOKEN: token,
      COOLERCONTROL_URL: "https://box:11987/",
      COOLERCONTROL_MIN_DUTY: "0",
      COOLERCONTROL_INSECURE_TLS: "true",
    });
    expect(c).toMatchObject({ url: "https://box:11987", minDuty: 0, insecureTls: true });
  });

  it("requires a token", () => {
    expect(() => loadConfig({})).toThrow(/COOLERCONTROL_TOKEN is required/);
  });

  it("rejects malformed values", () => {
    expect(() => loadConfig({ COOLERCONTROL_TOKEN: "abc" })).toThrow(/start with cc_/);
    expect(() => loadConfig({ COOLERCONTROL_TOKEN: token, COOLERCONTROL_MIN_DUTY: "150" })).toThrow(
      /COOLERCONTROL_MIN_DUTY/,
    );
  });
});
