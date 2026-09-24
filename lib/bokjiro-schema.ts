import { z } from "zod";

const BokjiroRecordSchema = z.object({
  WLFARE_INFO_ID: z.string().optional(),
  WLFARE_INFO_NM: z.string().optional(),
  WLFARE_INFO_OUTL_CN: z.string().optional(),
  BIZ_CHR_INST_NM: z.string().optional(),
  WLFARE_GDNC_TRGT_KCD: z.string().optional(),
  ADDR: z.string().optional(),
}).passthrough();

const BokjiroPayloadSchema = z.object({
  dsServiceList0: z.array(BokjiroRecordSchema).optional().default([]),
  dsServiceList1: z.array(BokjiroRecordSchema).optional().default([]),
  dsServiceList2: z.array(BokjiroRecordSchema).optional().default([]),
  dsServiceList3: z.array(BokjiroRecordSchema).optional().default([]),
  dmMessage: z.object({
    status: z.string().optional(),
    code: z.string().optional(),
    content: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export type BokjiroRecord = z.infer<typeof BokjiroRecordSchema>;
export type BokjiroPayload = z.infer<typeof BokjiroPayloadSchema>;

export class BokjiroResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`복지로 응답 오류 ${status}`);
    this.name = "BokjiroResponseError";
    this.status = status;
  }
}

export class BokjiroPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BokjiroPayloadError";
  }
}

export function parseBokjiroPayload(value: unknown): BokjiroPayload {
  return BokjiroPayloadSchema.parse(value);
}
