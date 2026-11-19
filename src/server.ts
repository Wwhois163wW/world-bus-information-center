import { Hono } from "hono";
import { z } from "zod";
import { ChannelSchema, EnvelopeEventSchema, type ChannelName } from "./schema.js";
import type { StreamStore } from "./store.js";

export interface NodeHeartbeatRecord {
  nodeId: string;
  lastSeenAt: number;
  lastPayload: Record<string, unknown>;
  alerted: boolean;
}

export interface InfoCenterOptions {
  store: StreamStore;
  /** 心跳超时阈值毫秒数（默认 3 天 = 259200000ms，测试时可设为 100ms） */
  heartbeatTimeoutMs?: number;
  /** 巡检间隔毫秒数（0 表示仅手动调用 runPatrolOnce） */
  patrolIntervalMs?: number;
}

export function createInfoCenter(options: InfoCenterOptions) {
  const { store } = options;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 3 * 24 * 3600 * 1000;
  const nodes = new Map<string, NodeHeartbeatRecord>();

  /** 巡检逻辑：检查所有已注册心跳的节点，超时则向 stream:order_events 投递告警给 leadership.center */
  async function runPatrolOnce(now = Date.now()): Promise<string[]> {
    const timedOutNodes: string[] = [];
    for (const [nodeId, rec] of nodes.entries()) {
      if (!rec.alerted && now - rec.lastSeenAt > heartbeatTimeoutMs) {
        rec.alerted = true;
        timedOutNodes.push(nodeId);
        await store.publish("stream:order_events", {
          id: `PATROL-TIMEOUT-${nodeId}-${now}`,
          ts: new Date(now).toISOString(),
          source: "info.center",
          target: "leadership.center",
          type: "NODE_HEARTBEAT_TIMEOUT",
          prompt: `[BLOCKED 告警] 节点 "${nodeId}" 心跳已超时（最后活跃: ${new Date(rec.lastSeenAt).toISOString()}）`,
          wake: true,
          responseMode: "respond",
          outbound: true,
          payload: {
            channel: "stream:order_events",
            missingNodeId: nodeId,
            lastSeenAt: new Date(rec.lastSeenAt).toISOString(),
          },
        });
      }
    }
    return timedOutNodes;
  }

  let patrolTimer: NodeJS.Timeout | undefined;
  if (options.patrolIntervalMs && options.patrolIntervalMs > 0) {
    patrolTimer = setInterval(() => {
      runPatrolOnce().catch((err) => console.error("[info-center] Patrol error:", err));
    }, options.patrolIntervalMs);
    patrolTimer.unref();
  }

  const app = new Hono();

  app.get("/health", async (c) => {
    const stats = await store.getStreamStats();
    return c.json({
      ok: true,
      streams: stats,
      trackedNodes: Array.from(nodes.values()).map((n) => ({
        nodeId: n.nodeId,
        lastSeenAt: new Date(n.lastSeenAt).toISOString(),
        alerted: n.alerted,
      })),
    });
  });

  /** 1. 发信接口：校验显式 channel 白名单与信封 Schema */
  app.post("/channels/:channel/messages", async (c) => {
    const channelParsed = ChannelSchema.safeParse(c.req.param("channel"));
    if (!channelParsed.success) {
      return c.json(
        { ok: false, error: `Unknown channel: ${c.req.param("channel")}` },
        400
      );
    }

    const body = await c.req.json().catch(() => null);
    const eventParsed = EnvelopeEventSchema.safeParse(body);
    if (!eventParsed.success) {
      return c.json(
        { ok: false, error: `Invalid envelope event: ${eventParsed.error.message}` },
        400
      );
    }

    const channel = channelParsed.data;
    const event = eventParsed.data;

    // 若投递至 stream:heartbeat，同步刷新节点存活表并清除已告警标记
    if (channel === "stream:heartbeat") {
      nodes.set(event.source, {
        nodeId: event.source,
        lastSeenAt: Date.now(),
        lastPayload: event.payload,
        alerted: false,
      });
    }

    const stored = await store.publish(channel, event);
    return c.json({ ok: true, messageId: stored.messageId, channel }, 201);
  });

  /** 2. 收信接口：按消费组与订阅通道拉取未签收消息 */
  app.get("/poll", async (c) => {
    const nodeId = c.req.query("nodeId") ?? "";
    const consumerGroup = c.req.query("consumerGroup") ?? "";
    const rawChannels = (c.req.query("channels") ?? "").split(",").filter(Boolean);
    const includePending = c.req.query("includePending") === "true";

    if (!nodeId || !consumerGroup || rawChannels.length === 0) {
      return c.json(
        { ok: false, error: "Missing required query params: nodeId, consumerGroup, channels" },
        400
      );
    }

    const channels: ChannelName[] = [];
    for (const ch of rawChannels) {
      const parsed = ChannelSchema.safeParse(ch);
      if (!parsed.success) {
        return c.json({ ok: false, error: `Invalid channel in subscription: ${ch}` }, 400);
      }
      channels.push(parsed.data);
    }

    const messages = await store.readGroup({
      group: consumerGroup,
      consumer: nodeId,
      channels,
      includePending,
    });
    return c.json({ ok: true, messages });
  });

  /** 3. 签收接口：确认消息已落盘处理完毕 */
  app.post("/ack", async (c) => {
    const AckSchema = z.object({
      consumerGroup: z.string().min(1),
      channel: ChannelSchema,
      messageId: z.string().min(1),
    });
    const parsed = AckSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.message }, 400);
    }

    const acked = await store.ack(
      parsed.data.consumerGroup,
      parsed.data.channel,
      parsed.data.messageId
    );
    return c.json({ ok: true, acked });
  });

  return {
    app,
    runPatrolOnce,
    shutdown: () => {
      if (patrolTimer) clearInterval(patrolTimer);
    },
  };
}
