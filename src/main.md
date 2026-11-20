<!--
@file src/main.md
@description src/main.ts 伴生澄清文档
@date 2026-11-19
@version 0.1.0
-->

# `src/main.ts` 技术设计说明

## 1. 技术设计要点

- **HTTP 服务适配器**: 使用 `@hono/node-server` 的 `serve` 将 `createInfoCenter()` 返回的 `infoCenter.app.fetch` 挂载到 Node.js HTTP 服务器.
- **监听地址与端口**:
  - 默认绑定 `0.0.0.0:3200`.
  - 支持 `INFO_CENTER_HOST` (或 `HOST`) 与 `INFO_CENTER_PORT` (或 `PORT`, 范围 `1..65535`) 环境变量覆盖.
- **巡检与心跳超时配置**:
  - `createInfoCenter()` 工厂函数内部继续保持 `patrolIntervalMs` 默认关闭 (`0`, 仅手动调用 `runPatrolOnce`), 以确保单元测试隔离.
  - `src/main.ts` 作为服务端运行入口, 默认设置 `patrolIntervalMs = 60000` (60 秒), 支持通过 `INFO_CENTER_PATROL_INTERVAL_MS` 覆盖 (设为 `0` 可关闭自动巡检).
  - `heartbeatTimeoutMs` 默认为 `3 * 24 * 60 * 60 * 1000` (3 天), 支持通过 `INFO_CENTER_HEARTBEAT_TIMEOUT_MS` 覆盖.
- **优雅退出**: 监听 `SIGINT` 与 `SIGTERM`, 防止重复触发后先调用 `infoCenter.shutdown()` 清理巡检定时器, 再调用 `server.close()` 关闭监听套接字.

## 2. 变更记录流水

- `@Antigravity, 20261119, [INIT]`: 新建 `src/main.ts` 服务端启动入口, 接入 `@hono/node-server`, 环境变量配置解析及优雅退出逻辑.
- `@Antigravity, 20261119, [REFACTOR]`: 将 `src/main.ts` 的内部导入收敛至 `./index.js`.
