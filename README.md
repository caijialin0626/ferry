<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo-light.svg" alt="Ferry" width="220">
</picture>

Ferry brings the **native Codex, Claude Code, and Antigravity CLIs** to your browser. Pick up a chat on your phone and the agent keeps working on your machine with the same project instructions, skills, and tools.

**AI-friendly deployment** starts here. An agent can choose one of the three commands below and use the terminal output to sign in or pair a host.

[简体中文](README.zh-CN.md) · [Deployment guide](docs/deployment.md) · [MIT](LICENSE)

> **If you’re an agent deploying Ferry**, use the machines and ports the user requested. Run `all` on one machine, or run `host` and `web` on their respective machines. Verify each service you started and tell the user how to connect and stop it.

Install Git, npm, and Node.js 22.20+ on each machine. The execution host also needs a signed-in agent CLI.

**Start both** · The Web service connects to the local host automatically.

```sh
npx --yes github:caijialin0626/ferry#main all --web-port 8787 --host-port 8788
```

**Execution host only** · Replace the example IP with the host’s private address reachable from the Web server.

```sh
npx --yes github:caijialin0626/ferry#main host --bind 192.168.1.20 --port 8788
```

**Web only** · Replace the example IP with the Web server’s private address reachable from your browser.

```sh
npx --yes github:caijialin0626/ferry#main web --bind 192.168.1.10 --port 8787
```

Change the port numbers as needed, or omit the flags to use the defaults shown. Open the URL printed by Web and sign in with the code from the indicated file. For a split deployment, open **Machines → Add machine** and enter the host URL and its printed 8-digit pairing code.

![A browser connects to Ferry Web, which relays requests to the execution host. The host runs the native agent CLI and stores chat history in SQLite.](docs/assets/route.svg)

## Design principles

- **Quick to use, quick to change.** Start with one command and switch chats with `⌘K` or `Ctrl+K`. Small CLI adapters make upstream changes easier to follow. We’re considering using AI to triage issues and keep the adapters up to date.
- **Carry the native harness.** Ferry forwards instructions through the Codex App Server and the other CLIs’ native `stream-json` interfaces without adding a system prompt.
- **Remote from the start.** Web handles sign-in and relays requests. Each host runs its agents and keeps its chat history. Deploy both on one machine or put them on separate machines.

## Pick up where you left off

- **Steer a live session.** Follow replies and tool calls, add guidance mid-turn, or answer the agent’s questions. Reconnecting replays the events you missed.
- **Switch machines.** Pair another host with a one-time code and pick its projects from the sidebar. Each host uses its own models, skills, and MCP configuration.
- **Explore a side question.** Fork a conversation or open a read-only side chat while the main task runs.

The combined command binds to loopback by default. For phone access or multiple machines, see the [remote deployment guide](docs/deployment.md#connect-from-another-device). Anyone who can sign in can run commands on the host without per-action approval.
