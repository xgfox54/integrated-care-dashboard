// 지방재정365 「세부사업별 세출현황」(QWGJK) 원천 계약. docs/fiscal/01-source-contract.md에 근거를 적는다.
// 2026-10-04 공식 주소에 표본키(Key 생략)로 직접 호출해 응답 구조·필드·오류 형식을 확인했다.

export const QWGJK_ENDPOINT = "https://www.lofin365.go.kr/lf/hub/QWGJK";
/** 표본키는 페이지당 5건으로 고정된다(pSize를 크게 줘도 5건). */
export const SAMPLE_PAGE_SIZE = 5;
/** 원천 명세: 1회 최대 1,000건(ERROR-336). 여유를 두고 500건씩 받는다. */
export const KEY_PAGE_SIZE = 500;
export const CONTRACT_VERSION = "qwgjk-2026-10-04";

export interface QwgjkQuery {
  readonly fyr: string;
  /** YYYYMMDD */
  readonly exeYmd: string;
  readonly waLafCd?: string;
  readonly lafCd?: string;
  readonly dbizNm?: string;
}

export interface QwgjkRow {
  readonly fyr: string;
  readonly wa_laf_cd: string;
  readonly wa_laf_hg_nm: string;
  readonly laf_cd: string;
  readonly laf_hg_nm: string;
  readonly padm_laf_cd: string;
  readonly acnt_dv_cd: string;
  readonly acnt_dv_nm: string;
  readonly dept_cd: string;
  readonly dbiz_cd: string;
  readonly dbiz_nm: string;
  readonly exe_ymd: string;
  readonly fld_cd: string;
  readonly fld_nm: string;
  readonly ane_part_cd: string;
  readonly part_nm: string;
  /** 금액 원값(숫자 또는 문자열 그대로). */
  readonly amounts: {
    readonly bdg_cash_amt: unknown;
    readonly ep_amt: unknown;
    readonly bdg_ntep: unknown;
    readonly capep: unknown;
    readonly sggep: unknown;
    readonly etc_amt: unknown;
    readonly cpl_amt: unknown;
  };
}

export type QwgjkPage =
  | { readonly kind: "rows"; readonly total: number; readonly rows: readonly QwgjkRow[]; readonly invalidRows: number }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly code: string; readonly retryable: boolean };

const CODE_FIELDS = ["fyr", "wa_laf_cd", "laf_cd", "acnt_dv_cd", "dept_cd", "dbiz_cd", "exe_ymd"] as const;
const TEXT_FIELDS = ["wa_laf_hg_nm", "laf_hg_nm", "padm_laf_cd", "acnt_dv_nm", "dbiz_nm", "fld_cd", "fld_nm", "ane_part_cd", "part_nm"] as const;

export function buildQwgjkUrl(query: QwgjkQuery, page: number, size: number, key?: string): string {
  const params = new URLSearchParams({ Type: "json", pIndex: String(page), pSize: String(size), fyr: query.fyr, exe_ymd: query.exeYmd });
  if (key) params.set("Key", key);
  if (query.waLafCd) params.set("wa_laf_cd", query.waLafCd);
  if (query.lafCd) params.set("laf_cd", query.lafCd);
  if (query.dbizNm) params.set("dbiz_nm", query.dbizNm);
  return QWGJK_ENDPOINT + "?" + params.toString();
}

function codeText(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  // 코드가 숫자로 오면 앞자리 0이 이미 사라졌을 수 있어 받지 않는다.
  return null;
}

function toRow(record: Record<string, unknown>): QwgjkRow | null {
  const codes: Record<string, string> = {};
  for (const field of CODE_FIELDS) {
    const value = codeText(record[field]);
    if (!value) return null;
    codes[field] = value;
  }
  const texts: Record<string, string> = {};
  for (const field of TEXT_FIELDS) texts[field] = typeof record[field] === "string" ? String(record[field]).trim() : "";
  if (!texts.dbiz_nm) return null;
  return {
    ...(codes as Pick<QwgjkRow, (typeof CODE_FIELDS)[number]>),
    ...(texts as Pick<QwgjkRow, (typeof TEXT_FIELDS)[number]>),
    amounts: {
      bdg_cash_amt: record.bdg_cash_amt, ep_amt: record.ep_amt, bdg_ntep: record.bdg_ntep, capep: record.capep,
      sggep: record.sggep, etc_amt: record.etc_amt, cpl_amt: record.cpl_amt,
    },
  };
}

function resultCode(value: unknown): string | null {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "CODE" in entry && typeof (entry as { CODE: unknown }).CODE === "string") return (entry as { CODE: string }).CODE;
  }
  return null;
}

function classify(code: string): QwgjkPage {
  if (code === "INFO-200") return { kind: "empty" };
  const numeric = code.replace(/^[A-Z]+-/, "");
  return { kind: "error", code, retryable: ["500", "600", "601"].includes(numeric) };
}

/** HTTP 200이어도 HTML·인증 오류·필수값 누락을 정상 빈 자료로 바꾸지 않는다. */
export function parseQwgjkResponse(status: number, contentType: string, body: string): QwgjkPage {
  if (status !== 200) return { kind: "error", code: "HTTP_" + status, retryable: status >= 500 || status === 429 };
  if (!/json/i.test(contentType) || /^\s*</.test(body)) return { kind: "error", code: "NOT_JSON", retryable: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "error", code: "INVALID_JSON", retryable: false };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "error", code: "INVALID_JSON", retryable: false };
  const root = parsed as Record<string, unknown>;
  if (!("QWGJK" in root)) {
    const code = resultCode(root.RESULT);
    return code ? classify(code) : { kind: "error", code: "UNKNOWN_SHAPE", retryable: false };
  }
  const blocks = root.QWGJK;
  if (!Array.isArray(blocks)) return { kind: "error", code: "UNKNOWN_SHAPE", retryable: false };
  let total: number | null = null;
  let code: string | null = null;
  let records: unknown[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const head = (block as { head?: unknown }).head;
    if (Array.isArray(head)) {
      for (const item of head) {
        if (item && typeof item === "object" && "list_total_count" in item) total = Number((item as { list_total_count: unknown }).list_total_count);
        if (item && typeof item === "object" && "RESULT" in item) code = resultCode((item as { RESULT: unknown }).RESULT);
      }
    }
    const row = (block as { row?: unknown }).row;
    if (Array.isArray(row)) records = row;
  }
  if (code && code !== "INFO-000") return classify(code);
  if (code !== "INFO-000" || total === null || !Number.isInteger(total) || total < 0) return { kind: "error", code: "UNKNOWN_SHAPE", retryable: false };
  const rows: QwgjkRow[] = [];
  let invalidRows = 0;
  for (const record of records) {
    const row = record && typeof record === "object" ? toRow(record as Record<string, unknown>) : null;
    if (row) rows.push(row);
    else invalidRows += 1;
  }
  return { kind: "rows", total, rows, invalidRows };
}

/** 원천 한 행의 식별키. 확인된 구분자(연도·자치단체·회계·부서·세부사업코드)를 모두 넣는다. */
export function qwgjkRowKey(row: Pick<QwgjkRow, "fyr" | "laf_cd" | "acnt_dv_cd" | "dept_cd" | "dbiz_cd">): string {
  return [row.fyr, row.laf_cd, row.acnt_dv_cd, row.dept_cd, row.dbiz_cd].join(":");
}

