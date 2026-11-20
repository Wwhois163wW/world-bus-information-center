<!--
@file README.md
@description World Bus 信息中心邮局服务说明文档
@date 2026-11-19
@version 0.1.0
-->

# World Bus Information Center

World Bus 信息中心邮局服务, 基于 TypeScript (ESM), Hono 与 Zod v3 构建, 提供显式频道白名单校验, 标准事件信封 Schema 校验, 消费组 (Consumer Group) 隔离投递与 PEL 签收, 以及节点心跳超时自律巡检.

## 1. 目录结构

```text
world-bus-information-center/
├── src/
│   ├── index.ts           # 统一导出公共 API 与类型 (无启动副作用)
│   ├── index.md           # src/index.ts 伴生设计说明
│   ├── schema.ts          # 频道白名单与 EnvelopeEvent Zod Schema 定义
│   ├── store.ts           # StreamStore 接口与 MemoryStreamStore 内存实现
│   ├── server.ts          # createInfoCenter 工厂与 Hono HTTP 路由定义
│   ├── main.ts            # 服务端启动入口 (@hono/node-server)
│   └── main.md            # src/main.ts 伴生设计说明
├── tests/
│   └── info-center.test.ts # Vitest 单元测试
├── docs/
│   ├── api-requirements.md     # API 需求规格文档
│   ├── architecture.md         # 架构设计文档
│   ├── development-progress.md # 开发进度与里程碑文档
│   └── dialog/                 # 会话工作日志
├── package.json
├── tsconfig.json          # 源码编译配置 (rootDir: src, outDir: dist)
├── tsconfig.test.json     # 覆盖 src 与 tests 的类型检查配置
├── GEMINI.md              # 工作区开发与文档规范
├── Dockerfile.example     # Docker 多阶段构建示例文件
├── .dockerignore          # Docker 构建上下文忽略规则
└── .gitignore
```

## 2. 快速开始

### 安装依赖

```bash
npm install
```

### 运行与构建脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 使用 `tsx` 直接以开发模式运行 `src/main.ts` |
| `npm run build` | 使用 `tsc` 将 `src/` 编译输出至 `dist/` |
| `npm start` | 运行编译后的 `dist/main.js` |
| `npm run typecheck` | 执行 `tsc -p tsconfig.test.json --noEmit` 进行全量类型检查 |
| `npm test` | 执行 `vitest run` 运行单元测试 |
| `npm run test:watch` | 以监听模式运行 Vitest 测试 |

## 3. 环境变量配置 (`src/main.ts`)

`createInfoCenter()` 工厂函数内部默认不开启后台巡检定时器 (`patrolIntervalMs = 0`), 以便单元测试精确控制; 服务端入口 `src/main.ts` 默认配置如下:

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `INFO_CENTER_HOST` / `HOST` | `0.0.0.0` | HTTP 服务绑定地址 |
| `INFO_CENTER_PORT` / `PORT` | `3200` | HTTP 监听端口 (`1..65535`) |
| `INFO_CENTER_PATROL_INTERVAL_MS` | `60000` | 心跳超时巡检间隔毫秒数 (`0` 表示关闭定时巡检) |
| `INFO_CENTER_HEARTBEAT_TIMEOUT_MS` | `259200000` | 节点心跳超时阈值毫秒数 (默认 3 天, `3 * 24 * 60 * 60 * 1000`) |

## 4. 频道与信封契约

### 允许的频道 (`CHANNELS`)

- `stream:orders`
- `stream:order_events`
- `stream:reports`
- `stream:heartbeat`

### 信封格式 (`EnvelopeEventSchema`)

支持通过 `.passthrough()` 保留扩展字段, 核心字段如下:

- `id` (`string`, 必填, 非空)
- `ts` (`string`, 必填, 非空)
- `source` (`string`, 必填, 非空)
- `target` (`string`, 默认 `"*"`)
- `type` (`string`, 必填, 非空)
- `prompt` (`string`, 必填, 非空)
- `wake` (`boolean`, 默认 `false`)
- `responseMode` (`"optional" | "respond" | "tool_required"`, 默认 `"optional"`)
- `outbound` (`boolean`, 默认 `true`)
- `payload` (`Record<string, unknown>`, 默认 `{}`)

## 5. HTTP 接口说明

### `GET /health`

返回服务健康状态, 各频道消息总数 (`streams`) 与已跟踪节点列表 (`trackedNodes`).

### `POST /channels/:channel/messages`

向指定频道投递消息:

- 校验 `:channel` 是否在 `CHANNELS` 白名单内, 以及请求体是否符合 `EnvelopeEventSchema`.
- 若投递至 `stream:heartbeat`, 自动刷新对应 `source` 节点的 `lastSeenAt` 并清除 `alerted` 告警标记.
- 成功返回 `201`: `{ "ok": true, "messageId": "...", "channel": "..." }`.

### `GET /poll`

按消费组拉取未签收消息:

- 必填查询参数: `nodeId`, `consumerGroup`, `channels` (多个频道以 `,` 分隔).
- 可选查询参数: `includePending=true` (重新拉取本消费者尚未 `/ack` 的 PEL 消息).
- 投递隔离规则: 自动跳过发件人自身 (`source === nodeId`) 的消息, 仅投递 `target === nodeId` 或广播 `target === "*"` 的消息; 首次投递写入该消费组 PEL, 防止同组并发重复消费.

### `POST /ack`

签收消息并移出消费组 PEL:

- 请求体 JSON: `{ "consumerGroup": "...", "channel": "...", "messageId": "..." }`.
- 返回 `200`: `{ "ok": true, "acked": true | false }`.

## 6. 心跳超时巡检行为

巡检执行时 (`runPatrolOnce` 或定时巡检), 若某已注册节点尚未触发过告警且 `now - lastSeenAt > heartbeatTimeoutMs`, 信息中心会自动向 `stream:order_events` 投递一条 `type: "NODE_HEARTBEAT_TIMEOUT"` 的告警信封 (`source: "info.center"`, `target: "leadership.center"`, `wake: true`, `responseMode: "respond"`).

## 7. Docker 托管示例

项目提供多阶段构建示例 [Dockerfile.example](Dockerfile.example) 与 [.dockerignore](.dockerignore), 可按需复制或直接指定 `-f Dockerfile.example` 构建运行:

```bash
docker build -f Dockerfile.example -t world-bus-information-center:0.1.0 .
docker run -d --name world-bus-info-center -p 3200:3200 world-bus-information-center:0.1.0
```

## 8. 项目文档

- [API 需求文档](docs/api-requirements.md)
- [架构设计文档](docs/architecture.md)
- [开发进度文档](docs/development-progress.md)
