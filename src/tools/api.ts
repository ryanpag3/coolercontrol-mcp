import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COOLERCONTROL_API_VERSION, ENDPOINTS, type Endpoint } from "../catalog.js";
import type { CoolerControlClient } from "../client.js";
import { json } from "./result.js";

const MAX_RESPONSE_CHARS = 100_000;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

/** `/devices/{device_uid}/x` → /^\/devices\/[^/]+\/x$/; `{*rest}` matches several segments. */
function templateRegex(path: string): RegExp {
  const pattern = path
    .split(/(\{\*?[^}]+\})/)
    .map((part) =>
      part.startsWith("{*") ? ".+" : part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${pattern}$`);
}

const compiled = ENDPOINTS.map((e) => ({ ...e, re: templateRegex(e.path) }));

export function findEndpoint(method: string, path: string): Endpoint | undefined {
  const m = method.toUpperCase();
  return compiled.find((e) => e.method === m && e.re.test(path));
}

export function registerApiTools(server: McpServer, client: CoolerControlClient): void {
  server.registerTool(
    "list_api_endpoints",
    {
      title: "List CoolerControl API endpoints",
      description:
        `Every CoolerControl ${COOLERCONTROL_API_VERSION} REST endpoint a token can call, for use with call_api: ` +
        "lighting, LCD, calibrations, name overrides, daemon settings, stats, hardware detection, power profiles, " +
        "ThinkPad / AMD overdrive, logs, metrics and the endpoints behind the other tools. Filter by tag or text.",
      inputSchema: {
        tag: z.string().optional().describe("e.g. device, setting, calibration, mode, profile, stats, detect"),
        search: z.string().optional().describe("Case-insensitive text to match in path or summary"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tag, search }) => {
      const s = search?.toLowerCase();
      const rows = ENDPOINTS.filter(
        (e) =>
          (!tag || e.tag === tag) &&
          (!s || e.path.toLowerCase().includes(s) || e.summary.toLowerCase().includes(s)),
      );
      return json({
        tags: [...new Set(ENDPOINTS.map((e) => e.tag))].sort(),
        endpoints: rows,
        note:
          "Bodies follow the daemon's OpenAPI schema named in bodySchema. For PUT updates, GET the object first " +
          "and send it back with your changes. Login, tokens, shutdown, plugins and stress tests need a browser " +
          "session and are not available to tokens.",
      });
    },
  );

  server.registerTool(
    "call_api",
    {
      title: "Call CoolerControl API",
      description:
        "Call any endpoint from list_api_endpoints directly. Prefer the dedicated tools when one fits; they " +
        "validate inputs. Non-GET calls change daemon state and need a token with Write Access.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().startsWith("/").describe("Concrete path, e.g. /devices/<uid>/settings/fan1/lighting"),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        body: z.unknown().optional().describe("JSON body"),
        text: z.string().optional().describe("Plain-text body, for endpoints that take text"),
        form: z
          .object({
            fields: z.record(z.string(), z.string()).optional(),
            files: z
              .record(z.string(), z.string())
              .optional()
              .describe("Form field → local image file path, e.g. {\"images[]\": \"/home/me/logo.png\"}"),
          })
          .optional()
          .describe("multipart/form-data body (LCD image endpoints)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ method, path, query, body, text, form }) => {
      const pathOnly = path.split("?")[0]!;
      const endpoint = findEndpoint(method, pathOnly);
      if (!endpoint) {
        const samePath = compiled.filter((e) => e.re.test(pathOnly)).map((e) => e.method);
        throw new Error(
          samePath.length
            ? `${pathOnly} supports ${samePath.join(", ")}, not ${method}.`
            : `${method} ${pathOnly} is not a token-accessible CoolerControl endpoint. See list_api_endpoints.`,
        );
      }
      if ([body !== undefined, text !== undefined, form !== undefined].filter(Boolean).length > 1) {
        throw new Error("Give only one of body, text or form.");
      }
      if (endpoint.body === "multipart" && !form) throw new Error(`${endpoint.path} takes a multipart form.`);

      let files: Record<string, { filename: string; type: string; data: Uint8Array<ArrayBuffer> }> | undefined;
      if (form?.files) {
        files = {};
        for (const [field, file] of Object.entries(form.files)) {
          const type = IMAGE_TYPES[extname(file).toLowerCase()];
          if (!type) throw new Error(`${file}: only image files can be uploaded (${Object.keys(IMAGE_TYPES).join(" ")}).`);
          files[field] = { filename: basename(file), type, data: await readFile(file) };
        }
      }

      const res = await client.send(method, pathOnly, {
        query,
        json: body,
        text,
        form: form ? { fields: form.fields, files } : undefined,
      });
      let out = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null, null, 2);
      if (out.length > MAX_RESPONSE_CHARS) {
        out = `${out.slice(0, MAX_RESPONSE_CHARS)}\n… truncated (${out.length} chars total)`;
      }
      return { content: [{ type: "text", text: `${res.status} ${res.contentType}\n${out}` }] };
    },
  );
}
