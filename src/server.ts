import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CoolerControlClient } from "./client.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

export const VERSION = "0.1.0";

export function buildServer(client: CoolerControlClient, opts: { minDuty: number }): McpServer {
  const server = new McpServer(
    { name: "coolercontrol", version: VERSION },
    {
      instructions:
        "Monitor and control cooling hardware through a local CoolerControl daemon. " +
        "Start with list_devices or get_status. Write tools change real fan/pump speeds and need a " +
        "token with Write Access; they return the previous setting so changes can be undone.",
    },
  );
  registerReadTools(server, client);
  registerWriteTools(server, client, opts);
  return server;
}
