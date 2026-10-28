import { describe, expect, it, vi } from "vitest";
import { CoolerControlClient, type FetchFn } from "../src/client.js";

function clientReturning(status: number, body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  const client = new CoolerControlClient({
    baseUrl: "http://localhost:11987/",
    token: "cc_test",
    fetch: fetch as unknown as FetchFn,
  });
  return { client, fetch };
}

describe("CoolerControlClient", () => {
  it("sends the bearer token and encodes path segments", async () => {
    const { client, fetch } = clientReturning(200, "");
    await client.setFixedSpeed("dev uid", "fan/1", 42);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11987/devices/dev%20uid/settings/fan%2F1/manual");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ speed_fixed: 42 }));
    expect(init.headers).toMatchObject({
      Authorization: "Bearer cc_test",
      "Content-Type": "application/json",
    });
  });

  it("unwraps list responses and wraps the single-device status", async () => {
    const { client } = clientReturning(200, { uid: "x", type: "CPU", status_history: [] });
    expect(await client.status("x")).toEqual([{ uid: "x", type: "CPU", status_history: [] }]);
  });

  it.each([
    [401, /rejected the token/],
    [403, /read-only/],
    [429, /rate limiting/],
    [404, /failed with 404: Mode not found/],
  ])("maps HTTP %i to a readable error", async (status, message) => {
    const { client } = clientReturning(status, { error: "Mode not found" });
    await expect(client.activateMode("nope")).rejects.toThrow(message);
  });

  it("reports an unreachable daemon", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new CoolerControlClient({
      baseUrl: "http://localhost:1",
      token: "cc_test",
      fetch: fetch as unknown as FetchFn,
    });
    await expect(client.health()).rejects.toThrow(/Could not reach .* Is coolercontrold running/);
  });
});
