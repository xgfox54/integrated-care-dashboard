// 정부24 공공서비스와 기존 사업(보건복지부 통합돌봄 사업안내 시행사업)의 동일 사업 후보 판정.
// 이름이 같아도 다른 사업일 수 있고, 이름이 달라도 같은 사업일 수 있으므로 자동 판정은 후보(CANDIDATE)까지만 만든다.
// 근거(이름·지역·소관기관 비교)를 evidence_json에 남기고, 서로 다른 값(지원대상·문의처 등)은 덮어쓰지 않고 conflict_json에 함께 보존한다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "../platform/public-pin.ts";

export const MATCH_RULE_VERSION = "gov24-match-3";
export const CANDIDATE_THRESHOLD = 0.6;
export const STALE_CANDIDATE_NOTE = "자동 정리: " + MATCH_RULE_VERSION + " 규칙에서 후보가 아님(추가지원 표시 차이·시군구 이름 부분 일치 등)";

/**
 * 국비 사업에 지방비로 덧붙인 추가지원 사업 표시(예: 「장애인 활동지원(추가)」, 「(구비)」, 「(서울시추가지원)」).
 * 괄호를 지우고 비교하면 국비 사업과 이름이 같아지지만 예산이 따로인 별도 사업이다.
 */
export function supplementMarker(name: string): string {
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((match) => match[1].replace(/\s+/g, ""));
  const marked = inner.find((text) => /추가|^(구|시|도|군)비$/.test(text));
  if (marked) return marked;
  return /추가지원/.test(name.replace(/\s+/g, "")) ? "추가지원" : "";
}

/** 비교용 이름: 괄호 안 설명·공백·기호를 지우고 끝의 「사업」을 뗀다. */
export function normalizeProgramName(name: string): string {
  return name
    .replace(/\([^)]*\)|\[[^\]]*\]|「|」|『|』/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "")
    .replace(/사업$/, "");
}

const SIDO_SHORT: Readonly<Record<string, readonly string[]>> = {
  서울특별시: ["서울특별시", "서울시", "서울"], 부산광역시: ["부산광역시", "부산시", "부산"], 대구광역시: ["대구광역시", "대구시", "대구"], 인천광역시: ["인천광역시", "인천시", "인천"],
  대전광역시: ["대전광역시", "대전시", "대전"], 울산광역시: ["울산광역시", "울산시", "울산"], 세종특별자치시: ["세종특별자치시", "세종시", "세종"], 경기도: ["경기도", "경기"],
  강원특별자치도: ["강원특별자치도", "강원도", "강원"], 충청북도: ["충청북도", "충북"], 충청남도: ["충청남도", "충남"], 전북특별자치도: ["전북특별자치도", "전라북도", "전북"],
  전남광주통합특별시: ["전남광주통합특별시", "광주광역시", "전라남도", "전남", "광주"], 경상북도: ["경상북도", "경북"], 경상남도: ["경상남도", "경남"], 제주특별자치도: ["제주특별자치도", "제주도", "제주"],
};

export type RegionFit = "SIGUNGU" | "SIDO" | "CENTRAL" | "MISMATCH";

/** 정부24 소관기관명(예: 「서울특별시 중랑구」, 「보건복지부」)과 사업 지역이 맞는지. */
export function regionFit(orgName: string, orgType: string, sido: string, sigungu: string): RegionFit {
  const org = orgName.replace(/\s+/g, " ").trim();
  const sidoNames = SIDO_SHORT[sido] ?? [sido];
  const hasSido = sidoNames.some((name) => org.includes(name));
  const local = sigungu && sigungu !== sido ? sigungu : "";
  // 「서울특별시 성동구」 안의 「동구」처럼 이름 일부만 같은 경우를 막으려고 띄어쓰기 단위로 비교한다.
  const tokens = org.split(" ");
  if (local && tokens.some((token) => token === local || token === local + "청") && (hasSido || !Object.values(SIDO_SHORT).flat().some((name) => org.includes(name)))) return "SIGUNGU";
  if (hasSido && !local) return "SIDO";
  if (hasSido && /(특별시|광역시|특별자치시|도|특별자치도)$/.test(org)) return "SIDO";
  // 「구리도시공사」「서울시설공단」「인천교통공사」 같은 지방공기업은 이름 앞 지역에서만 운영한다.
  const corp = /^(?!한국|국민|국가)(.+?)(공공시설관리공단|시설관리공단|도시관리공사|도시개발공사|도시공사|시설공단|교통공사)$/.exec(org.replace(/\s+/g, ""));
  if (corp) {
    const place = corp[1];
    const sidoHit = Object.entries(SIDO_SHORT).map(([key, names]) => [key, names.filter((name) => place.startsWith(name)).sort((a, b) => b.length - a.length)[0]] as const).find(([, name]) => name);
    const rest = sidoHit ? place.slice(sidoHit[1]!.length) : place;
    if (sidoHit && sidoHit[0] !== sido) return "MISMATCH";
    if (!rest) return sidoHit ? "SIDO" : "MISMATCH";
    const base = (name: string) => name.replace(/(시|군|구)$/, "");
    return local && base(rest) === base(local) ? "SIGUNGU" : "MISMATCH";
  }
  if (/중앙행정기관|공공기관/.test(orgType) || /부$|처$|청$|위원회$|공단$|공사$/.test(org) && !hasSido) return "CENTRAL";
  return "MISMATCH";
}

