<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo-light.svg" alt="Ferry" width="220">
</picture>

Use **Codex, Claude Code, and Antigravity** from a browser on your phone or desktop. Your code, CLI logins, and chat history stay on the machine running the agent.

[简体中文](README.zh-CN.md) · [Deployment guide](docs/deployment.md) · [MIT](LICENSE)

> **If you’re an agent deploying Ferry**, check the requirements below and run the quick-start command. Sign in with the generated access code and verify that the local host is online. Give the user the URL, the path to the access code, and the command to stop Ferry.

The single-machine quick start requires Git, npm, Node.js 22.20+, and one signed-in agent CLI.

```sh
npx --yes github:caijialin0626/ferry#main
```

Open <http://127.0.0.1:8787> and read the access code from the file shown in your terminal. Both services run in the background, so you can close the terminal.

![A browser connects to Ferry Web, which relays requests to the execution host. The host runs the native agent CLI and stores chat history in SQLite.](docs/assets/route.svg)

## Pick up where you left off

- **Steer a live session.** Follow replies and tool calls, add guidance mid-turn, or answer the agent’s questions. Reconnecting replays the events you missed.
- **Switch machines.** Pair another host with a one-time code and pick its projects from the sidebar. Each host uses its own models, skills, and MCP configuration.
- **Explore a side question.** Fork a conversation or open a read-only side chat while the main task runs.

The quick start listens on loopback. For phone access or multiple machines, see the [remote deployment guide](docs/deployment.md#connect-from-another-device). Anyone who can sign in can run commands on the host without per-action approval.
