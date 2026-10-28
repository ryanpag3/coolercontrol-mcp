# coolercontrol-mcp

An [MCP](https://modelcontextprotocol.io) server for [CoolerControl](https://gitlab.com/coolercontrol/coolercontrol). It lets Claude and other MCP clients read your temperatures and fan speeds, and change fan profiles, fixed speeds and modes, through the CoolerControl daemon's REST API.

Tested against CoolerControl 5.1.1.

## Tools

| Tool | What it does |
|---|---|
| `get_status` | Latest temperatures (°C), fan rpm/duty, power and clocks, optionally for one device/channel |
| `list_devices` | Devices with their speed-controllable channels and temperature sensors |
| `get_channel_settings` | What each fan channel is set to (profile, fixed duty or default) |
| `list_profiles` | Fan profiles with curves and temperature sources |
| `list_functions` | Profile functions (duty limits, step sizes) |
| `list_modes` | Saved modes and which one is active |
| `list_alerts` | Alerts and the recent alert log |
| `list_custom_sensors` | Custom sensors |
| `get_health` | Daemon version, uptime, warnings |
| `set_fixed_speed` ✏️ | Set a channel to a fixed duty % |
| `apply_profile` ✏️ | Assign a profile to a channel |
| `reset_channel` ✏️ | Reset a channel to its hardware default |
| `activate_mode` ✏️ | Activate a saved mode |

Devices can be given by uid, by a uid prefix (8+ characters) or by exact name. Channels can be given by name (`fan1`) or by label (`Intake`). The ✏️ write tools return the previous setting, so a change can be undone.

## Setup

1. **Create a token.** In the CoolerControl UI, open **Access Protection → Create Token**. Leave **Write Access** off for a monitoring-only token; the daemon then rejects the write tools with a clear error. Turn it on to let the client change fan settings.
2. **Build:**
   ```sh
   git clone https://github.com/ryanpag3/coolercontrol-mcp.git
   cd coolercontrol-mcp
   npm install   # also builds dist/
   ```
3. **Register it with your MCP client.**

   Claude Code:
   ```sh
   claude mcp add coolercontrol -s user \
     -e COOLERCONTROL_TOKEN=cc_... \
     -- node /path/to/coolercontrol-mcp/dist/index.js
   ```

   Claude Desktop (or any client that uses a JSON config):
   ```json
   {
     "mcpServers": {
       "coolercontrol": {
         "command": "node",
         "args": ["/path/to/coolercontrol-mcp/dist/index.js"],
         "env": { "COOLERCONTROL_TOKEN": "cc_..." }
       }
     }
   }
   ```

### Docker

A multi-arch image (amd64, arm64) is published to GHCR. The daemon listens on `127.0.0.1` by default, so the container needs `--network host` to reach it:

```sh
claude mcp add coolercontrol -s user -e COOLERCONTROL_TOKEN=cc_... -- \
  docker run -i --rm --network host -e COOLERCONTROL_TOKEN ghcr.io/ryanpag3/coolercontrol-mcp:latest
```

```json
{
  "mcpServers": {
    "coolercontrol": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "COOLERCONTROL_TOKEN",
               "ghcr.io/ryanpag3/coolercontrol-mcp:latest"],
      "env": { "COOLERCONTROL_TOKEN": "cc_..." }
    }
  }
}
```

Tags: `latest` (master), `sha-<commit>`, and `X.Y.Z` / `X.Y` for `vX.Y.Z` git tags.

## Configuration

| Variable | Default | |
|---|---|---|
| `COOLERCONTROL_TOKEN` | *(required)* | `cc_...` access token |
| `COOLERCONTROL_URL` | `http://localhost:11987` | Daemon URL. Use `https://` for a remote daemon with TLS enabled |
| `COOLERCONTROL_MIN_DUTY` | `20` | Lowest duty % that `set_fixed_speed` will apply. A guard against stopping a pump or fan by accident; set it to `0` to allow anything the hardware accepts |
| `COOLERCONTROL_INSECURE_TLS` | `false` | Accept self-signed certificates |

The minimum-duty floor applies only to `set_fixed_speed`. Profiles keep whatever curve you gave them in CoolerControl.

## Development

```sh
npm run build   # tsc → dist/
npm test        # vitest
npx @modelcontextprotocol/inspector -e COOLERCONTROL_TOKEN=cc_... node dist/index.js
```

## License

MIT
