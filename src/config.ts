import { z } from "zod";

export interface Config {
  url: string;
  token: string;
  /** Lowest fixed duty (%) that set_fixed_speed will apply. */
  minDuty: number;
  insecureTls: boolean;
}

const envSchema = z.object({
  COOLERCONTROL_URL: z.url().default("http://localhost:11987"),
  COOLERCONTROL_TOKEN: z
    .string({
      error:
        "COOLERCONTROL_TOKEN is required. Create one in the CoolerControl UI under Access Protection → Create Token.",
    })
    .trim()
    .startsWith("cc_", "COOLERCONTROL_TOKEN should start with cc_"),
  COOLERCONTROL_MIN_DUTY: z.coerce.number().int().min(0).max(100).default(20),
  COOLERCONTROL_INSECURE_TLS: z.stringbool().default(false),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join("\n  ")}`);
  }
  const e = parsed.data;
  return {
    url: e.COOLERCONTROL_URL.replace(/\/+$/, ""),
    token: e.COOLERCONTROL_TOKEN,
    minDuty: e.COOLERCONTROL_MIN_DUTY,
    insecureTls: e.COOLERCONTROL_INSECURE_TLS,
  };
}
