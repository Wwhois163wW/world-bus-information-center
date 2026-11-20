<!--
@file docs/development-progress.md
@description World Bus 信息中心开发进度与里程碑跟踪文档
@date 2026-11-20
@version 0.1.0
-->

# World Bus Information Center 开发进度文档

- **当前版本**: `0.1.0`
- **当前阶段**: MVP 内存版服务端与契约测试基线已完成
- **最近一次验证**: 2026-11-19 (`npm run typecheck`, `npm run build`, `npm test` 全部退出码 0, [info-center.test.ts](file:///c:/codeSpace/world-bus-information-center/tests/info-center.test.ts) `3/3` 通过)

---

## 1. 功能与工程进度总览

| 模块 / 任务项 | 状态 | 对应产物 | 备注 |
| --- | --- | --- | --- |
| 频道白名单与信封 Schema 契约 | 已完成 | [src/schema.ts](file:///c:/codeSpace/world-bus-information-center/src/schema.ts) | 4 个频道枚举, Zod v3 信封校验 |
| `StreamStore` 接口与内存实现 | 已完成 | [src/store.ts](file:///c:/codeSpace/world-bus-information-center/src/store.ts) | 支持消费组隔离, PEL 重投与 `/ack` |
| Hono 路由与心跳巡检核心 | 已完成 | [src/server.ts](file:///c:/codeSpace/world-bus-information-center/src/server.ts) | `/health`, 发信, `/poll`, `/ack`, `runPatrolOnce` |
| Node.js HTTP 启动入口 | 已完成 | [src/main.ts](file:///c:/codeSpace/world-bus-information-center/src/main.ts), [src/main.md](file:///c:/codeSpace/world-bus-information-center/src/main.md) | `@hono/node-server`, 环境变量与优雅退出 |
| 统一模块导出门面 | 已完成 | [src/index.ts](file:///c:/codeSpace/world-bus-information-center/src/index.ts), [src/index.md](file:///c:/codeSpace/world-bus-information-center/src/index.md) | 无启动副作用导出 `schema`, `store`, `server` |
| 工程构建与类型检查配置 | 已完成 | [package.json](file:///c:/codeSpace/world-bus-information-center/package.json), [tsconfig.json](file:///c:/codeSpace/world-bus-information-center/tsconfig.json), [tsconfig.test.json](file:///c:/codeSpace/world-bus-information-center/tsconfig.test.json) | ESM `NodeNext`, 输出 `dist/*.js` 与 `.d.ts` |
| 单元测试套件 | 已完成 | [tests/info-center.test.ts](file:///c:/codeSpace/world-bus-information-center/tests/info-center.test.ts) | 覆盖契约校验, PEL 重投, 心跳超时告警 |
| 工作区规范与项目文档 | 已完成 | [GEMINI.md](file:///c:/codeSpace/world-bus-information-center/GEMINI.md), [README.md](file:///c:/codeSpace/world-bus-information-center/README.md), [.gitignore](file:///c:/codeSpace/world-bus-information-center/.gitignore) | 已补齐 API 需求, 架构设计, 进度文档 |
| 既有源码伴生澄清文档补齐 | 待开始 | `src/schema.md`, `src/store.md`, `src/server.md` | 已有源码早于 `GEMINI.md` 规范建立, 尚未补齐 |
| 入口环境变量与优雅退出测试 | 待开始 | - | 当前测试仅覆盖 `createInfoCenter()`, 未覆盖 `main.ts` |
| Redis Streams 持久化 `StreamStore` | 规划中 | - | 替代内存队列以支持重启恢复与多实例部署 |
| 安全鉴权与 PEL 超时接管 (Claim) | 规划中 | - | 节点身份校验, 跨消费组权限控制与死信处理 |

---

## 2. 已达成里程碑明细

### 里程碑 M1: 核心邮局契约与内存原型 (已完成)

1. 建立 [src/schema.ts](file:///c:/codeSpace/world-bus-information-center/src/schema.ts), 固定 `CHANNELS` 白名单与 `EnvelopeEventSchema`.
2. 建立 [src/store.ts](file:///c:/codeSpace/world-bus-information-center/src/store.ts), 通过 `MemoryStreamStore` 模拟 Redis Stream 消费组投递隔离与 PEL 状态机.
3. 建立 [src/server.ts](file:///c:/codeSpace/world-bus-information-center/src/server.ts), 提供 4 个 HTTP 接口及 `runPatrolOnce` 超时告警机制.
4. 建立 [tests/info-center.test.ts](file:///c:/codeSpace/world-bus-information-center/tests/info-center.test.ts), 验证以下 3 项核心用例:
   - 非法频道与非法信封返回 `400` 拒绝.
   - 定向消息跨消费组隔离, 过滤自身发信, 未 `/ack` 经 `includePending=true` 重投及 `/ack` 后不可重投.
   - 节点心跳超时触发 `NODE_HEARTBEAT_TIMEOUT` (`wake: true`) 投递至 `stream:order_events`.

### 里程碑 M2: 工程化与服务端交付骨架 (已完成)

1. 创建 [package.json](file:///c:/codeSpace/world-bus-information-center/package.json), 锁定 `hono`, `@hono/node-server`, `zod` (`^3.24.2`) 及开发工具链 (`typescript`, `vitest`, `tsx`, `@types/node`).
2. 分离 [tsconfig.json](file:///c:/codeSpace/world-bus-information-center/tsconfig.json) (`rootDir: "src"`, `declaration: true`) 与 [tsconfig.test.json](file:///c:/codeSpace/world-bus-information-center/tsconfig.test.json) (`rootDir: "."`, `noEmit: true`).
3. 实现 [src/main.ts](file:///c:/codeSpace/world-bus-information-center/src/main.ts) 启动入口与 [src/index.ts](file:///c:/codeSpace/world-bus-information-center/src/index.ts) 统一导出门面, 默认监听 `0.0.0.0:3200`, 定时巡检 `60000ms`, 心跳超时 3 天, 支持环境变量覆盖.
4. 补齐工作区规范 [GEMINI.md](file:///c:/codeSpace/world-bus-information-center/GEMINI.md), [README.md](file:///c:/codeSpace/world-bus-information-center/README.md), [.gitignore](file:///c:/codeSpace/world-bus-information-center/.gitignore) 与架构/API/进度文档.

---

## 3. 近期后续工作建议 (Next Steps)

1. **P0 (稳定性与规范补齐)**:
   - 补充 `src/main.ts` 环境变量边界解析测试与 HTTP 端到端冒烟测试 (`0.0.0.0:3200` / 随机端口).
   - 为早期已有文件 `src/schema.ts`, `src/store.ts`, `src/server.ts` 补齐同级伴生文档 (`.md`), 使全仓库源码与 `GEMINI.md` 规范完全对齐.
2. **P1 (生产持久化扩展)**:
   - 基于 `StreamStore` 接口新增 `RedisStreamStore` 实现, 持久化消息流, 消费组偏移与 PEL.
   - 增加 `MemoryStreamStore` 容量上限 / 已签收集合清理策略, 防止长期运行内存膨胀.
3. **P2 (可靠性与治理)**:
   - 引入接口鉴权与节点身份校验.
   - 完善结构化日志与监控指标 (如各消费组 PEL 积压数量, 超时节点计数).
