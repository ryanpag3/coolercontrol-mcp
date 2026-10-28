import { Agent, FormData, fetch as undiciFetch } from "undici";
import type {
  ActiveModes,
  Alert,
  ChannelSetting,
  CustomSensor,
  Device,
  DeviceStatus,
  Fn,
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

export interface RawRequest {
  query?: Record<string, string | number | boolean>;
  json?: unknown;
  text?: string;
  /** multipart/form-data: plain fields plus files as { filename, type, data }. */
  form?: {
    fields?: Record<string, string>;
    files?: Record<string, { filename: string; type: string; data: Uint8Array<ArrayBuffer> }>;
  };
}

export interface RawResponse {
  status: number;
  contentType: string;
  /** Parsed JSON when the daemon sent JSON, otherwise the text body. */
  body: unknown;
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

  /** Any endpoint. Throws CoolerControlError on non-2xx responses. */
  async send(method: string, path: string, req: RawRequest = {}): Promise<RawResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json, text/plain;q=0.9, */*;q=0.5",
    };
    let body: string | FormData | undefined;
    if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    } else if (req.text !== undefined) {
      headers["Content-Type"] = "text/plain; charset=utf-8";
      body = req.text;
    } else if (req.form) {
      const form = new FormData();
      for (const [k, v] of Object.entries(req.form.fields ?? {})) form.append(k, v);
      for (const [k, f] of Object.entries(req.form.files ?? {})) {
        form.append(k, new Blob([f.data], { type: f.type }), f.filename);
      }
      body = form; // fetch sets the multipart boundary header
    }

    let url = this.baseUrl + path;
    if (req.query && Object.keys(req.query).length) {
      const qs = new URLSearchParams(
        Object.entries(req.query).map(([k, v]) => [k, String(v)]),
      ).toString();
      url += `?${qs}`;
    }

    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(url, {
        method,
        headers,
        body,
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
    const contentType = res.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    if (text && (contentType.includes("json") || /^[[{]/.test(text.trimStart()))) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep as text
      }
    }
    return { status: res.status, contentType, body: text ? parsed : undefined };
  }

  async request<T>(method: string, path: string, json?: unknown): Promise<T> {
    return (await this.send(method, path, { json })).body as T;
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

  mode(modeUid: string) {
    return this.request<Mode>("GET", `/modes/${seg(modeUid)}`);
  }

  activeModes() {
    return this.request<ActiveModes>("GET", "/modes-active");
  }

  async profiles(): Promise<Profile[]> {
    return (await this.request<{ profiles: Profile[] }>("GET", "/profiles")).profiles;
  }

  async functions(): Promise<Fn[]> {
    return (await this.request<{ functions: Fn[] }>("GET", "/functions")).functions;
  }

  alerts() {
    return this.request<{ alerts: Alert[]; logs: unknown[] }>("GET", "/alerts");
  }

  async customSensors(): Promise<CustomSensor[]> {
    return (await this.request<{ custom_sensors: CustomSensor[] }>("GET", "/custom-sensors"))
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

  // Profiles, functions, alerts and custom sensors share one shape: POST creates,
  // PUT replaces the whole object, DELETE /{collection}/{id} removes it.

  async createProfile(p: Profile) { await this.request("POST", "/profiles", p); }
  async updateProfile(p: Profile) { await this.request("PUT", "/profiles", p); }
  async deleteProfile(uid: string) { await this.request("DELETE", `/profiles/${seg(uid)}`); }

  async createFunction(f: Fn) { await this.request("POST", "/functions", f); }
  async updateFunction(f: Fn) { await this.request("PUT", "/functions", f); }
  async deleteFunction(uid: string) { await this.request("DELETE", `/functions/${seg(uid)}`); }

  async createAlert(a: Alert) { await this.request("POST", "/alerts", a); }
  async updateAlert(a: Alert) { await this.request("PUT", "/alerts", a); }
  async deleteAlert(uid: string) { await this.request("DELETE", `/alerts/${seg(uid)}`); }

  async createCustomSensor(s: CustomSensor) { await this.request("POST", "/custom-sensors", s); }
  async updateCustomSensor(s: CustomSensor) { await this.request("PUT", "/custom-sensors", s); }
  async deleteCustomSensor(id: string) { await this.request("DELETE", `/custom-sensors/${seg(id)}`); }

  /** Creates a mode from the current channel settings. */
  createMode(name: string) {
    return this.request<Mode>("POST", "/modes", { name });
  }

  async renameMode(uid: string, name: string) {
    await this.request("PUT", "/modes", { uid, name });
  }

  async deleteMode(uid: string) {
    await this.request("DELETE", `/modes/${seg(uid)}`);
  }

  duplicateMode(uid: string) {
    return this.request<Mode>("POST", `/modes/${seg(uid)}/duplicate`);
  }

  /** Overwrites a mode's saved settings with the current channel settings. */
  updateModeSettings(uid: string) {
    return this.request<Mode>("PUT", `/modes/${seg(uid)}/settings`);
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
