// 통합돌봄 예산 분류(2026-10-05 운영자 지시): 통합돌봄 WIKI(보건복지부 통합돌봄 사업안내)의 사업명과 같은 지자체 예산의 세부사업명이
// 일치하면 통합돌봄 예산으로 본다. 세부사업명에 「통합돌봄」이 들어간 사업(기존 이름 범위 기준)도 넣는다.
// 지방재정365 QWGJK는 예산서의 부기명을 주지 않고 세부사업명(dbiz_nm)까지만 주므로 세부사업명으로 대조한다.
// 대조는 띄어쓰기·문장부호를 뺀 이름이 정확히 같을 때만이다(비슷한 이름은 넣지 않음).
// 전국 47만여 행이라 응답 뒤 작업 시간에 자치단체 몇 곳씩 나누어 하고, 결과는 fiscal_project_class에 남긴다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "../platform/public-pin.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { chooseSnapshotSet } from "./query.ts";

export const INTEGRATED_CARE_CLASS = "integrated_care";
const KEYWORD = nameKey("통합돌봄");
const WRITE_BATCH = 50;

/** 대조용 이름 열쇠: 호환 문자를 펴고(NFKC) 글자·숫자만 남긴다. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

interface EntityRow { readonly id: string; readonly name: string; readonly wa_name: string }
interface UnitRow { readonly name: string; readonly dept_prefix: string }
interface WikiRow { readonly service_id: string; readonly sido: string; readonly sigungu: string; readonly name: string }
interface RunRow { readonly signature: string; readonly entity_index: number; readonly finished_at: number | null }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 재정주체 지역 약칭(예: 전남광주)에 해당하는 위키 시·도 이름들. */
function sidoNames(waName: string): readonly string[] {
  return REGION_DEFINITIONS.find((region) => region.shortLabel.replace(/[·\s]/g, "") === waName)?.aliases ?? [];
}

/**
 * 한 재정주체에 해당하는 위키 사업. 재정주체 이름은 「지역 약칭 + 시군구」(예: 경기수원시) 또는 「지역 약칭 + 본청」이다.
 * 본청: 위키 시군구가 비었거나 시·도와 같은 사업(세종·제주 도 단위). 행정시·행정구(제주시·창원시 의창구 등): 그 부서코드 앞자리로만.
 */
function wikiFor(entity: EntityRow, wiki: readonly WikiRow[], units: readonly UnitRow[]): Map<string, { readonly row: WikiRow; readonly prefixes: readonly string[] | null }[]> {
  const rest = entity.name.slice(entity.wa_name.length);
  const sidos = sidoNames(entity.wa_name);
  const found = new Map<string, { row: WikiRow; prefixes: readonly string[] | null }[]>();
  for (const row of wiki) {
    if (!sidos.includes(row.sido)) continue;
    const unit = units.find((item) => item.name === row.sigungu);
    const mine = rest === "본청" ? !row.sigungu || row.sigungu === row.sido || Boolean(unit) : row.sigungu === rest || row.sigungu.startsWith(rest + " ");
    if (!mine) continue;
    const key = nameKey(row.name);
    if (!key) continue;
    const list = found.get(key) ?? [];
    list.push({ row, prefixes: unit ? unit.dept_prefix.split(",").map((prefix) => prefix.trim()).filter(Boolean) : null });
    found.set(key, list);
  }
  return found;
}

/** 분류 기준(공개본·위키 수집본·행정단위)이 바뀌었는지 보는 서명과 대상 회계연도. */
async function classificationTarget(db: SqlDatabase): Promise<{ readonly signature: string; readonly year: string; readonly knowledgeRunId: string } | null> {
  const choice = await chooseSnapshotSet(db, "all_fields", undefined, undefined);
  if (!choice.snapshots.length) return null;
  const knowledge = await db.prepare("SELECT " + PUBLIC_KNOWLEDGE_RUN_SQL + " AS id").first<{ id: string | null }>();
  if (!knowledge?.id) return null;
  const units = (await db.prepare("SELECT unit_id, dept_prefix FROM fiscal_admin_unit WHERE verification_status = 'VERIFIED' ORDER BY unit_id").all<{ unit_id: string; dept_prefix: string }>()).results;
  const year = choice.snapshots[0].fiscal_year;
  const signature = await sha256Hex(JSON.stringify(["v1", year, knowledge.id, choice.snapshots.map((snapshot) => snapshot.snapshot_id).sort(), units]));
  return { signature, year, knowledgeRunId: knowledge.id };
}

