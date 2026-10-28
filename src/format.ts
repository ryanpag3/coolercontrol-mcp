import type { ChannelSetting, Device, DeviceStatus, Mode, Profile } from "./types.js";

// ---- lookups ----

/**
 * Resolves a device by uid, uid prefix (8+ chars) or case-insensitive name.
 * Throws with the candidate list when nothing or more than one device matches.
 */
export function resolveDevice(devices: Device[], ref: string): Device {
  const exact = devices.find((d) => d.uid === ref);
  if (exact) return exact;

  const needle = ref.trim().toLowerCase();
  let matches = needle.length >= 8 ? devices.filter((d) => d.uid.startsWith(needle)) : [];
  if (matches.length === 0) matches = devices.filter((d) => d.name.toLowerCase() === needle);
  if (matches.length === 1) return matches[0]!;

  const list = (ds: Device[]) => ds.map((d) => `${d.name} (${d.uid.slice(0, 12)})`).join(", ");
  if (matches.length > 1) {
    throw new Error(`"${ref}" matches several devices: ${list(matches)}. Use the device uid.`);
  }
  throw new Error(`No device matches "${ref}". Known devices: ${list(devices)}`);
}

/** Resolves a speed-controllable channel by name or label (case-insensitive). */
export function resolveSpeedChannel(device: Device, ref: string): string {
  const channels = Object.entries(device.info?.channels ?? {}).filter(([, c]) => c.speed_options);
  const needle = ref.trim().toLowerCase();
  const match =
    channels.find(([name]) => name === ref) ??
    channels.find(([name]) => name.toLowerCase() === needle) ??
    channels.find(([, c]) => c.label?.toLowerCase() === needle);
  if (match) return match[0];

  const known = channels.map(([n, c]) => (c.label ? `${n} (${c.label})` : n)).join(", ");
  throw new Error(
    `${device.name} has no speed-controllable channel "${ref}".` +
      (known ? ` Available: ${known}` : " It has no speed-controllable channels."),
  );
}

export function resolveByUidOrName<T extends { uid: string; name: string }>(
  items: T[],
  ref: string,
  kind: string,
): T {
  const exact = items.find((i) => i.uid === ref);
  if (exact) return exact;

  const needle = ref.trim().toLowerCase();
  const matches = items.filter((i) => i.name.toLowerCase() === needle);
  if (matches.length === 1) return matches[0]!;
  const list = items.map((i) => `${i.name} (${i.uid})`).join(", ") || "none";
  if (matches.length > 1) throw new Error(`"${ref}" matches several ${kind}s. Use the uid: ${list}`);
  throw new Error(`No ${kind} matches "${ref}". Known ${kind}s: ${list}`);
}

