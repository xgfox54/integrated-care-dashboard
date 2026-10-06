import type { SqlDatabase } from "../sql-database.ts";

// 공개 재정 snapshot을 지방재정365 공식 화면(세부사업별 세출현황, robots.txt 전체 허용)과 자동 대조한다(작업지시서 v5 §22·T84).
// 배경 작업이 한 번에 한 쪽만 조회해 행별로 예산현액·국비·시도비·시군구비·기타·지출액 원값을 대조하고, 시·도를 모두 돌면 fiscal_unit_check에 결과를 남긴다.
// 불일치가 하나라도 있거나 화면에 없는 행이 있으면 검증으로 표시하지 않는다(unitVerificationSql). 사업명 규칙 범위(dbizNm)만 대조한다.

export const OFFICIAL_SCREEN_URL = "https://www.lofin365.go.kr/portal/LF3120202.do";
const DATA_URL = "https://www.lofin365.go.kr/lf/lnncGramStst/laf/exeSvi/retvLstDtlsBybsnAneSitu.do";
/** 화면의 시·도 선택값(전남광주통합 포함 16개). */
export const SCREEN_REGIONS = ["11", "13", "26", "27", "28", "30", "31", "32", "41", "42", "43", "44", "45", "47", "48", "49"] as const;
const PAGE_SIZE = 10;
/** 공식 서버는 User-Agent가 비면 오류(FWSE0003)를 돌려준다. 우리 서비스임을 밝힌다. */
const SCREEN_USER_AGENT = "Mozilla/5.0 (compatible; welfare-dashboard-unit-check; +https://integrated-care-national-dashboard.xgfox54.chatgpt.site/sources)";
const MAX_RETRIES = 3;

export interface ScreenRow {
  readonly lafCd: string;
  readonly code: string;
  readonly amt1: number; readonly amt2: number; readonly amt3: number; readonly amt4: number; readonly amt5: number; readonly amt6: number;
}
export type ScreenFetcher = (region: string, page: number, referenceDate: string, keyword: string) => Promise<readonly ScreenRow[]>;

/** 화면 응답 HTML 안의 행 목록(var list = [...])을 읽는다. 구조가 바뀌면 오류로 멈춘다. */
export function parseScreenList(html: string): ScreenRow[] {
  const match = html.match(/var list = (\[[\s\S]*?\]);/);
  if (!match) throw new Error("SCREEN_LIST_NOT_FOUND");
  const parsed = JSON.parse(match[1]) as unknown;
  if (!Array.isArray(parsed)) throw new Error("SCREEN_LIST_INVALID");
  return parsed.map((item) => {
    const row = item as Record<string, unknown>;
    if (typeof row.lafCd !== "string" || typeof row.code !== "string") throw new Error("SCREEN_ROW_INVALID");
    const amount = (key: string) => { const value = row[key]; if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("SCREEN_AMOUNT_INVALID"); return value; };
    return { lafCd: row.lafCd, code: row.code, amt1: amount("amt1"), amt2: amount("amt2"), amt3: amount("amt3"), amt4: amount("amt4"), amt5: amount("amt5"), amt6: amount("amt6") };
  });
}

