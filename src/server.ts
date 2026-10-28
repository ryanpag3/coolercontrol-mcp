import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CoolerControlClient } from "./client.js";
import { registerApiTools } from "./tools/api.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerModeTools } from "./tools/modes.js";
import { registerProfileTools } from "./tools/profiles.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

export const VERSION = "0.2.0";

export function buildServer(client: CoolerControlClient, opts: { minDuty: number }): McpServer {
  const server = new McpServer(
    { name: "coolercontrol", version: VERSION },
    {
      instructions:
        "Monitor and control cooling hardware through a local CoolerControl daemon. " +
        "Start with list_devices or get_status. Write tools change real fan/pump speeds and need a " +
        "token with Write Access; they return the previous setting so changes can be undone. " +
        "Profiles, modes, functions, alerts and custom sensors have create/update/delete tools; anything " +
        "else the API offers (lighting, LCD, calibration, overrides, settings) is reachable via " +
        "list_api_endpoints and call_api.",
    },
  );
  registerReadTools(server, client);
  registerWriteTools(server, client, opts);
  registerProfileTools(server, client);
  registerModeTools(server, client);
  registerEntityTools(server, client);
  registerApiTools(server, client);
  return server;
}
