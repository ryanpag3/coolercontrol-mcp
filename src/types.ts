// Minimal shapes of the CoolerControl 5.x REST API responses, covering only the
// fields this server reads. See openapi/openapi.json in the CoolerControl repo.

export interface SpeedOptions {
  min_duty: number;
  max_duty: number;
  fixed_enabled: boolean;
}

export interface ChannelInfo {
  label?: string | null;
  speed_options?: SpeedOptions | null;
}

export interface Device {
  uid: string;
  name: string;
  type: string;
  info?: {
    channels?: Record<string, ChannelInfo>;
    temps?: Record<string, { label?: string | null }>;
    temp_min?: number;
    temp_max?: number;
  } | null;
}

export interface TempStatus {
  name: string;
  temp: number;
}

export interface ChannelStatus {
  name: string;
  rpm?: number | null;
  duty?: number | null;
  freq?: number | null;
  watts?: number | null;
}

export interface StatusSnapshot {
  timestamp: string;
  temps?: TempStatus[] | null;
  channels?: ChannelStatus[] | null;
}

export interface DeviceStatus {
  uid: string;
  type: string;
  status_history: StatusSnapshot[];
}

export interface Profile {
  uid: string;
  name: string;
  p_type: string;
  function_uid?: string;
  speed_profile?: [number, number][] | null;
  speed_fixed?: number | null;
  temp_source?: { temp_name: string; device_uid: string } | null;
  temp_min?: number | null;
  temp_max?: number | null;
  member_profile_uids?: string[] | null;
  mix_function_type?: string | null;
  offset_profile?: [number, number][] | null;
}

export interface Mode {
  uid: string;
  name: string;
  /** [device_uid, channel settings] pairs. */
  device_settings?: [string, ChannelSetting[]][];
}

// Function, Alert and CustomSensor have large, version-dependent schemas. Only
// the identifying fields are typed; the rest passes through untouched.

export interface Fn {
  uid: string;
  name: string;
  [key: string]: unknown;
}

export interface Alert {
  uid: string;
  name: string;
  [key: string]: unknown;
}

export interface CustomSensor {
  id: string;
  [key: string]: unknown;
}

export interface ActiveModes {
  current_mode_uid: string | null;
  previous_mode_uid: string | null;
}

export interface ChannelSetting {
  channel_name: string;
  speed_fixed?: number | null;
  profile_uid?: string | null;
  [key: string]: unknown;
}
