# coolercontrol-mcp

An [MCP](https://modelcontextprotocol.io) server for [CoolerControl](https://gitlab.com/coolercontrol/coolercontrol). It lets Claude and other MCP clients read your temperatures and fan speeds, and change fan profiles, fixed speeds and modes, through the CoolerControl daemon's REST API.

Tested against CoolerControl 5.1.1.

## Tools

All 32 tools. ✏️ marks tools that change something; they need a token with **Write Access**.

| Area | Tool | What it does |
|---|---|---|
| Monitoring | `get_status` | Latest temperatures (°C), fan rpm and duty, power and clocks; optionally one device or channel |
| | `list_devices` | Devices, their fan channels and their temperature sensors |
| | `get_channel_settings` | What each fan channel is set to: a profile, a fixed duty, or the default |
| | `get_health` | Daemon version, uptime and warning count |
| Fan channels | `set_fixed_speed` ✏️ | Set a channel to a fixed duty % (refuses values below `COOLERCONTROL_MIN_DUTY`) |
| | `apply_profile` ✏️ | Assign a profile to a channel |
| | `reset_channel` ✏️ | Return a channel to its hardware default |
| Profiles | `list_profiles` | Profiles with their curves and temperature sources |
| | `create_profile` ✏️ | Create a Fixed, Graph, Mix or Overlay profile |
| | `update_profile` ✏️ | Change some fields of a profile; the rest stay as they are |
| | `delete_profile` ✏️ | Delete a profile; refuses while anything uses it unless `force` is set |
| Modes | `list_modes` | Saved modes and which one is active |
| | `get_mode` | The channel settings saved in a mode |
| | `create_mode` ✏️ | Save the current settings of every channel as a new mode |
| | `update_mode` ✏️ | Rename a mode and/or re-save it from the current settings |
| | `duplicate_mode` ✏️ | Copy a mode |
| | `delete_mode` ✏️ | Delete a mode |
| | `activate_mode` ✏️ | Apply a mode's saved settings |
| Functions | `list_functions` | Functions that control how quickly profiles change duty |
| | `create_function` ✏️ | Create a function; unset fields copy the Default Function |
| | `update_function` ✏️ | Change some fields of a function |
| | `delete_function` ✏️ | Delete a function; refuses while a profile uses it unless `force` is set |
| Alerts | `list_alerts` | Alerts and the recent alert log |
| | `create_alert` ✏️ | Create an alert on a temperature, duty, load, rpm or frequency |
| | `update_alert` ✏️ | Change some fields of an alert |
| | `delete_alert` ✏️ | Delete an alert |
| Custom sensors | `list_custom_sensors` | Custom sensors |
| | `create_custom_sensor` ✏️ | Create a sensor that mixes, offsets or averages other sensors, or reads a file |
| | `update_custom_sensor` ✏️ | Change some fields of a custom sensor |
| | `delete_custom_sensor` ✏️ | Delete a custom sensor; refuses while a profile uses it unless `force` is set |
| Any other endpoint | `list_api_endpoints` | List the 83 REST endpoints a token can call |
| | `call_api` ✏️ | Call any of them: lighting, LCD images, calibration, name overrides, daemon settings, stats, detection, power profiles, logs, metrics |

Devices can be given by uid, uid prefix (8+ characters) or exact name. Channels can be given by name (`fan1`) or label (`Intake`). Profiles, modes, functions and alerts can be given by uid or name.

**Not supported:** login and passwords, access-token management, daemon shutdown, plugins, stress tests, saving UI settings and the live event streams. CoolerControl accepts only a browser session for these, not a token.

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
