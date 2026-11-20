<!--
@file docs/api-requirements.md
@description World Bus 信息中心邮局服务 API 需求规格文档
@date 2026-11-20
@version 0.1.0
-->

# World Bus Information Center API 需求文档

## 1. 业务背景与需求目标

World Bus 信息中心承担集群各节点 (如 `leadership.center`, `dry.hub.01`, `wet.nmr.01`) 之间的邮局路由职责, 核心目标包括:

1. **受控频道准入**: 通过显式频道白名单拒绝未契约频道的投递与订阅请求.
2. **信封格式强校验**: 使用 Zod v3 在入口处验证事件信封完整性, 防止脏数据进入流队列.
3. **消费组隔离与可靠投递 (PEL)**: 模拟 Redis Stream 消费组语义, 保证同组内消息不重复投递, 支持消费者异常重启后通过 `includePending=true` 重新拉取未签收消息, 并在 `/ack` 后彻底移出待处理列表.
4. **节点存活感知与超时告警**: 监听 `stream:heartbeat` 频道刷新节点最后活跃时间, 并在节点失联超过阈值后自动向 `stream:order_events` 投递 `NODE_HEARTBEAT_TIMEOUT` 告警事件.

---

## 2. 数据模型与契约规范

### 2.1 允许频道白名单 (`CHANNELS`)

