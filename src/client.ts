import { Agent, fetch as undiciFetch } from "undici";
import type {
  ActiveModes,
  ChannelSetting,
  Device,
  DeviceStatus,
  Mode,
  Profile,
} from "./types.js";

export type FetchFn = typeof undiciFetch;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  insecureTls?: boolean;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: FetchFn;
}

export class CoolerControlError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CoolerControlError";
  }
}

const seg = encodeURIComponent;

export class CoolerControlClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  // One keep-alive agent: the daemon caps simultaneous connections per client.
  private readonly dispatcher: Agent;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchFn = opts.fetch ?? undiciFetch;
    this.dispatcher = new Agent({
      connections: 2,
      connect: opts.insecureTls ? { rejectUnauthorized: false } : undefined,
    });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new CoolerControlError(
        `Could not reach the CoolerControl daemon at ${this.baseUrl} (${reason}). Is coolercontrold running?`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new CoolerControlError(describeError(res.status, text, method, path), res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  // ---- reads ----

  health() {
    return this.request<Record<string, unknown>>("GET", "/health");
  }

  async devices(): Promise<Device[]> {
    return (await this.request<{ devices: Device[] }>("GET", "/devices")).devices;
  }

  async status(deviceUid?: string): Promise<DeviceStatus[]> {
    // /status wraps devices in a list; /status/{uid} returns the one device bare.
    if (deviceUid) return [await this.request<DeviceStatus>("GET", `/status/${seg(deviceUid)}`)];
    return (await this.request<{ devices: DeviceStatus[] }>("GET", "/status")).devices;
  }

  async modes(): Promise<Mode[]> {
    return (await this.request<{ modes: Mode[] }>("GET", "/modes")).modes;
  }

  activeModes() {
    return this.request<ActiveModes>("GET", "/modes-active");
  }

  async profiles(): Promise<Profile[]> {
    return (await this.request<{ profiles: Profile[] }>("GET", "/profiles")).profiles;
  }

  async functions(): Promise<Record<string, unknown>[]> {
    return (await this.request<{ functions: Record<string, unknown>[] }>("GET", "/functions"))
      .functions;
  }

  alerts() {
    return this.request<{ alerts: unknown[]; logs: unknown[] }>("GET", "/alerts");
  }

  async customSensors(): Promise<unknown[]> {
    return (await this.request<{ custom_sensors: unknown[] }>("GET", "/custom-sensors"))
      .custom_sensors;
  }

  async channelSettings(deviceUid: string): Promise<ChannelSetting[]> {
    return (
      await this.request<{ settings: ChannelSetting[] }>(
        "GET",
        `/devices/${seg(deviceUid)}/settings`,
      )
    ).settings;
  }

  // ---- writes (need a token with Write Access) ----

  async activateMode(modeUid: string): Promise<void> {
    await this.request("POST", `/modes-active/${seg(modeUid)}`);
  }

  async setFixedSpeed(deviceUid: string, channel: string, duty: number): Promise<void> {
    await this.request("PUT", `/devices/${seg(deviceUid)}/settings/${seg(channel)}/manual`, {
      speed_fixed: duty,
    });
  }

  async applyProfile(deviceUid: string, channel: string, profileUid: string): Promise<void> {
    await this.request("PUT", `/devices/${seg(deviceUid)}/settings/${seg(channel)}/profile`, {
      profile_uid: profileUid,
    });
  }

  async resetChannel(deviceUid: string, channel: string): Promise<void> {
    await this.request("PUT", `/devices/${seg(deviceUid)}/settings/${seg(channel)}/reset`);
  }
}

function describeError(status: number, body: string, method: string, path: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
  } catch {
    // not JSON; keep the raw body
  }
  switch (status) {
    case 401:
      return "CoolerControl rejected the token (401). It may be wrong, expired or deleted; create a new one under Access Protection.";
    case 403:
      return "This CoolerControl token is read-only (403). Create a token with Write Access to change settings.";
    case 429:
      return "CoolerControl is rate limiting this client after repeated failed authentication (429). Wait a bit and check the token.";
    default:
      return `CoolerControl ${method} ${path} failed with ${status}${detail ? `: ${detail}` : ""}`;
  }
}
