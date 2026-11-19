import { z } from "zod";

export const CHANNELS = [
  "stream:orders",
  "stream:order_events",
  "stream:reports",
  "stream:heartbeat",
] as const;

export type ChannelName = (typeof CHANNELS)[number];
export const ChannelSchema = z.enum(CHANNELS);

/** 投递进信息中心的标准事件信封（对齐 BusEvent 结构） */
export const EnvelopeEventSchema = z
  .object({
    id: z.string().min(1),
    ts: z.string().min(1),
    source: z.string().min(1),
    target: z.string().default("*"),
    type: z.string().min(1),
    prompt: z.string().min(1),
    wake: z.boolean().default(false),
    responseMode: z.enum(["optional", "respond", "tool_required"]).default("optional"),
    outbound: z.boolean().default(true),
    payload: z.record(z.unknown()).default({}),
  })
  .passthrough();

export type EnvelopeEvent = z.infer<typeof EnvelopeEventSchema>;

export interface StoredMessage {
  messageId: string;
  channel: ChannelName;
  publishedAt: string;
  event: EnvelopeEvent;
}
