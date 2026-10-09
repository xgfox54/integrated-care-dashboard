// 사업–재정사업 연결(작업지시서 v5 §24.3). 이름 유사도는 후보를 만드는 데만 쓰고, 공개는 관리자 검토(VERIFIED) 뒤에만 한다.
// 연결돼도 재정사업 금액을 사업별로 나누거나 반복 합산하지 않는다(배분 근거가 없으면 '관련 재정사업'으로만 표시).
import { serviceWikiKey } from "../dataset.ts";
import type { SqlDatabase } from "../sql-database.ts";

export const LINK_MAPPING_VERSION = "fiscal-program-name-v1";
export const MIN_SIMILARITY = 0.5;
const STOP_WORDS = /(사업|지원|운영|서비스|추진|사업비|성인지예산|전환사업|\([^)]*\))/g;

export function nameCore(name: string): string {
  return name.normalize("NFKC").replace(STOP_WORDS, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

/** 글자 2-gram Dice 유사도(0~1). */
export function similarity(left: string, right: string): number {
  const grams = (text: string) => {
    const list: string[] = [];
    for (let index = 0; index < text.length - 1; index += 1) list.push(text.slice(index, index + 2));
    return list;
  };
  const a = grams(nameCore(left));
  const b = grams(nameCore(right));
  if (!a.length || !b.length) return 0;
  const pool = new Map<string, number>();
  for (const gram of b) pool.set(gram, (pool.get(gram) ?? 0) + 1);
  let shared = 0;
  for (const gram of a) {
    const count = pool.get(gram) ?? 0;
    if (count > 0) {
      shared += 1;
      pool.set(gram, count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

interface FiscalRow { readonly fiscal_project_id: string; readonly name: string; readonly fiscal_entity_id: string; readonly snapshot_id: string }
interface MappingRow { readonly fiscal_entity_id: string; readonly region_id: string; readonly mapping_id: string }
interface ProgramRow { readonly serviceId: string; readonly sido: string; readonly sigungu: string; readonly category: string; readonly subcategory: string; readonly name: string }

/** 공개 재정 snapshot의 재정사업과, 검증된 재정주체→지역 매핑 안의 시행사업을 이름으로 대조해 후보를 만든다(숨김). */
export async function generateFiscalLinkCandidates(db: SqlDatabase, nowSeconds: number, limit = 300): Promise<{ readonly examined: number; readonly created: number }> {
  const run = await db.prepare("SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1").first<{ id: string }>();
  if (!run) return { examined: 0, created: 0 };
  const mappings = (await db.prepare("SELECT fiscal_entity_id, region_id, mapping_id FROM fiscal_region_mapping WHERE verification_status = 'VERIFIED' AND relation = 'jurisdiction'").all<MappingRow>()).results;
  let examined = 0;
  let created = 0;
  for (const mapping of mappings) {
    const projects = (await db.prepare(
      "SELECT DISTINCT p.fiscal_project_id, p.name, p.fiscal_entity_id, m.snapshot_id FROM fiscal_snapshot_member m JOIN fiscal_snapshot s ON s.snapshot_id = m.snapshot_id " +
        "JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id WHERE s.status = 'PUBLISHED' AND p.fiscal_entity_id = ?",
    ).bind(mapping.fiscal_entity_id).all<FiscalRow>()).results;
    const match = /^region:([^|]+)(?:\|(.+))?$/.exec(mapping.region_id);
    if (!match) continue;
    const sido = match[1];
    const sidoNames = sido === "전남광주통합특별시" ? ["전남광주통합특별시", "광주광역시", "전라남도"] : [sido];
    const programs = (await db.prepare(
      "SELECT service_id AS serviceId, CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END AS sido, sigungu, category, subcategory, name FROM official_service_snapshot " +
        "WHERE sync_run_id = ? AND sido IN (" + sidoNames.map(() => "?").join(", ") + ")" + (match[2] ? " AND sigungu = ?" : ""),
    ).bind(run.id, ...sidoNames, ...(match[2] ? [match[2]] : [])).all<ProgramRow>()).results;
    const statements = [];
    for (const project of projects) {
      examined += 1;
      for (const program of programs) {
        const score = similarity(project.name, program.name);
        if (score < MIN_SIMILARITY) continue;
        const target = serviceWikiKey(program);
        const linkId = "lk:" + project.fiscal_project_id + "→" + target.slice(0, 120);
        statements.push(db.prepare(
          "INSERT OR IGNORE INTO cross_domain_link (link_id, source_type, source_id, target_type, target_id, relation, source_component_id, evidence_json, mapping_version, verification_status, public_status, candidate_basis, created_at) " +
            "VALUES (?, 'fiscal_project', ?, 'implementation', ?, 'fiscalProjectFor', ?, ?, ?, 'CANDIDATE', 'HIDDEN', ?, ?)",
        ).bind(
          linkId, project.fiscal_project_id, target, project.snapshot_id,
          JSON.stringify({ fiscal_project_name: project.name, program_name: program.name, program_region: [...new Set([program.sido, program.sigungu].filter(Boolean))].join(" "), region_mapping: mapping.mapping_id, similarity: Number(score.toFixed(3)) }),
          LINK_MAPPING_VERSION,
          "이름 유사도 " + score.toFixed(2) + " + 검증된 재정주체→지역 매핑(" + mapping.mapping_id + "). 후보일 뿐이며 검토 전 비공개.",
          nowSeconds,
        ));
        if (statements.length >= limit) break;
      }
      if (statements.length >= limit) break;
    }
    for (let start = 0; start < statements.length; start += 50) {
      const results = await db.batch(statements.slice(start, start + 50));
      created += results.filter((result) => (result as { meta?: { changes?: number }; changes?: number })?.meta?.changes === 1 || (result as { changes?: number })?.changes === 1).length;
    }
  }
  return { examined, created };
}

/**
 * 관리자의 확인·제외. 판정 출처를 reviewer로 남기고 판정 번호를 올린다(D-03). 자동 규칙은 reviewer 판정을 바꾸지 않으며,
 * 자동 작업이 이 연결을 읽은 뒤 사람이 판정하면 번호가 달라져 자동 쓰기가 충돌로 건너뛴다.
 */
export async function reviewLink(db: SqlDatabase, linkId: string, decision: "verify" | "reject", nowSeconds: number): Promise<boolean> {
  const verified = decision === "verify";
  const status = verified ? "VERIFIED" : "REJECTED";
  const publicStatus = verified ? "PUBLIC" : "HIDDEN";
  const before = await db.prepare("SELECT verification_status, public_status, decision_origin, decision_revision, reviewed_at FROM cross_domain_link WHERE link_id = ?")
    .bind(linkId).first<{ verification_status: string; public_status: string; decision_origin: string; decision_revision: number; reviewed_at: number | null }>();
  if (!before) return false;
  await db.batch([
    db.prepare("UPDATE cross_domain_link SET verification_status = ?, public_status = ?, reviewed_at = ?, decision_origin = 'reviewer', decision_rule = '', decision_revision = decision_revision + 1 WHERE link_id = ?")
      .bind(status, publicStatus, nowSeconds, linkId),
    db.prepare(
      "INSERT INTO cross_domain_link_decision_log (link_id, revision, at, actor, action, before_status, before_public, before_origin, before_reviewed_at, after_status, after_public, after_origin, rule_id, reason) " +
        "SELECT link_id, decision_revision, ?, 'reviewer', ?, ?, ?, ?, ?, verification_status, public_status, decision_origin, '', '관리자 판정' FROM cross_domain_link WHERE link_id = ?",
    ).bind(nowSeconds, decision, before.verification_status, before.public_status, before.decision_origin, before.reviewed_at, linkId),
  ]);
  const row = await db.prepare("SELECT verification_status, decision_origin FROM cross_domain_link WHERE link_id = ?").bind(linkId).first<{ verification_status: string; decision_origin: string }>();
  return row?.verification_status === status && row.decision_origin === "reviewer";
}

export interface LinkRow {
  readonly link_id: string;
  readonly source_id: string;
  readonly target_id: string;
  readonly relation: string;
  readonly evidence_json: string;
  readonly candidate_basis: string;
  readonly verification_status: string;
  readonly reviewed_at: number | null;
  readonly decision_origin?: string;
}

export async function listLinks(db: SqlDatabase, status: string, limit = 100): Promise<LinkRow[]> {
  return (await db.prepare("SELECT link_id, source_id, target_id, relation, evidence_json, candidate_basis, verification_status, reviewed_at, decision_origin FROM cross_domain_link WHERE verification_status = ? ORDER BY created_at DESC, link_id LIMIT ?")
    .bind(status, limit).all<LinkRow>()).results;
}

/** 공개(검토 완료) 연결만. 공개 시각 상한(reviewed_at)이 있으면 공개본 이후 연결은 빼고 돌려준다. */
export async function verifiedLinksFor(db: SqlDatabase, implementationId: string, reviewedBefore: number | null): Promise<LinkRow[]> {
  return (await db.prepare(
    "SELECT link_id, source_id, target_id, relation, evidence_json, candidate_basis, verification_status, reviewed_at FROM cross_domain_link " +
      "WHERE target_type = 'implementation' AND target_id = ? AND verification_status = 'VERIFIED' AND public_status = 'PUBLIC' AND (? IS NULL OR reviewed_at <= ?) ORDER BY source_id",
  ).bind(implementationId, reviewedBefore, reviewedBefore).all<LinkRow>()).results;
}

