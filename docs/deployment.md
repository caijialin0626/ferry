# Deployment guide

[Back to the README](../README.md)

## Single machine

The quick start installs Ferry from GitHub and starts both services in the background. It needs Git, npm, Node.js 22.20 or later, and a signed-in agent CLI. The browser and host APIs listen on loopback ports 8787 and 8788.

Read the browser code from `~/.local/share/ferry/local/access-code` and startup logs from `startup.log` in the same directory. Subsequent starts reuse the credentials. Stop both services with the printed `kill` command. After a reboot, run the quick start again. For a process manager, clone the repository, run `npm ci`, and use `npm start` as the foreground service command.

Quick-start chats, pairings, and credentials live under the same `local` directory. If `XDG_DATA_HOME` is set, Ferry uses `ferry/local` beneath it.

## Connect from another device

If the machine running Ferry already accepts SSH connections, open a local port forward on the client device and keep it running. Replace `user@machine` with the SSH destination.

```sh
ssh -N -L 127.0.0.1:8787:127.0.0.1:8787 user@machine
```

Open <http://127.0.0.1:8787> in the client browser. On a phone, configure the same local forward in an SSH client that supports port forwarding.

## Separate machines

Use the [standalone commands in the README](../README.md). Run `host` where the CLIs are installed and `web` on the machine serving the browser. Standalone services prefer a private LAN IPv4 address, followed by shared-space IPv4 (such as Tailscale), then private IPv6. They fall back to loopback if none is available. Use the printed URL. If the peer is reachable through a different interface, select it with `--bind IP`. Set the port with `--port`. When Web runs behind an HTTPS reverse proxy, set the browser address with `--origin https://ferry.example.com`. With an explicit origin, Web defaults to loopback for a proxy on the same machine.

The host prints a single-use pairing code valid for ten minutes. To get a fresh code, run `npx --yes github:caijialin0626/ferry#main pair` on the host. Both roles accept `--foreground` for process managers.

### Docker or manual configuration

Run the following commands from the repository root. Replace the example secrets with random values generated with `openssl rand -hex 32`.

Run the **Web service** on any server and an **execution host** on every machine that has agent CLIs. Connect them over a private network such as Tailscale, WireGuard or your LAN, or put HTTPS in front.

**Web service (Docker):**

```sh
cp web.env.example web.env   # set FERRY_WEB_LOGIN_TOKEN and FERRY_WEB_ORIGIN
docker compose up -d --build
```

**Each execution host:**

```sh
cp host.env.example host.env # set FERRY_HOST_TOKEN and bind to a private address, e.g. FERRY_HOST_BIND=100.x.y.z
npm install && npm run host
```

**Pair a host:** run `npm run pair` on the host to get a one-time 8-digit code (valid for 10 minutes). In the UI, open **Machines → Add machine** and enter the host address (for example `http://100.x.y.z:8788`) and the code. The Web service stores its own credential for that host; hosts keep only a hash of it.

To run the host as a background service, start `npm run host` from the repository folder with launchd (macOS), systemd (Linux) or a process manager of your choice.

## Configuration

All settings are environment variables. `npm run host`, `npm run pair` and `npm run web` load `host.env` / `web.env` automatically.

**Execution host**

| Variable | Default | Description |
| --- | --- | --- |
| `FERRY_HOST_TOKEN` | — (required) | Shared secret (≥ 24 chars) for a Web service configured with `FERRY_HOST_URL`. |
| `FERRY_HOST_BIND` | `127.0.0.1` | Listen address. Use a private address when the Web service runs elsewhere. |
| `FERRY_HOST_PORT` | `8788` | Listen port. |
| `FERRY_HOST_DATA` | `~/.local/share/ferry/host` | SQLite database, attachments and pairing credentials. Use the same value for `npm run pair`. |
| `FERRY_CODEX_BIN` / `FERRY_CLAUDE_BIN` / `FERRY_AGY_BIN` | auto | Paths to the agent CLIs. |
| `FERRY_CODEX_APP_SERVER_SOCKET` | `$CODEX_HOME/app-server-control/app-server-control.sock` | Shared Codex App Server socket. |
| `FERRY_CLAUDE_HISTORY_DIR` | `$CLAUDE_CONFIG_DIR/projects` | Native Claude Code transcripts, used to restore older replies. |

**Web service**

| Variable | Default | Description |
| --- | --- | --- |
| `FERRY_WEB_LOGIN_TOKEN` | — (required) | Browser access code (≥ 24 chars). Not used in Tailscale mode. |
| `FERRY_WEB_BIND` / `FERRY_WEB_PORT` | `127.0.0.1` / `8787` | Listen address and port. |
| `FERRY_WEB_ORIGIN` | `http://BIND:PORT` | Public origin users open. Requests for any other host are rejected. |
| `FERRY_WEB_DATA` | `~/.local/share/ferry/web` | Pairing credentials. |
| `FERRY_HOST_URL` + `FERRY_HOST_TOKEN` | — | Optional primary host. Without them, Ferry uses paired machines only. |
| `FERRY_EXTRA_HOSTS` | `[]` | Static extra hosts: `[{"id":"lab","url":"http://…:8788","token":"…"}]`. |
| `FERRY_TAILSCALE_LOGIN` | — | Trust the `Tailscale-User-Login` header from `tailscale serve` for this login instead of an access code. Requires loopback bind and an HTTPS origin. |

**Multiple agent accounts.** To read quota for extra login directories, place a `quota-profiles.json` file in the host data directory:

```json
{
  "codex": [{ "name": "Work", "directory": "/home/me/.codex-work" }],
  "claude": [{ "name": "Personal", "directory": "/home/me/.claude-personal", "executable": "/usr/local/bin/claude" }]
}
```

## Security

Ferry runs agents **without per-action approval prompts**: Claude Code in `bypassPermissions` mode, Codex with `approvalPolicy: never` inside the sandbox configured on the host, and Antigravity in always-proceed mode. Anyone who can sign in to the Web service can run commands on your hosts.

- Keep both services on a private network or behind HTTPS. Hosts speak plain HTTP.
- Use long random secrets; `npm run setup` generates them.
- Hosts only start agents with the credentials already present on that machine. Ferry never stores model API keys.

## Development

```sh
npm run check   # syntax check
npm test        # integration tests with fake agent CLIs, no accounts needed
```

The code is small on purpose:

| Path | Purpose |
| --- | --- |
| `src/agents.mjs` | Native adapters for Codex, Claude Code and Antigravity |
| `src/host.mjs` | Execution host: API, turn runner, SSE event stream |
| `src/web.mjs` | Web service: sign-in, relay, pairing |
| `src/db.mjs` | SQLite schema (`node:sqlite`) |
| `public/` | The UI: vanilla JS with no build step. Translations are in `public/i18n.js` |

Contributions are welcome, especially adapter updates for new CLI releases and new languages.

## License

[MIT](../LICENSE)
