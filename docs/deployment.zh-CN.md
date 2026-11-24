# 部署手册

[返回首页](../README.zh-CN.md)

## 单机运行

首页的命令通过 GitHub 安装 Ferry，在后台启动本机服务。需要 Git、npm、Node.js 22.20 或更新版本，以及至少一个已登录的 Agent CLI。浏览器和执行机接口分别监听回环端口 8787 和 8788。

访问码保存在 `~/.local/share/ferry/local/access-code`，启动日志在同目录的 `startup.log`。再次启动会复用凭据。用启动时打印的 `kill` 命令停止服务。机器重启后重新运行首页命令即可。如需交给进程管理器，克隆仓库后运行 `npm ci`，以 `npm start` 作为前台服务命令。

单机模式将对话、配对信息和凭据保存在同一个 `local` 目录。如果设置了 `XDG_DATA_HOME`，则使用该目录下的 `ferry/local`。

## 从另一台设备登录

如果执行机已开启 SSH，在客户端建立本地端口转发，并保持 SSH 连接打开。将 `user@machine` 换成执行机的 SSH 地址。

```sh
ssh -N -L 127.0.0.1:8787:127.0.0.1:8787 user@machine
```

在客户端浏览器打开 <http://127.0.0.1:8787>。手机上的 SSH 客户端也可以配置相同的本地端口转发。

## 跨机器部署

使用[首页的独立启动命令](../README.zh-CN.md)：在装有 CLI 的机器运行 `host`，在提供网页的机器运行 `web`。用 `--port` 选端口，`--bind` 选本机监听 IP。Web 在 HTTPS 反向代理后面时，用 `--origin https://ferry.example.com` 指定浏览器使用的地址。

执行机启动时会打印 10 分钟内有效的单次配对码。如果过期，在执行机上运行 `npx --yes github:caijialin0626/ferry#main pair` 即可重新生成。两端都支持 `--foreground`，供进程管理器使用。

### 使用 Docker 或手动配置

以下命令在仓库根目录运行。将示例中的占位密钥替换为随机值（可用 `openssl rand -hex 32` 生成）。

**Web 服务**可以部署在任意服务器上；每台装有 Agent CLI 的机器上运行一个**执行机**。两者之间可以走 Tailscale、WireGuard、局域网等私有网络，也可以在前面加一层 HTTPS。

**Web 服务（Docker）：**

```sh
cp web.env.example web.env   # 设置 FERRY_WEB_LOGIN_TOKEN 和 FERRY_WEB_ORIGIN
docker compose up -d --build
```

**每台执行机：**

```sh
cp host.env.example host.env # 设置 FERRY_HOST_TOKEN，并绑定私有地址，例如 FERRY_HOST_BIND=100.x.y.z
npm install && npm run host
```

**配对执行机**：在执行机上运行 `npm run pair`，获取一个 8 位一次性验证码，10 分钟内有效。然后在网页里打开 **执行机器 → 添加执行机**，填入执行机地址（例如 `http://100.x.y.z:8788`）和验证码。Web 服务会为这台机器保存独立的凭据，执行机上只保存凭据的哈希。

想让执行机在后台常驻，可以用 launchd（macOS）、systemd（Linux）或其他进程管理工具，在仓库目录里运行 `npm run host`。

## 配置

所有配置都是环境变量。`npm run host`、`npm run pair` 和 `npm run web` 会自动读取 `host.env` / `web.env`。

**执行机**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FERRY_HOST_TOKEN` | —（必填） | 共享密钥（至少 24 位），供配置了 `FERRY_HOST_URL` 的 Web 服务使用。 |
| `FERRY_HOST_BIND` | `127.0.0.1` | 监听地址。Web 服务部署在别处时，改成私有网络地址。 |
| `FERRY_HOST_PORT` | `8788` | 监听端口。 |
| `FERRY_HOST_DATA` | `~/.local/share/ferry/host` | SQLite 数据库、附件和配对凭据的位置。运行 `npm run pair` 时要用同一个值。 |
| `FERRY_CODEX_BIN` / `FERRY_CLAUDE_BIN` / `FERRY_AGY_BIN` | 自动查找 | Agent CLI 的路径。 |
| `FERRY_CODEX_APP_SERVER_SOCKET` | `$CODEX_HOME/app-server-control/app-server-control.sock` | 共享 Codex App Server 的套接字。 |
| `FERRY_CLAUDE_HISTORY_DIR` | `$CLAUDE_CONFIG_DIR/projects` | Claude Code 原生记录目录，用来恢复旧回复。 |

**Web 服务**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FERRY_WEB_LOGIN_TOKEN` | —（必填） | 浏览器访问码（至少 24 位）。Tailscale 模式下不需要。 |
| `FERRY_WEB_BIND` / `FERRY_WEB_PORT` | `127.0.0.1` / `8787` | 监听地址和端口。 |
| `FERRY_WEB_ORIGIN` | `http://BIND:PORT` | 用户实际访问的地址，其他 Host 的请求会被拒绝。 |
| `FERRY_WEB_DATA` | `~/.local/share/ferry/web` | 配对凭据的位置。 |
| `FERRY_HOST_URL` + `FERRY_HOST_TOKEN` | — | 可选的主执行机。不配置时只使用配对加入的机器。 |
| `FERRY_EXTRA_HOSTS` | `[]` | 静态配置的额外执行机：`[{"id":"lab","url":"http://…:8788","token":"…"}]`。 |
| `FERRY_TAILSCALE_LOGIN` | — | 信任 `tailscale serve` 传来的 `Tailscale-User-Login` 头，只允许这个账号访问，不再使用访问码。要求监听回环地址，且 Origin 是 HTTPS。 |

**多个 Agent 账号**：想查看其他登录目录的额度，可以在执行机的数据目录里放一个 `quota-profiles.json`：

```json
{
  "codex": [{ "name": "工作", "directory": "/home/me/.codex-work" }],
  "claude": [{ "name": "个人", "directory": "/home/me/.claude-personal", "executable": "/usr/local/bin/claude" }]
}
```

## 安全

Ferry 运行 Agent 时**不逐次请求批准**：Claude Code 使用 `bypassPermissions` 模式，Codex 使用 `approvalPolicy: never` 并沿用执行机上配置的沙箱，Antigravity 使用 always-proceed 模式。任何能登录 Web 服务的人，都能在你的执行机上执行命令。

- 两个服务都应放在私有网络里，或者加 HTTPS。执行机本身只提供 HTTP。
- 使用足够长的随机密钥，`npm run setup` 会自动生成。
- 执行机只用本机上已有的凭据启动 Agent，Ferry 不保存任何模型 API Key。

## 开发

```sh
npm run check   # 语法检查
npm test        # 集成测试，使用模拟的 Agent CLI，不需要任何账号
```

代码量刻意保持精简：

| 路径 | 作用 |
| --- | --- |
| `src/agents.mjs` | Codex、Claude Code、Antigravity 的原生适配器 |
| `src/host.mjs` | 执行机：API、轮次执行、SSE 事件流 |
| `src/web.mjs` | Web 服务：登录、转发、配对 |
| `src/db.mjs` | SQLite 表结构（`node:sqlite`） |
| `public/` | 界面：原生 JS，不需要构建。翻译在 `public/i18n.js` |

欢迎贡献，特别是跟进 CLI 新版本的适配器更新，以及新的界面语言。

## 许可证

[MIT](../LICENSE)
