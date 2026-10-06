import { env } from "cloudflare:workers";
import type { ApiKeyRef } from "./open-api";

const ENV_NAMES: Readonly<Record<ApiKeyRef, string>> = {
  seoul_open_data: "SEOUL_OPEN_DATA_KEY",
  data_go_kr: "PUBLIC_DATA_SERVICE_KEY",
};

/** 주소에 바로 넣을 수 있게 인코딩한 키. 공공데이터포털 키를 인코딩된 형태로 넣었으면 다시 인코딩하지 않는다. */
export async function readPressApiKey(ref: ApiKeyRef): Promise<string | null> {
  const vars = env as Record<string, string | undefined>;
  const key = vars[ENV_NAMES[ref]]?.trim();
  if (!key) return null;
  return ref === "data_go_kr" && vars.PUBLIC_DATA_SERVICE_KEY_ENCODING === "encoded" ? key : encodeURIComponent(key);
}