export const fetchOfficialScreen: ScreenFetcher = async (region, page, referenceDate, keyword) => {
  const body = new URLSearchParams({
    menuUrl: "/lf/lnncGramStst/laf/exeSvi/retvLstDtlsBybsnAneSitu.do", menuNm: "세부사업별 세출현황", menuParaCn: "STST", menuId: "LF3120202", uprMenuId: "LF3120200",
    crtrLvl: "", subCode: region, inqYr: referenceDate.slice(0, 4), curPage: String(page), inqBgngYmd: referenceDate.replaceAll("-", ""), inqEndYmd: "", inqCap: region,
    inqSgg: "", inqDtaCd: "", inqDtaCd2: "", inqYmd: referenceDate, srchCrstCn: keyword, sysDvCd: "", logReg: "false",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(DATA_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", referer: OFFICIAL_SCREEN_URL, "user-agent": SCREEN_USER_AGENT }, body, redirect: "manual", signal: controller.signal });
    if (response.status !== 200) throw new Error("SCREEN_HTTP_" + response.status);
    return parseScreenList(await response.text());
  } finally {
    clearTimeout(timer);
  }
};

interface Progress {
  readonly snapshot_id: string; readonly keyword: string; readonly reference_date: string; readonly region_index: number; readonly page: number;
  readonly exact_rows: number; readonly mismatch_rows: number; readonly only_official: number; readonly retry_count: number; readonly status: string;
}

/** 아직 대조하지 않은 공개 snapshot(사업명 규칙 범위)을 하나 고른다. */
async function nextSnapshot(db: SqlDatabase): Promise<{ snapshot_id: string; reference_date: string; keyword: string } | null> {
  const row = await db.prepare(
    "SELECT s.snapshot_id, s.requested_reference_date AS reference_date, c.definition FROM fiscal_snapshot s JOIN fiscal_scope c ON c.scope_id = s.scope_id " +
      // 공식 화면 대조는 사업명 규칙 범위(dbizNm)만 할 수 있다. 전체 세출 범위(예: 제주본청 전체)가 가장 최근이어도 건너뛰고 대조 가능한 snapshot을 고른다.
      "WHERE s.status = 'PUBLISHED' AND s.complete = 1 AND COALESCE(json_extract(c.definition, '$.dbizNm'), '') <> '' AND s.snapshot_id NOT IN (SELECT snapshot_id FROM fiscal_unit_check_progress) ORDER BY s.published_at DESC LIMIT 1",
  ).first<{ snapshot_id: string; reference_date: string; definition: string }>();
  if (!row) return null;
  const definition = JSON.parse(row.definition) as { dbizNm?: unknown };
  return typeof definition.dbizNm === "string" && definition.dbizNm ? { snapshot_id: row.snapshot_id, reference_date: row.reference_date, keyword: definition.dbizNm } : null;
}

const toKrw = (value: number) => (Number.isSafeInteger(value) ? String(value) : null);

/** 배경 작업 한 단계: 진행 중인 대조가 있으면 한 쪽, 없으면 새 대조를 시작한다. 할 일이 있었으면 true. */
export async function advanceUnitCheck(db: SqlDatabase, fetchScreen: ScreenFetcher, nowSeconds: number): Promise<boolean> {
  let progress = await db.prepare("SELECT * FROM fiscal_unit_check_progress WHERE status = 'RUNNING' ORDER BY started_at LIMIT 1").first<Progress>();
  if (!progress) {
    const next = await nextSnapshot(db);
    if (!next) return false;
    await db.prepare("INSERT OR IGNORE INTO fiscal_unit_check_progress VALUES (?, ?, ?, 0, 1, 0, 0, 0, 0, 'RUNNING', '', ?, ?)").bind(next.snapshot_id, next.keyword, next.reference_date, nowSeconds, nowSeconds).run();
    progress = await db.prepare("SELECT * FROM fiscal_unit_check_progress WHERE snapshot_id = ?").bind(next.snapshot_id).first<Progress>();
    if (!progress) return false;
  }
  const region = SCREEN_REGIONS[progress.region_index];
  let rows: readonly ScreenRow[];
  try {
    rows = await fetchScreen(region, progress.page, progress.reference_date, progress.keyword);
  } catch (error) {
    const code = (error instanceof Error ? error.message : "SCREEN_ERROR").replace(/[^A-Z0-9_]/g, "").slice(0, 40) || "SCREEN_ERROR";
    const failed = progress.retry_count + 1 >= MAX_RETRIES;
    await db.prepare("UPDATE fiscal_unit_check_progress SET retry_count = retry_count + 1, status = ?, error_code = ?, updated_at = ? WHERE snapshot_id = ?").bind(failed ? "FAILED" : "RUNNING", code, nowSeconds, progress.snapshot_id).run();
    return true;
  }
  let exact = 0;
  let mismatch = 0;
  let onlyOfficial = 0;
  for (const row of rows) {
    const candidates = (await db.prepare(
      "SELECT o.current_budget_krw, o.national_krw, o.province_krw, o.municipal_krw, o.other_krw, o.public_expenditure_krw FROM fiscal_snapshot_member m " +
        "JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id JOIN fiscal_observation o ON o.observation_id = m.observation_id " +
        "WHERE m.snapshot_id = ? AND p.fiscal_entity_id = ? AND p.dbiz_code = ?",
    ).bind(progress.snapshot_id, "lofin:laf:" + row.lafCd, row.code).all<Record<string, string | null>>()).results;
    if (!candidates.length) { onlyOfficial += 1; continue; }
    const official = [row.amt1, row.amt2, row.amt3, row.amt4, row.amt5, row.amt6].map(toKrw).join(",");
    const same = candidates.some((item) => [item.current_budget_krw, item.national_krw, item.province_krw, item.municipal_krw, item.other_krw, item.public_expenditure_krw].join(",") === official);
    if (same) exact += 1; else mismatch += 1;
  }
  const lastPage = rows.length < PAGE_SIZE;
  const nextRegion = lastPage ? progress.region_index + 1 : progress.region_index;
  const done = nextRegion >= SCREEN_REGIONS.length;
  await db.prepare(
    "UPDATE fiscal_unit_check_progress SET region_index = ?, page = ?, exact_rows = exact_rows + ?, mismatch_rows = mismatch_rows + ?, only_official = only_official + ?, retry_count = 0, error_code = '', status = ?, updated_at = ? WHERE snapshot_id = ?",
  ).bind(nextRegion, lastPage ? 1 : progress.page + 1, exact, mismatch, onlyOfficial, done ? "DONE" : "RUNNING", nowSeconds, progress.snapshot_id).run();
  if (done) {
    const final = await db.prepare("SELECT p.*, s.unique_count FROM fiscal_unit_check_progress p JOIN fiscal_snapshot s ON s.snapshot_id = p.snapshot_id WHERE p.snapshot_id = ?").bind(progress.snapshot_id).first<Progress & { unique_count: number }>();
    if (final) {
      const onlyApi = Math.max(0, final.unique_count - final.exact_rows - final.mismatch_rows);
      await db.prepare("INSERT OR REPLACE INTO fiscal_unit_check VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        final.snapshot_id, final.reference_date, OFFICIAL_SCREEN_URL,
        "자동 대조: 같은 기준일·사업명(" + final.keyword + ")으로 16개 시·도 화면을 조회해 자치단체코드+세부사업코드별 예산현액·국비·시도비·시군구비·기타·지출액 원값 대조",
        final.exact_rows + final.mismatch_rows, (final.exact_rows + final.mismatch_rows) * 6, final.mismatch_rows, onlyApi, final.only_official,
        "백만원(화면 표시), 원(화면 내부 원값·OpenAPI)", nowSeconds,
      ).run();
    }
  }
  return true;
}

/** 관리·상태 화면용 최근 대조 진행. */
export async function readUnitCheckProgress(db: SqlDatabase) {
  return (await db.prepare("SELECT snapshot_id, reference_date, region_index, page, exact_rows, mismatch_rows, only_official, status, error_code, updated_at FROM fiscal_unit_check_progress ORDER BY started_at DESC LIMIT 5").all<Record<string, unknown>>()).results;
}