export interface ProgramRow {
  readonly service_id: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly category: string;
  readonly subcategory: string;
  readonly name: string;
  readonly provider: string;
  readonly target: string;
}

export interface Gov24Row {
  readonly service_id: string;
  readonly name: string;
  readonly org_name: string | null;
  readonly org_type: string | null;
  readonly target: string | null;
  readonly contact: string | null;
  readonly apply_method: string | null;
  readonly modified_at: string | null;
}

export interface MatchScore {
  readonly score: number;
  readonly nameRule: "EXACT_NORMALIZED" | "REGION_PREFIX_STRIPPED";
  readonly regionFit: RegionFit;
}

/** 이름 규칙(0.6 또는 0.45) + 지역(시·군·구 0.3, 시·도 0.15, 중앙 0.05, 불일치 −0.5). 불일치는 후보로 만들지 않는다. */
export function scoreMatch(gov: Gov24Row, program: ProgramRow): MatchScore | null {
  const govName = normalizeProgramName(gov.name);
  const programName = normalizeProgramName(program.name);
  if (!govName || !programName) return null;
  // 한쪽만 추가지원(지방비) 표시가 있으면 국비 사업과 다른 사업이다.
  if (Boolean(supplementMarker(gov.name)) !== Boolean(supplementMarker(program.name))) return null;
  const stripped = (name: string) => {
    let out = name;
    for (const names of Object.values(SIDO_SHORT)) for (const prefix of names) if (out.startsWith(prefix.replace(/\s/g, ""))) out = out.slice(prefix.length);
    if (program.sigungu && out.startsWith(program.sigungu)) out = out.slice(program.sigungu.length);
    return out;
  };
  let nameRule: MatchScore["nameRule"] | null = null;
  let score = 0;
  if (govName === programName) {
    nameRule = "EXACT_NORMALIZED";
    score = 0.6;
  } else if (stripped(govName).length >= 4 && stripped(govName) === stripped(programName)) {
    nameRule = "REGION_PREFIX_STRIPPED";
    score = 0.45;
  }
  if (!nameRule) return null;
  const fit = regionFit(gov.org_name ?? "", gov.org_type ?? "", program.sido, program.sigungu);
  if (fit === "MISMATCH") return null;
  score += fit === "SIGUNGU" ? 0.3 : fit === "SIDO" ? 0.15 : 0.05;
  return { score: Math.round(score * 100) / 100, nameRule, regionFit: fit };
}

export function wikiTargetId(program: ProgramRow): string {
  const part = (value: string) => value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
  return "service:" + [program.service_id, program.sido, program.sigungu, program.category, program.subcategory, program.name].map(part).join("|");
}

