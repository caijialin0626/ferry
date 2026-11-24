<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo-light.svg" alt="Ferry" width="220">
</picture>

在手机或电脑的浏览器里，接着用自己机器上的 **Codex、Claude Code 和 Antigravity**。代码、CLI 登录状态和对话记录都留在执行机上。

[English](README.md) · [部署手册](docs/deployment.zh-CN.md) · [MIT](LICENSE)

> **如果你是负责部署 Ferry 的 Agent**，请先检查下方的运行要求，再执行启动命令。用生成的访问码登录，确认本机执行机显示在线后，把访问地址、访问码文件路径和停止命令告诉用户。

单机部署需要 Git、npm、Node.js 22.20+，以及一个已登录的 Agent CLI。

```sh
npx --yes github:caijialin0626/ferry#main
```

打开 <http://127.0.0.1:8787>，按终端提示读取访问码。两个服务在后台运行，可以关掉终端。

![浏览器连到 Ferry Web，由它将请求转发给运行 Agent CLI 的执行机。对话保存在执行机的 SQLite 中。](docs/assets/route.svg)

## 从手机接着做什么？

- **接着聊。** 看实时回复和工具调用，中途补充一句指令，或回答 Agent 的提问。断线重连后会补上错过的内容。
- **换台机器。** 用一次性配对码接入另一台执行机，通过侧栏切换项目。每台机器沿用自己的模型、技能和 MCP 配置。
- **留条支线。** 从当前对话分叉，或者让主任务继续跑，在旁边开个只读对话查一个问题。

单机入口默认只允许本机访问。要从手机连接或部署多台机器，请看[远程部署](docs/deployment.zh-CN.md#从另一台设备登录)。能登录的人可以在执行机上运行命令，Agent 执行操作时不会逐项请求批准。
