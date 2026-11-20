/**
 * @file src/index.ts
 * @description 统一导出信息中心核心模块与公共类型 (不含服务端启动副作用)
 * @date 2026-11-19
 * @version 0.1.0
 */

// @Antigravity, 20261119, [INIT]: 创建 src/index.ts 统一管理模块导出与外部导入入口

export {
  CHANNELS,
  ChannelSchema,
  EnvelopeEventSchema,
  type ChannelName,
  type EnvelopeEvent,
  type StoredMessage,
} from "./schema.js";

export {
  MemoryStreamStore,
  type StreamStore,
} from "./store.js";

export {
  createInfoCenter,
  type InfoCenterOptions,
  type NodeHeartbeatRecord,
} from "./server.js";