/** 한 단계: 기준이 바뀌었으면 처음부터, 아니면 멈춘 재정주체부터 이어서 대조한다. 일을 했으면 true. */
export async function advanceIntegratedCareClassification(db: SqlDatabase, nowSeconds: number, budgetMs = 12_000): Promise<boolean> {
  const target = await classificationTarget(db);
  if (!target) return false;
  let run = await db.prepare("SELECT signature, entity_index, finished_at FROM fiscal_class_run WHERE id = 1").first<RunRow>();
  if (run?.signature === target.signature && run.finished_at) return false;
  const entities = (await db.prepare("SELECT fiscal_entity_id AS id, name, wa_name FROM fiscal_entity ORDER BY fiscal_entity_id").all<EntityRow>()).results;
  if (!run || run.signature !== target.signature) {
    await db.prepare(
      "INSERT INTO fiscal_class_run (id, signature, fiscal_year, entity_index, entity_total, matched_wiki, matched_keyword, started_at, finished_at) VALUES (1, ?, ?, 0, ?, 0, 0, ?, NULL) " +
        "ON CONFLICT(id) DO UPDATE SET signature = excluded.signature, fiscal_year = excluded.fiscal_year, entity_index = 0, entity_total = excluded.entity_total, matched_wiki = 0, matched_keyword = 0, started_at = excluded.started_at, finished_at = NULL",
    ).bind(target.signature, target.year, entities.length, nowSeconds).run();
    run = { signature: target.signature, entity_index: 0, finished_at: null };
  }
  const started = Date.now();
  const wikiBySido = new Map<string, readonly WikiRow[]>();
  let index = run.entity_index;
  while (index < entities.length && Date.now() - started < budgetMs) {
    const entity = entities[index];
    const sidos = sidoNames(entity.wa_name);
    const wiki: WikiRow[] = [];
    for (const sido of sidos) {
      if (!wikiBySido.has(sido)) {
        wikiBySido.set(sido, (await db.prepare("SELECT service_id, sido, sigungu, name FROM official_service_snapshot WHERE sync_run_id = ? AND sido = ?").bind(target.knowledgeRunId, sido).all<WikiRow>()).results);
      }
      wiki.push(...(wikiBySido.get(sido) ?? []));
    }
    const units = (await db.prepare("SELECT name, dept_prefix FROM fiscal_admin_unit WHERE parent_entity_id = ? AND verification_status = 'VERIFIED'").bind(entity.id).all<UnitRow>()).results;
    const names = wikiFor(entity, wiki, units);
    const projects = (await db.prepare("SELECT fiscal_project_id, name, department_code FROM fiscal_project WHERE fiscal_entity_id = ? AND fiscal_year = ?").bind(entity.id, target.year)
      .all<{ fiscal_project_id: string; name: string; department_code: string }>()).results;
    const statements: SqlStatement[] = [];
    let wikiHits = 0;
    let keywordHits = 0;
    for (const project of projects) {
      const key = nameKey(project.name);
      const hit = (names.get(key) ?? []).find((candidate) => !candidate.prefixes || candidate.prefixes.some((prefix) => project.department_code.startsWith(prefix)));
      const basis = hit ? "wiki_name_match" : key.includes(KEYWORD) ? "name_keyword" : null;
      if (!basis) continue;
      if (hit) wikiHits += 1; else keywordHits += 1;
      statements.push(db.prepare(
        "INSERT INTO fiscal_project_class (fiscal_project_id, class, basis, service_id, service_name, signature, classified_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(fiscal_project_id, class) DO UPDATE SET basis = excluded.basis, service_id = excluded.service_id, service_name = excluded.service_name, signature = excluded.signature, classified_at = excluded.classified_at",
      ).bind(project.fiscal_project_id, INTEGRATED_CARE_CLASS, basis, hit?.row.service_id ?? null, hit?.row.name ?? null, target.signature, nowSeconds));
    }
    for (let start = 0; start < statements.length; start += WRITE_BATCH) await db.batch(statements.slice(start, start + WRITE_BATCH));
    index += 1;
    await db.prepare("UPDATE fiscal_class_run SET entity_index = ?, matched_wiki = matched_wiki + ?, matched_keyword = matched_keyword + ? WHERE id = 1 AND signature = ?")
      .bind(index, wikiHits, keywordHits, target.signature).run();
  }
  if (index >= entities.length) {
    // 새 기준으로 다시 확인되지 않은 옛 분류(위키에서 빠진 사업 등)는 지운다.
    await db.batch([
      db.prepare("DELETE FROM fiscal_project_class WHERE class = ? AND signature <> ?").bind(INTEGRATED_CARE_CLASS, target.signature),
      db.prepare("UPDATE fiscal_class_run SET finished_at = ?, last_finished_at = ? WHERE id = 1 AND signature = ?").bind(nowSeconds, nowSeconds, target.signature),
    ]);
  }
  return true;
}

/** 통합돌봄 분류를 한 번이라도 끝냈으면 그 분류로 통합돌봄 예산을 보인다(그 전에는 세부사업명 「통합돌봄」 범위). */
export async function integratedCareClassVersion(db: SqlDatabase): Promise<string | null> {
  const run = await db.prepare("SELECT signature, last_finished_at FROM fiscal_class_run WHERE id = 1").first<{ signature: string; last_finished_at: number | null }>();
  return run?.last_finished_at ? run.signature.slice(0, 16) + ":" + String(run.last_finished_at) : null;
}