所有发信与订阅请求均受限于以下 4 个显式频道 ([src/schema.ts](file:///c:/codeSpace/world-bus-information-center/src/schema.ts)):

| 频道名称 | 定位与典型用途 | 特殊服务端副作用 |
| --- | --- | --- |
| `stream:orders` | 下发任务指令与工单事件 | 无 |
| `stream:order_events` | 订单状态变更与系统异常告警事件 | 超时巡检自动向此频道投递 `NODE_HEARTBEAT_TIMEOUT` |
| `stream:reports` | 节点执行结果与分析报告回传 | 无 |
| `stream:heartbeat` | 节点周期性存活性心跳上报 | 刷新服务端内存心跳表 `lastSeenAt` 并重置 `alerted = false` |

### 2.2 事件信封 (`EnvelopeEventSchema`)

入口校验允许通过 `.passthrough()` 透传未知扩展字段, 核心字段约束如下:

| 字段 | 类型 | 必填 | 默认值 | 校验说明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | - | 长度 `>= 1` 的事件唯一标识 |
| `ts` | `string` | 是 | - | 长度 `>= 1` 的时间戳字符串 (推荐 ISO 8601) |
| `source` | `string` | 是 | - | 长度 `>= 1` 的发送节点 ID |
| `target` | `string` | 否 | `"*"` | 目标节点 ID, `"*"` 表示广播 |
| `type` | `string` | 是 | - | 长度 `>= 1` 的业务事件类型 |
| `prompt` | `string` | 是 | - | 长度 `>= 1` 的指令或提示文本 |
| `wake` | `boolean` | 否 | `false` | 是否唤醒目标节点 |
| `responseMode` | `"optional" \| "respond" \| "tool_required"` | 否 | `"optional"` | 期望响应模式 |
| `outbound` | `boolean` | 否 | `true` | 是否允许出站投递 |
| `payload` | `Record<string, unknown>` | 否 | `{}` | 任意键值结构的业务负载对象 |

### 2.3 存储消息封装 (`StoredMessage`)

投递入队后由存储层附加消息元数据:

```json
{
  "messageId": "1732000000000-1",
  "channel": "stream:orders",
  "publishedAt": "2026-11-20T01:30:00.000Z",
  "event": {
    "id": "ORD-101",
    "ts": "2026-11-20T01:30:00.000Z",
    "source": "leadership.center",
    "target": "dry.hub.01",
    "type": "ORDER_DISPATCH",
    "prompt": "执行聚乙烯谱图入库",
    "wake": true,
    "responseMode": "optional",
    "outbound": true,
    "payload": {
      "channel": "stream:orders",
      "orderId": "ORD-101"
    }
  }
}
```

---

## 3. HTTP API 接口规范

服务端默认监听 `0.0.0.0:3200`, 所有接口均采用 `application/json` 响应格式 ([src/server.ts](file:///c:/codeSpace/world-bus-information-center/src/server.ts)).

### 3.1 健康检查与状态概览

- **请求**: `GET /health`
- **需求说明**: 返回服务健康状态, 4 个频道当前累计消息数, 以及已登记心跳的节点列表.
- **响应 `200 OK`**:

```json
{
  "ok": true,
  "streams": {
    "stream:orders": { "total": 1 },
    "stream:order_events": { "total": 0 },
    "stream:reports": { "total": 0 },
    "stream:heartbeat": { "total": 2 }
  },
  "trackedNodes": [
    {
      "nodeId": "wet.nmr.01",
      "lastSeenAt": "2026-11-20T01:30:00.000Z",
      "alerted": false
    }
  ]
}
```

### 3.2 发信接口

- **请求**: `POST /channels/:channel/messages`
- **路径参数**: `:channel` 必须属于 `CHANNELS` 白名单.
- **请求体**: 符合 `EnvelopeEventSchema` 的 JSON 对象.
- **处理逻辑**:
  1. 校验 `:channel` 是否合法; 非法返回 `400`.
  2. 解析并校验 JSON 请求体是否符合 `EnvelopeEventSchema`; 失败或非 JSON 返回 `400`.
  3. 若 `channel === "stream:heartbeat"`, 以 `event.source` 为 `nodeId` 更新节点存活表 (`lastSeenAt = Date.now()`, `lastPayload = event.payload`, `alerted = false`).
  4. 调用 `store.publish(channel, event)` 入队并返回 `201`.
- **响应 `201 Created`**:

```json
{
  "ok": true,
  "messageId": "1732000000000-1",
  "channel": "stream:orders"
}
```

- **错误响应 `400 Bad Request`**:
  - 非法频道: `{ "ok": false, "error": "Unknown channel: <channel>" }`
  - 非法信封: `{ "ok": false, "error": "Invalid envelope event: <zod error>" }`

### 3.3 收信轮询接口

- **请求**: `GET /poll`
- **查询参数**:
  - `nodeId` (`string`, 必填): 当前拉取节点标识 (`consumer`).
  - `consumerGroup` (`string`, 必填): 消费组名称 (`group`).
  - `channels` (`string`, 必填): 订阅频道列表, 多个频道使用 `,` 分隔.
  - `includePending` (`"true" | string`, 可选): 为 `"true"` 时允许重投当前节点在 PEL 中尚未签收的消息.
- **投递与隔离规则**:
  1. 任一必填参数缺失 (`!nodeId || !consumerGroup || channels.length === 0`) 返回 `400`.
  2. 订阅列表中存在白名单外频道时整体返回 `400`.
  3. 跳过已被该 `consumerGroup` 在该频道签收 (`acked`) 的消息.
  4. 过滤自发消息 (`msg.event.source === nodeId`) 与目标不匹配消息 (`msg.event.target !== nodeId && msg.event.target !== "*"`).
  5. 若消息已存在于该组 PEL 中: 仅当 `includePending === true` 且 `existingPending.consumer === nodeId` 时重新返回, 否则跳过防止同组并发重复消费.
  6. 首次命中时将该消息写入消费组 PEL (`consumer: nodeId`, `deliveredAt: Date.now()`).
- **响应 `200 OK`**:

```json
{
  "ok": true,
  "messages": []
}
```

- **错误响应 `400 Bad Request`**:
  - 缺少参数: `{ "ok": false, "error": "Missing required query params: nodeId, consumerGroup, channels" }`
  - 非法订阅频道: `{ "ok": false, "error": "Invalid channel in subscription: <ch>" }`

### 3.4 消息签收接口

- **请求**: `POST /ack`
- **请求体**:

```json
{
  "consumerGroup": "cg:dry",
  "channel": "stream:orders",
  "messageId": "1732000000000-1"
}
```

- **校验约束**:
  - `consumerGroup`: 非空字符串
  - `channel`: 必须属于 `CHANNELS`
  - `messageId`: 非空字符串
- **处理逻辑**:
  - 调用 `store.ack(consumerGroup, channel, messageId)` 从消费组 PEL 删除该 `messageId`, 并将其加入已签收集合 `ackedByGroup`.
  - 若消息原处于 PEL 中, 返回 `acked: true`; 若不在 PEL 中 (例如重复签收或未知 `messageId`), 返回 `acked: false`.
- **响应 `200 OK`**:

```json
{
  "ok": true,
  "acked": true
}
```

- **错误响应 `400 Bad Request`**: `{ "ok": false, "error": "<zod error>" }`

---

## 4. 巡检告警与非功能需求

### 4.1 心跳超时自动告警规范

- 触发条件: `!rec.alerted && now - rec.lastSeenAt > heartbeatTimeoutMs` (每个失联周期仅告警一次, 直到节点重新向 `stream:heartbeat` 发信后重置 `alerted = false`).
- 投递目标: 固定写入 `stream:order_events`, 生成信封字段如下:
  - `id`: `"PATROL-TIMEOUT-${nodeId}-${now}"`
  - `source`: `"info.center"`
  - `target`: `"leadership.center"`
  - `type`: `"NODE_HEARTBEAT_TIMEOUT"`
  - `wake`: `true`
  - `responseMode`: `"respond"`
  - `outbound`: `true`
  - `payload`: `{ channel: "stream:order_events", missingNodeId: nodeId, lastSeenAt: ISOString }`

### 4.2 后续待规划接口需求 (尚未实现)

以下能力当前不在 `0.1.0` 范围内, 列为后续迭代需求候选:

1. 节点鉴权与请求来源校验 (防止伪造 `source` 或跨组非法 `/ack`).
2. PEL 超时接管 (Claim) 接口, 允许同组其他活跃节点接管长期离线消费者的未签收消息.
3. 历史消息清理 / 长度裁剪 (`MAXLEN` 策略) 与死信队列机制.