/** 정부24 서비스 중 아직 이 규칙으로 비교하지 않았거나 내용이 바뀐 것을 limit개씩 기존 사업과 비교해 후보를 만든다. */
export async function advanceGov24Matching(db: SqlDatabase, now: number, limit = 300): Promise<{ readonly checked: number; readonly candidates: number }> {
  const services = await db.prepare("SELECT service_id, name, org_name, org_type, target, contact, apply_method, modified_at FROM gov24_service WHERE presence = 'PRESENT' AND (match_checked_hash IS NULL OR match_checked_hash <> ? || '|' || COALESCE(modified_at, '')) LIMIT ?")
    .bind(MATCH_RULE_VERSION, limit).all<Gov24Row>();
  if (!services.results.length) return { checked: 0, candidates: 0 };
  const programs = await db.prepare("SELECT service_id, CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END AS sido, sigungu, category, subcategory, name, provider, target FROM official_service_snapshot WHERE sync_run_id = " + PUBLIC_KNOWLEDGE_RUN_SQL).all<ProgramRow>();
  const byName = new Map<string, ProgramRow[]>();
  for (const program of programs.results) {
    for (const key of new Set([normalizeProgramName(program.name)])) {
      const list = byName.get(key) ?? [];
      list.push(program);
      byName.set(key, list);
    }
  }
  const statements: SqlStatement[] = [];
  let candidates = 0;
  for (const gov of services.results) {
    const hash = MATCH_RULE_VERSION + "|" + (gov.modified_at ?? "");
    const pool = new Map<string, ProgramRow>();
    for (const program of byName.get(normalizeProgramName(gov.name)) ?? []) pool.set(wikiTargetId(program), program);
    for (const [name, list] of byName) {
      if (name.length >= 4 && normalizeProgramName(gov.name).endsWith(name) && name !== normalizeProgramName(gov.name)) for (const program of list) pool.set(wikiTargetId(program), program);
    }
    const kept: string[] = [];
    for (const [targetId, program] of pool) {
      const match = scoreMatch(gov, program);
      if (!match || match.score < CANDIDATE_THRESHOLD) continue;
      candidates += 1;
      kept.push(targetId);
      const evidence = { rule: MATCH_RULE_VERSION, name_rule: match.nameRule, region_fit: match.regionFit, gov24: { service_id: gov.service_id, name: gov.name, org_name: gov.org_name, modified_at: gov.modified_at }, program: { name: program.name, sido: program.sido, sigungu: program.sigungu, provider: program.provider } };
      const conflicts = [
        gov.target && program.target && normalizeProgramName(gov.target) !== normalizeProgramName(program.target) ? { field: "지원대상", gov24: gov.target.slice(0, 300), program: program.target.slice(0, 300) } : null,
      ].filter(Boolean);
      // 규칙 버전만 바뀐 근거는 내용 변경이 아니므로 확인된 연결을 재검토로 돌리지 않는다.
      statements.push(db.prepare("INSERT INTO program_ext_link (link_id, source_kind, source_id, target_kind, target_id, target_label, score, evidence_json, status, conflict_json, created_at, updated_at) VALUES (?, 'GOV24', ?, 'service', ?, ?, ?, ?, 'CANDIDATE', ?, ?, ?) ON CONFLICT(source_kind, source_id, target_kind, target_id) DO UPDATE SET score = excluded.score, evidence_json = excluded.evidence_json, conflict_json = excluded.conflict_json, updated_at = excluded.updated_at, status = CASE WHEN program_ext_link.status = 'VERIFIED' AND json_remove(program_ext_link.evidence_json, '$.rule') <> json_remove(excluded.evidence_json, '$.rule') THEN 'REVIEW_REQUIRED' ELSE program_ext_link.status END")
        .bind("gov24:" + gov.service_id + "->" + targetId, gov.service_id, targetId, program.name + " · " + program.sido + (program.sigungu && program.sigungu !== program.sido ? " " + program.sigungu : ""), match.score, JSON.stringify(evidence), conflicts.length ? JSON.stringify(conflicts) : null, now, now));
    }
    // 지금 규칙으로는 후보가 아닌 예전 후보만 정리한다. 사람이 확인·제외한 연결은 건드리지 않는다.
    statements.push(db.prepare("UPDATE program_ext_link SET status = 'REJECTED', reviewed_at = ?, review_note = ?, updated_at = ? WHERE source_kind = 'GOV24' AND source_id = ? AND status = 'CANDIDATE' AND target_id NOT IN (SELECT value FROM json_each(?))")
      .bind(now, STALE_CANDIDATE_NOTE, now, gov.service_id, JSON.stringify(kept)));
    statements.push(db.prepare("UPDATE gov24_service SET match_checked_hash = ?, match_checked_at = ? WHERE service_id = ?").bind(hash, now, gov.service_id));
  }
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
  return { checked: services.results.length, candidates };
}
