import type { ChannelName, EnvelopeEvent, StoredMessage } from "./schema.js";

export interface StreamStore {
  publish(channel: ChannelName, event: EnvelopeEvent): Promise<StoredMessage>;
  readGroup(params: {
    group: string;
    consumer: string;
    channels: readonly ChannelName[];
    includePending?: boolean;
  }): Promise<StoredMessage[]>;
  ack(group: string, channel: ChannelName, messageId: string): Promise<boolean>;
  getStreamStats(): Promise<Record<ChannelName, { total: number }>>;
}

/**
 * 内存版 StreamStore（1:1 模拟 Redis Stream XADD / XREADGROUP / XACK + PEL 机制）
 * - 同一 consumerGroup 内，一条消息被某消费者拉取后进入 PEL，其他同组消费者不会重复拉到
 * - 若消费者崩溃未调用 ack，开启 includePending=true 可重新捞回未签收消息
 */
export class MemoryStreamStore implements StreamStore {
  private streams = new Map<ChannelName, StoredMessage[]>([
    ["stream:orders", []],
    ["stream:order_events", []],
    ["stream:reports", []],
    ["stream:heartbeat", []],
  ]);

  /** group -> channel -> Map<messageId, { consumer: string; deliveredAt: number }> */
  private pendingByGroup = new Map<
    string,
    Map<ChannelName, Map<string, { consumer: string; deliveredAt: number }>>
  >();

  /** group -> channel -> Set<ackedMessageId> */
  private ackedByGroup = new Map<string, Map<ChannelName, Set<string>>>();

  private seq = 0;

  async publish(channel: ChannelName, event: EnvelopeEvent): Promise<StoredMessage> {
    const msg: StoredMessage = {
      messageId: `${Date.now()}-${++this.seq}`,
      channel,
      publishedAt: new Date().toISOString(),
      event,
    };
    this.streams.get(channel)!.push(msg);
    return msg;
  }

  async readGroup(params: {
    group: string;
    consumer: string;
    channels: readonly ChannelName[];
    includePending?: boolean;
  }): Promise<StoredMessage[]> {
    const result: StoredMessage[] = [];

    for (const ch of params.channels) {
      const ackedSet = this.getAckedSet(params.group, ch);
      const pendingMap = this.getPendingMap(params.group, ch);
      const messages = this.streams.get(ch) ?? [];

      for (const msg of messages) {
        if (ackedSet.has(msg.messageId)) continue;

        // 过滤：发件人自己不收自己发出的信；target 必须匹配当前 consumer 或广播 "*"
        if (msg.event.source === params.consumer) continue;
        if (msg.event.target !== params.consumer && msg.event.target !== "*") continue;

        const existingPending = pendingMap.get(msg.messageId);
        if (existingPending) {
          // 仅当显式要求重投本消费者未 ACK 的消息时才再次返回
          if (params.includePending && existingPending.consumer === params.consumer) {
            result.push(msg);
          }
          continue;
        }

        // 首次投递：写入该消费组的 PEL 防止同组并发重复消费
        pendingMap.set(msg.messageId, {
          consumer: params.consumer,
          deliveredAt: Date.now(),
        });
        result.push(msg);
      }
    }

    return result;
  }

  async ack(group: string, channel: ChannelName, messageId: string): Promise<boolean> {
    const pendingMap = this.getPendingMap(group, channel);
    const ackedSet = this.getAckedSet(group, channel);
    const existed = pendingMap.delete(messageId);
    ackedSet.add(messageId);
    return existed;
  }

  async getStreamStats(): Promise<Record<ChannelName, { total: number }>> {
    return {
      "stream:orders": { total: this.streams.get("stream:orders")!.length },
      "stream:order_events": { total: this.streams.get("stream:order_events")!.length },
      "stream:reports": { total: this.streams.get("stream:reports")!.length },
      "stream:heartbeat": { total: this.streams.get("stream:heartbeat")!.length },
    };
  }

  private getPendingMap(group: string, channel: ChannelName) {
    if (!this.pendingByGroup.has(group)) this.pendingByGroup.set(group, new Map());
    const byCh = this.pendingByGroup.get(group)!;
    if (!byCh.has(channel)) byCh.set(channel, new Map());
    return byCh.get(channel)!;
  }

  private getAckedSet(group: string, channel: ChannelName) {
    if (!this.ackedByGroup.has(group)) this.ackedByGroup.set(group, new Map());
    const byCh = this.ackedByGroup.get(group)!;
    if (!byCh.has(channel)) byCh.set(channel, new Set());
    return byCh.get(channel)!;
  }
}
