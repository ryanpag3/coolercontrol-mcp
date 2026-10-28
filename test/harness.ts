import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";
import { CoolerControlClient, type FetchFn } from "../src/client.js";
import { buildServer } from "../src/server.js";
import { devices, HUB_UID, hubSettings, profiles, statuses } from "./fixtures.js";

export type Route = { status?: number; body?: unknown; contentType?: string };

export interface Call {
  key: string;
  body?: unknown;
}

/** An MCP client wired to the server, backed by a fake daemon keyed on "METHOD /path". */
export async function connect(routes: Record<string, Route>, minDuty = 20) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: { method: string; body?: unknown }) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    calls.push({
      key,
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
    });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    const body =
      route.body === undefined ? "" : typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
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
  return {
    client,
    calls,
    /** Request bodies sent for one "METHOD /path". */
    sent: (key: string) => calls.filter((c) => c.key === key).map((c) => c.body),
    close: () => client.close(),
  };
}

export const defaultFunction = {
  uid: "0",
  name: "Default Function",
  duty_minimum: 2,
  duty_maximum: 100,
  step_size_min_decreasing: 0,
  step_size_max_decreasing: 0,
  threshold_hopping: true,
  f_type: "Identity",
};

export const base: Record<string, Route> = {
  "GET /devices": { body: { devices } },
  "GET /profiles": { body: { profiles } },
  "GET /functions": { body: { functions: [defaultFunction] } },
  "GET /modes": { body: { modes: [] } },
  "GET /status": { body: { devices: statuses } },
  [`GET /devices/${HUB_UID}/settings`]: { body: { settings: hubSettings } },
};

export async function call(
  s: Awaited<ReturnType<typeof connect>>,
  name: string,
  args: Record<string, unknown>,
) {
  const r = await s.client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]!.text;
  return { isError: !!r.isError, text, json: () => JSON.parse(text) };
}
