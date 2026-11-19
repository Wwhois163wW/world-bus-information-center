import { describe, it, expect } from "vitest";
import { MemoryStreamStore } from "../src/store.js";
import { createInfoCenter } from "../src/server.js";

describe("Information Center Post Office Service", () => {
  it("1. 严格拒绝契约外的非法 channel 与非法信封格式", async () => {
    const ic = createInfoCenter({ store: new MemoryStreamStore() });

    const badCh = await ic.app.request("/channels/stream:unknown/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "E1",
        ts: new Date().toISOString(),
        source: "leadership.center",
        type: "TEST",
        prompt: "hi",
      }),
    });
    expect(badCh.status).toBe(400);

    const badBody = await ic.app.request("/channels/stream:orders/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "E2" }), // 缺少 source/type/prompt
    });
    expect(badBody.status).toBe(400);
  });

  it("2. ConsumerGroup 投递隔离、过滤自身发信、以及未 ACK 时的 PEL 断线重投", async () => {
    const ic = createInfoCenter({ store: new MemoryStreamStore() });

    // Leadership 发布一条定向给 dry.hub.01 的订单
    const pubRes = await ic.app.request("/channels/stream:orders/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "ORD-101",
        ts: new Date().toISOString(),
        source: "leadership.center",
        target: "dry.hub.01",
        type: "ORDER_DISPATCH",
        prompt: "执行聚乙烯谱图入库",
        wake: true,
        payload: { channel: "stream:orders", orderId: "ORD-101" },
      }),
    });
    expect(pubRes.status).toBe(201);
    const { messageId } = await pubRes.json();

    // Wet 节点来拉取 -> 因 target="dry.hub.01"，不应收到
    const wetPoll = await ic.app.request(
      "/poll?nodeId=wet.nmr.01&consumerGroup=cg:wet&channels=stream:orders"
    );
    expect((await wetPoll.json()).messages).toHaveLength(0);

    // Dry 节点首次拉取 -> 收到 1 条消息，进入 PEL
    const dryPoll1 = await ic.app.request(
      "/poll?nodeId=dry.hub.01&consumerGroup=cg:dry&channels=stream:orders"
    );
    expect((await dryPoll1.json()).messages).toHaveLength(1);

    // 同组再次普通拉取 -> 不会重复投递
    const dryPoll2 = await ic.app.request(
      "/poll?nodeId=dry.hub.01&consumerGroup=cg:dry&channels=stream:orders"
    );
    expect((await dryPoll2.json()).messages).toHaveLength(0);

    // 模拟 Dry 崩溃重启未 ACK，带 includePending=true 重拉 -> 找回未签收消息
    const dryRecover = await ic.app.request(
      "/poll?nodeId=dry.hub.01&consumerGroup=cg:dry&channels=stream:orders&includePending=true"
    );
    expect((await dryRecover.json()).messages).toHaveLength(1);

    // 正式调用 /ack 签收后，即使 includePending=true 也不再出现
    const ackRes = await ic.app.request("/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consumerGroup: "cg:dry",
        channel: "stream:orders",
        messageId,
      }),
    });
    expect(ackRes.status).toBe(200);

    const dryAfterAck = await ic.app.request(
      "/poll?nodeId=dry.hub.01&consumerGroup=cg:dry&channels=stream:orders&includePending=true"
    );
    expect((await dryAfterAck.json()).messages).toHaveLength(0);
  });

  it("3. 心跳超时自律巡检: 节点失联超过阈值自动向 stream:order_events 投递 BLOCKED 告警", async () => {
    const ic = createInfoCenter({
      store: new MemoryStreamStore(),
      heartbeatTimeoutMs: 100,
    });

    // Wet 上报一次心跳
    await ic.app.request("/channels/stream:heartbeat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "HB-1",
        ts: new Date().toISOString(),
        source: "wet.nmr.01",
        target: "leadership.center",
        type: "NODE_HEARTBEAT",
        prompt: "Wet online",
        wake: false,
        payload: { channel: "stream:heartbeat" },
      }),
    });

    // 模拟时间推进 200ms 后触发巡检
    const timedOut = await ic.runPatrolOnce(Date.now() + 200);
    expect(timedOut).toEqual(["wet.nmr.01"]);

    // Leadership 拉取 stream:order_events -> 收到 NODE_HEARTBEAT_TIMEOUT 告警
    const leaderPoll = await ic.app.request(
      "/poll?nodeId=leadership.center&consumerGroup=cg:leadership&channels=stream:order_events"
    );
    const msgs = (await leaderPoll.json()).messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].event.type).toBe("NODE_HEARTBEAT_TIMEOUT");
    expect(msgs[0].event.wake).toBe(true);
  });
});
