/**
 * @file src/main.ts
 * @description World Bus 信息中心 HTTP 服务端启动入口
 * @date 2026-11-19
 * @version 0.1.0
 */

// @Antigravity, 20261119, [INIT]: 创建信息中心服务端启动入口, 支持环境变量配置与优雅退出

import { serve } from "@hono/node-server";
// @Antigravity, 20261119, [REFACTOR]: 改为通过统一导出入口 ./index.js 导入核心模块
// import { createInfoCenter } from "./server.js";
// import { MemoryStreamStore } from "./store.js";
import { createInfoCenter, MemoryStreamStore } from "./index.js";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3200;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_PATROL_INTERVAL_MS = 60_000;

/**
 * 从环境变量解析非负整数配置; 未设置或为空字符串时返回默认值.
 */
function parseNonNegativeIntEnv(
  envName: string,
  fallback: number
): number {
  const raw = process.env[envName];
  if (
    raw === undefined
    || raw.trim() === ""
  ) {
    return fallback;
  }

  const parsed = Number(raw.trim());
  if (
    !Number.isInteger(parsed)
    || parsed < 0
  ) {
    throw new Error(
      `Invalid environment variable ${envName}: "${raw}". `
      + "Expected a non-negative integer."
    );
  }

  return parsed;
}

/**
 * 解析监听端口配置, 优先读取 INFO_CENTER_PORT, 其次 PORT.
 */
function resolvePort(fallback: number): number {
  const candidates = ["INFO_CENTER_PORT", "PORT"] as const;

  for (const envName of candidates) {
    const raw = process.env[envName];
    if (
      raw === undefined
      || raw.trim() === ""
    ) {
      continue;
    }

    const parsed = Number(raw.trim());
    if (
      !Number.isInteger(parsed)
      || parsed < 1
      || parsed > 65535
    ) {
      throw new Error(
        `Invalid environment variable ${envName}: "${raw}". `
        + "Expected an integer between 1 and 65535."
      );
    }

    return parsed;
  }

  return fallback;
}

const host = (
  process.env.INFO_CENTER_HOST?.trim()
  || process.env.HOST?.trim()
  || DEFAULT_HOST
);
const port = resolvePort(DEFAULT_PORT);
const heartbeatTimeoutMs = parseNonNegativeIntEnv(
  "INFO_CENTER_HEARTBEAT_TIMEOUT_MS",
  DEFAULT_HEARTBEAT_TIMEOUT_MS
);
const patrolIntervalMs = parseNonNegativeIntEnv(
  "INFO_CENTER_PATROL_INTERVAL_MS",
  DEFAULT_PATROL_INTERVAL_MS
);

const store = new MemoryStreamStore();
const infoCenter = createInfoCenter({
  store,
  heartbeatTimeoutMs,
  patrolIntervalMs,
});

const server = serve(
  {
    fetch: infoCenter.app.fetch,
    hostname: host,
    port,
  },
  (info) => {
    console.log(
      `[info-center] Listening on http://${info.address}:${info.port} `
      + `(heartbeatTimeoutMs=${heartbeatTimeoutMs}, `
      + `patrolIntervalMs=${patrolIntervalMs})`
    );
  }
);

let isShuttingDown = false;

/**
 * 响应进程退出信号, 停止巡检定时器并关闭 HTTP 服务.
 */
function handleShutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`[info-center] Received ${signal}, shutting down...`);
  infoCenter.shutdown();

  server.close((err) => {
    if (err) {
      console.error("[info-center] Error while closing server:", err);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
