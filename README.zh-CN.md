<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Ferry" width="240">
  </picture>
</p>

<p align="center"><strong>把你机器上的编码 Agent，原样渡到任何屏幕。</strong></p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center"><img src="docs/assets/banner.jpg" alt="一艘渡船载着终端提示符，从笔记本驶向手机" width="100%"></p>

Ferry（渡）让你在任何浏览器里驱动自己机器上已经装好的 Agent CLI，手机也可以。目前支持 **Codex**、**Claude Code** 和 **Antigravity**。Ferry 用各家的原生协议运行 Agent，中间不加任何东西。

## 设计理念

**1. 快：用起来快，迭代也快。**
一条命令完成配置，`⌘K` 在项目和对话之间切换。回复流式显示，Agent 执行中途也能发送引导。代码是纯 Node.js，运行时依赖只有两个，没有框架，也不需要构建。每个适配器都只做一层很薄的协议转换，CLI 发了新版本，跟进只需要改一小段。下一步计划让 AI 自动处理 issue，并自动跟进上游 Agent CLI 的版本更新。

**2. 用各家 harness 的原生能力，不加多余的 prompt。**
我们不生产 harness，只做 harness 的搬运工。Ferry 直接对接 Codex App Server，以及 Claude Code 和 Antigravity 的 `stream-json` 接口，不注入 system prompt，不包装指令，也不加额外工具。你的 `AGENTS.md` / `CLAUDE.md`、skills、MCP、模型、登录状态和沙箱配置，跟在终端里用时完全一样。唯一的例外是附加视频：没有 CLI 能原生接收视频，Ferry 会把视频在执行机上的文件路径附在消息末尾。

**3. 原生支持远程，前后端分离部署。**
Web 服务和执行机分开部署。Web 服务不存任何对话，只提供界面和转发请求。执行机和 Agent CLI 在同一台机器上运行，对话记录保存在本机的 SQLite 里。多台机器用一次性验证码配对加入，在同一个侧栏里管理。浏览器断线重连后，Ferry 会补发断线期间错过的事件。

## 功能

- **项目和独立对话**：可以绑定任意机器上的任意文件夹，支持置顶、归档、重命名和 `⌘K` 快速切换。
- **实时轮次**：回复流式显示，工具操作按出现顺序展示。可以随时停止，也可以在执行中途发送“引导”（Codex 用 `turn/steer`，Claude Code 用 stream 输入）。
- **原生提问**：Agent 向你提问时（Claude Code 的 `AskUserQuestion`、Codex 的 `requestUserInput`），会显示成表单，你的回答直接回传给 Agent。
- **图片和视频**：每条消息最多附加 6 张图片。Agent 生成的图片和项目内引用的图片会直接预览。
- **分叉和侧边聊天**：通过各家原生的分叉能力复制出新对话，也可以在主对话运行时开一个只读的侧边聊天提问。
- **定时任务**：按时间给某个对话发送一次任务，或按间隔重复发送。
- **账号额度**：查看每台机器上 Codex、Claude Code、Antigravity 原生账号的用量窗口。
- **共享 Codex 会话**：本机的 Codex 桌面端开着 App Server 时，Ferry 会直接连上它，同一个会话在两边都能继续。
- **轮次结束通知**，界面支持中英双语。

## 工作原理

```
 浏览器（电脑 · 平板 · 手机）
        │  HTTPS 或私有网络
        ▼
 Web 服务 ─ 界面、登录、转发、配对凭据（不存对话）
        │  HTTP + Bearer 令牌
        ├──────────────────┬──────────────────┐
        ▼                  ▼                  ▼
 执行机 · macOS       执行机 · Linux       执行机 · …    ← 每台机器一个，SQLite
        │  原生协议
        ▼
 Codex App Server · Claude Code（stream-json）· Antigravity CLI（stream-json）
```

## 快速开始（单机）

需要 **Node.js 22.20+**，并且至少装好一个 Agent CLI 且已登录：`codex`、`claude` 或 `agy`。在 macOS 上，Ferry 也会自动找到 ChatGPT 和 Codex 桌面版自带的 Codex 程序。

```sh
git clone https://github.com/caijialin0626/ferry.git && cd ferry
npm install
npm run setup     # 生成 host.env 和 web.env（随机密钥），并打印访问码
npm run host      # 终端 1
npm run web       # 终端 2
```

打开 <http://127.0.0.1:8787>，输入访问码，选一个文件夹就可以开始对话。

## 远程部署

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

[MIT](LICENSE)
