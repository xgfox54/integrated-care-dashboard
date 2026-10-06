// 기관이 공개한 보도자료 Open API(인증키 필요)에서 제목·원문 주소·게시일만 뽑는다(작업지시서 v5 §23, 운영자 지시 2026-10-04).
// 응답에 본문(예: 서울시 CN)·이미지·담당자가 있어도 읽지 않는다. 프로필에 적은 세 필드만 꺼내고 나머지는 버린다.
// 인증키는 endpoint 주소 틀의 {key} 자리에 호출할 때만 넣는다. DB·기록·화면에는 키를 넣지 않은 주소 틀만 남는다.
import { cleanText, FeedFormatError, MAX_FEED_ITEMS, type PressFeedItem } from "./rss.ts";

/** 키 저장 위치. 서울 열린데이터광장 키는 보도자료 관리 화면에, 공공데이터포털 키는 기존 인증키 화면(복지서비스 API와 같은 키)에 둔다. */
export const API_KEY_REFS = ["seoul_open_data", "data_go_kr"] as const;
export type ApiKeyRef = (typeof API_KEY_REFS)[number];

export interface OpenApiProfile {
  readonly keyRef: ApiKeyRef;
  readonly format: "json";
  /** 행 배열까지의 점 경로(예: tvReportedInfo.row). */
  readonly rows: string;
  /** 결과 코드 경로와 정상 값(예: tvReportedInfo.RESULT.CODE = INFO-000). 데이터 없음 값은 0건 정상으로 본다. */
  readonly resultCode?: string;
  readonly okCodes?: readonly string[];
  readonly emptyCodes?: readonly string[];
  readonly keyErrorCodes?: readonly string[];
  readonly fields: { readonly title: string; readonly link: string; readonly date: string };
  /** 원천 링크에서 게시물 번호를 꺼내 공식 원문 주소 틀(url의 {id})로 다시 만든다. 없으면 링크를 그대로 쓴다. */
  readonly linkId?: string;
  readonly url?: string;
  /** 기관이 공개한 시험용 키와 그 키로 부를 주소 틀(연결 테스트 전용, 정기 수집에는 쓰지 않음). */
  readonly sampleKey?: string;
  readonly sampleUrl?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined);

export function parseOpenApiProfile(raw: string): OpenApiProfile | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(value) || !isRecord(value.fields)) return null;
  const keyRef = API_KEY_REFS.find((ref) => ref === value.keyRef);
  const { title, link, date } = value.fields;
  if (!keyRef || value.format !== "json" || typeof value.rows !== "string" || typeof title !== "string" || typeof link !== "string" || typeof date !== "string") return null;
  if ((value.linkId === undefined) !== (value.url === undefined)) return null;
  if (value.linkId !== undefined && (typeof value.linkId !== "string" || typeof value.url !== "string" || !value.url.includes("{id}"))) return null;
  return {
    keyRef, format: "json", rows: value.rows, fields: { title, link, date },
    ...(typeof value.resultCode === "string" ? { resultCode: value.resultCode } : {}),
    ...(strings(value.okCodes) ? { okCodes: strings(value.okCodes) } : {}),
    ...(strings(value.emptyCodes) ? { emptyCodes: strings(value.emptyCodes) } : {}),
    ...(strings(value.keyErrorCodes) ? { keyErrorCodes: strings(value.keyErrorCodes) } : {}),
    ...(typeof value.linkId === "string" && typeof value.url === "string" ? { linkId: value.linkId, url: value.url } : {}),
    ...(typeof value.sampleKey === "string" && typeof value.sampleUrl === "string" ? { sampleKey: value.sampleKey, sampleUrl: value.sampleUrl } : {}),
  };
}

/** 주소 틀의 {key} 자리에 주소용으로 이미 인코딩된 키를 넣는다. 틀에 {key}가 없으면 키를 붙이지 않는다. */
export function withApiKey(template: string, urlSafeKey: string): string {
  return template.replace("{key}", urlSafeKey);
}

function at(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

const text = (value: unknown): string => (typeof value === "string" ? cleanText(value) : typeof value === "number" || typeof value === "boolean" ? String(value) : "");

/**
 * JSON 응답에서 프로필의 세 필드만 읽는다. 키 오류는 API_KEY_INVALID, 그 밖의 결과 코드 오류·구조 이상은 API_ERROR로 보류한다.
 */
export function parseOpenApiItems(body: string, profile: OpenApiProfile): PressFeedItem[] {
  if (body.length > 3_000_000) throw new FeedFormatError("FEED_TOO_LARGE");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) throw new FeedFormatError("API_ERROR");
    throw error;
  }
  // 공공데이터포털 게이트웨이 오류(등록되지 않은 키 30, 만료 31, 미승인 IP 32, 접근 거부 20, 일일 한도 22 등).
  const gateway = text(at(value, "OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode"));
  if (gateway) throw new FeedFormatError(["20", "30", "31", "32"].includes(gateway) ? "API_KEY_INVALID" : "API_ERROR");
  // 서울 열린데이터광장은 키 오류를 최상위 RESULT로만 돌려준다.
  const code = text(profile.resultCode ? at(value, profile.resultCode) : undefined) || text(at(value, "RESULT.CODE"));
  if (code && profile.keyErrorCodes?.includes(code)) throw new FeedFormatError("API_KEY_INVALID");
  if (code && profile.emptyCodes?.includes(code)) return [];
  if (profile.okCodes && !profile.okCodes.includes(code)) throw new FeedFormatError("API_ERROR");
  const rows = at(value, profile.rows);
  if (!Array.isArray(rows)) throw new FeedFormatError("API_ERROR");
  const pattern = profile.linkId ? new RegExp(profile.linkId) : null;
  const items: PressFeedItem[] = [];
  for (const row of rows.slice(0, MAX_FEED_ITEMS)) {
    if (!isRecord(row)) continue;
    const rawLink = text(row[profile.fields.link]);
    const id = pattern ? pattern.exec(rawLink)?.groups?.id : undefined;
    const link = pattern && profile.url ? (id ? profile.url.replace("{id}", encodeURIComponent(id)) : "") : rawLink;
    items.push({ title: text(row[profile.fields.title]).slice(0, 300), link, guid: id ?? "", pubDate: text(row[profile.fields.date]) });
  }
  return items;
}
