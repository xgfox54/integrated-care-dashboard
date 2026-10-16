import { env } from "cloudflare:workers";
import { readPressApiKey } from "../press/api-keys";
import type { KeyAccess } from "./runner";
import { normalizeIndexKey } from "./index-key";

const INVISIBLE = /[\s\u00a0\u200b-\u200d\u2060\ufeff]/g;

/** 붙여넣은 KOSIS 키 정리. 호출 주소 전체를 붙여넣었으면 apiKey 값만 꺼낸다. 형식이 아니면 null. */
export function normalizeKosisKey(raw: string): string | null {
  let value = raw.replace(INVISIBLE, "");
  const fromUrl = /[?&]apiKey=([^&#]+)/i.exec(value);
  if (fromUrl?.[1]) value = decodeURIComponent(fromUrl[1]);
  return /^[A-Za-z0-9+/=_-]{16,200}$/.test(value) ? value : null;
}

export async function readIntegrationKey(access: KeyAccess): Promise<string | null> {
  if (access === "DATA_GO_KR_KEY") return readPressApiKey("data_go_kr");
  const key = normalizeKosisKey((env as { KOSIS_API_KEY?: string }).KOSIS_API_KEY ?? "");
  return key ? encodeURIComponent(key) : null;
}

export async function readIndexKey(): Promise<string | null> {
  return normalizeIndexKey((env as { INDEX_API_KEY?: string }).INDEX_API_KEY ?? "");
}
