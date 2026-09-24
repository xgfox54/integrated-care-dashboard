export type ServiceKeyEncoding = "decoded" | "encoded";

export interface OpenApiResult {
  readonly resultCode: string;
  readonly resultMsg: string;
}

export interface OpenApiXmlResult extends OpenApiResult {
  readonly totalCount: number;
  readonly records: readonly Record<string, string>[];
  readonly fieldsSeen: readonly string[];
}

export function isOpenApiListResultSuccessful(resultCode: string, resultMsg: string): boolean {
  const normalizedCode = resultCode.trim();
  if (normalizedCode === "0" || normalizedCode === "00") return true;
  return normalizedCode === "40" && resultMsg.trim().toUpperCase() === "NO DATA FOUND";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function childRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function pickText(source: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

export function serviceKeyQueryValue(key: string, encoding: ServiceKeyEncoding): string {
  if (encoding === "encoded") return key;
  try {
    return encodeURIComponent(decodeURIComponent(key));
  } catch (error) {
    if (error instanceof URIError) return encodeURIComponent(key);
    throw error;
  }
}

export function readOpenApiResult(payload: unknown): OpenApiResult {
  const root = isRecord(payload) ? payload : {};
  const response = childRecord(root, "response");
  const header = childRecord(response, "header");
  const serviceResponse = childRecord(root, "OpenAPI_ServiceResponse");
  const commonHeader = childRecord(serviceResponse, "cmmMsgHeader");
  return {
    resultCode:
      pickText(header, "resultCode", "returnReasonCode") ||
      pickText(commonHeader, "returnReasonCode"),
    resultMsg:
      pickText(header, "resultMsg", "returnAuthMsg") ||
      pickText(commonHeader, "returnAuthMsg", "errMsg"),
  };
}

function readXmlBlocks(source: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const blocks: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) blocks.push(value);
  }
  return blocks;
}

function decodeXmlText(source: string): string {
  const withoutCdata = source.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return withoutCdata.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const radix = normalized.startsWith("#x") ? 16 : 10;
    const offset = radix === 16 ? 2 : 1;
    const codePoint = Number.parseInt(normalized.slice(offset), radix);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : String(entity);
  }).trim();
}

function parseXmlRecord(source: string): Record<string, string> {
  const record: Record<string, string> = {};
  const fieldPattern = /<([A-Za-z][\w:.-]*)>([\s\S]*?)<\/\1>/g;
  for (const match of source.matchAll(fieldPattern)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) record[key] = decodeXmlText(value);
  }
  return record;
}

export function parseOpenApiXml(source: string): OpenApiXmlResult {
  const records = readXmlBlocks(source, "servList").map(parseXmlRecord);
  const totalCount = Number(readXmlBlocks(source, "totalCount")[0] ?? "0");
  return {
    resultCode: decodeXmlText(readXmlBlocks(source, "resultCode")[0] ?? ""),
    resultMsg: decodeXmlText(
      readXmlBlocks(source, "resultMessage")[0] ??
        readXmlBlocks(source, "resultMsg")[0] ??
        readXmlBlocks(source, "returnAuthMsg")[0] ??
        "",
    ),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    records,
    fieldsSeen: [...new Set(records.flatMap((record) => Object.keys(record)))],
  };
}