// ---- summaries ----

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export function summarizeDevices(devices: Device[]) {
  return devices.map((d) => {
    const channels = Object.entries(d.info?.channels ?? {});
    const speed = channels
      .filter(([, c]) => c.speed_options)
      .map(([name, c]) => ({
        name,
        ...(c.label ? { label: c.label } : {}),
        min_duty: c.speed_options!.min_duty,
        max_duty: c.speed_options!.max_duty,
        fixed_enabled: c.speed_options!.fixed_enabled,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const other = channels.filter(([, c]) => !c.speed_options).map(([name]) => name);
    const temps = Object.entries(d.info?.temps ?? {})
      .map(([name, t]) => ({ name, ...(t.label && t.label !== name ? { label: t.label } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return {
      uid: d.uid,
      name: d.name,
      type: d.type,
      ...(speed.length ? { speed_channels: speed } : {}),
      ...(other.length ? { other_channels: other } : {}),
      ...(temps.length ? { temps } : {}),
    };
  });
}

/** Latest reading per device, keyed by human labels where the daemon has them. */
export function summarizeStatus(devices: Device[], statuses: DeviceStatus[], channel?: string) {
  const byUid = new Map(devices.map((d) => [d.uid, d]));
  return statuses.flatMap((s) => {
    const latest = s.status_history.at(-1);
    if (!latest) return [];
    const dev = byUid.get(s.uid);

    const temps: Record<string, number> = {};
    for (const t of latest.temps ?? []) {
      const label = dev?.info?.temps?.[t.name]?.label ?? t.name;
      temps[label] = round(t.temp);
    }

    const channels: Record<string, Record<string, number | string>> = {};
    for (const c of latest.channels ?? []) {
      if (channel && c.name !== channel) continue;
      const reading: Record<string, number | string> = {};
      const label = dev?.info?.channels?.[c.name]?.label;
      if (label && label !== c.name) reading.label = label;
      if (c.rpm != null) reading.rpm = c.rpm;
      if (c.duty != null) reading.duty = round(c.duty);
      if (c.watts != null) reading.watts = round(c.watts);
      if (c.freq != null) reading.mhz = c.freq;
      channels[c.name] = reading;
    }

    if (channel && Object.keys(channels).length === 0) return [];
    return [
      {
        uid: s.uid,
        name: dev?.name ?? s.uid,
        type: s.type,
        timestamp: latest.timestamp,
        ...(!channel && Object.keys(temps).length ? { temps_c: temps } : {}),
        ...(Object.keys(channels).length ? { channels } : {}),
      },
    ];
  });
}

export function summarizeProfiles(profiles: Profile[], devices: Device[]) {
  const byUid = new Map(devices.map((d) => [d.uid, d]));
  const byProfileUid = new Map(profiles.map((p) => [p.uid, p.name]));
  return profiles.map((p) => {
    const src = p.temp_source;
    const srcDev = src ? byUid.get(src.device_uid) : undefined;
    return {
      uid: p.uid,
      name: p.name,
      type: p.p_type,
      ...(p.speed_fixed != null ? { speed_fixed: p.speed_fixed } : {}),
      ...(src
        ? {
            temp_source: `${srcDev?.name ?? src.device_uid} / ${
              srcDev?.info?.temps?.[src.temp_name]?.label ?? src.temp_name
            }`,
          }
        : {}),
      ...(p.speed_profile?.length
        ? { curve: p.speed_profile.map(([temp, duty]) => ({ temp_c: temp, duty })) }
        : {}),
      ...(p.member_profile_uids?.length
        ? {
            members: p.member_profile_uids.map((u) => byProfileUid.get(u) ?? u),
            mix_function: p.mix_function_type,
          }
        : {}),
      ...(p.function_uid ? { function_uid: p.function_uid } : {}),
    };
  });
}

/** What each speed channel of a device is currently set to. */
export function summarizeChannelSettings(
  device: Device,
  settings: ChannelSetting[],
  profiles: Profile[],
) {
  const profileName = new Map(profiles.map((p) => [p.uid, p.name]));
  const bySettingChannel = new Map(settings.map((s) => [s.channel_name, s]));
  const channels = Object.entries(device.info?.channels ?? {})
    .filter(([, c]) => c.speed_options)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, c]) => {
      const s = bySettingChannel.get(name);
      const base = { channel: name, ...(c.label ? { label: c.label } : {}) };
      if (s?.speed_fixed != null) return { ...base, mode: "fixed", duty: s.speed_fixed };
      if (s?.profile_uid) {
        return {
          ...base,
          mode: "profile",
          profile: profileName.get(s.profile_uid) ?? s.profile_uid,
          profile_uid: s.profile_uid,
        };
      }
      return { ...base, mode: s ? "other" : "default" };
    });
  return { uid: device.uid, name: device.name, channels };
}

export function describeModes(modes: Mode[], active: { current_mode_uid: string | null }) {
  return {
    active_mode: modes.find((m) => m.uid === active.current_mode_uid)?.name ?? null,
    modes: modes.map((m) => ({ uid: m.uid, name: m.name })),
  };
}
