#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CoolerControlClient } from "./client.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CoolerControlClient({
    baseUrl: config.url,
    token: config.token,
    insecureTls: config.insecureTls,
  });
  const server = buildServer(client, { minDuty: config.minDuty });
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; diagnostics go to stderr.
  console.error(`coolercontrol-mcp connected to ${config.url}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
