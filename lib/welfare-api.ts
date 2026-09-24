import { env } from "cloudflare:workers";

import {
  isOpenApiListResultSuccessful,
  parseOpenApiXml,
  readOpenApiResult,
  serviceKeyQueryValue,
} from "./welfare-api-wire";
import type { ServiceKeyEncoding } from "./welfare-api-wire";

const LIST_ENDPOINT =
  "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist";
const REQUEST_TIMEOUT_MS = 12_000;

export interface WelfareItem {
  servId: string;
  servNm: string;
  jurOrgNm: string;
  servDgst: string;
  sidoNm: string;
  sggNm: string;
  sprtTrgt: string;
  aplyMthd: string;
  servDtlLink: string;
  lastModYmd: string;
}

export interface WelfareCallResult {
  ok: boolean;
  httpStatus: number;
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  items: WelfareItem[];
  fieldsSeen: string[];
  rawExcerpt: string;
}

export class ServiceKeyMissingError extends Error {
  constructor() {
    super("공공데이터포털 인증키가 등록되지 않았습니다.");
    this.name = "ServiceKeyMissingError";
  }
}

// 공개본에서는 공공데이터포털 인증키를 배포 환경변수로 받는다.
async function resolveServiceKey(): Promise<{ key: string; encoding: ServiceKeyEncoding }> {
  const vars = env as { PUBLIC_DATA_SERVICE_KEY?: string; PUBLIC_DATA_SERVICE_KEY_ENCODING?: string };
  const key = vars.PUBLIC_DATA_SERVICE_KEY?.trim();
  if (!key) throw new ServiceKeyMissingError();
  return { key, encoding: vars.PUBLIC_DATA_SERVICE_KEY_ENCODING === "encoded" ? "encoded" : "decoded" };
}

function pickText(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

function toWelfareItems(rawList: readonly Record<string, unknown>[]): {
  items: WelfareItem[];
  fieldsSeen: string[];
} {
  const fields = new Set<string>();
  const items = rawList.map((entry) => {
      Object.keys(entry).forEach((key) => fields.add(key));
      return {
        servId: pickText(entry, "servId", "servID"),
        servNm: pickText(entry, "servNm", "servnm"),
        jurOrgNm: pickText(entry, "jurOrgNm", "jurMnofNm", "bizChrDeptNm"),
        servDgst: pickText(entry, "servDgst", "servDtl", "servSeCd"),
        sidoNm: pickText(entry, "ctpvNm", "sidoNm", "ctprvNm"),
        sggNm: pickText(entry, "sggNm", "signguNm"),
        sprtTrgt: pickText(entry, "sprtTrgtCn", "trgterIndvdlArray", "sprtTrgt"),
        aplyMthd: pickText(entry, "aplyMtdCn", "aplyMthd", "alwServCn"),
        servDtlLink: pickText(entry, "servDtlLink", "servDtlLinkUrl"),
        lastModYmd: pickText(entry, "lastModYmd", "inqNum"),
      };
    });
  return { items, fieldsSeen: [...fields] };
}

function toItems(payload: unknown): { items: WelfareItem[]; fieldsSeen: string[] } {
  const body = (payload as { response?: { body?: Record<string, unknown> } })?.response?.body;
  const container = body?.items as unknown;
  const rawList = Array.isArray(container)
    ? container
    : Array.isArray((container as { item?: unknown[] })?.item)
      ? (container as { item: unknown[] }).item
      : container && typeof container === "object" && "item" in (container as object)
        ? [(container as { item: unknown }).item]
        : [];
  const records = rawList.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  );
  return toWelfareItems(records);
}

export async function callWelfareList(options: {
  keyword: string;
  pageNo?: number;
  numOfRows?: number;
}): Promise<WelfareCallResult> {
  const { key, encoding } = await resolveServiceKey();
  const params = new URLSearchParams({
    callTp: "L",
    pageNo: String(options.pageNo ?? 1),
    numOfRows: String(options.numOfRows ?? 10),
    type: "json",
  });
  if (options.keyword.trim()) {
    params.set("searchWrd", options.keyword.trim());
  }
  const keyParam = serviceKeyQueryValue(key, encoding);
  const requestUrl = `${LIST_ENDPOINT}?serviceKey=${keyParam}&${params.toString()}`;

  const response = await fetch(requestUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  const bodyText = await response.text();
  const rawExcerpt = bodyText.slice(0, 400);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    const xml = parseOpenApiXml(bodyText);
    const { items, fieldsSeen } = toWelfareItems(xml.records);
    return {
      ok: response.ok && isOpenApiListResultSuccessful(xml.resultCode, xml.resultMsg),
      httpStatus: response.status,
      resultCode: xml.resultCode,
      resultMsg: xml.resultMsg || "응답을 해석하지 못했습니다.",
      totalCount: xml.totalCount,
      items,
      fieldsSeen,
      rawExcerpt,
    };
  }

  const body = (parsed as { response?: { body?: Record<string, unknown> } })?.response?.body ?? {};
  const { resultCode, resultMsg } = readOpenApiResult(parsed);
  const { items, fieldsSeen } = toItems(parsed);
  const totalCount = Number(pickText(body, "totalCount") || "0");

  return {
    ok:
      response.ok &&
      (resultCode === "" || isOpenApiListResultSuccessful(resultCode, resultMsg)),
    httpStatus: response.status,
    resultCode,
    resultMsg,
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    items,
    fieldsSeen,
    rawExcerpt,
  };
}
