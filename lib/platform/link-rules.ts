// 사업–재정사업 연결 자동 판정(2026-10-05 운영자 지시, 2026-10-09 적용 범위 제한 D-03).
// 제주 연결 후보를 웹 검색·사업안내로 하나씩 확인한 결과를 규칙 표로 옮겼다. 규칙마다 적용 범위(재정주체·지역·회계연도·효력기간·근거)를 둔다.
// 규칙은 위에서부터 차례로 보고 사업명이 처음 맞는 규칙 하나만 쓴다(제외 규칙을 같은 이름의 확인 규칙보다 먼저 둔다).
// 그 규칙의 적용 범위 밖이면 다른 규칙으로 넘어가지 않고 판정하지 않는다(후보 유지). 범위는 사업명·자유서술 지역이 아니라
// 재정사업 원천(fiscal_project의 재정주체·회계연도), 검증된 재정주체→지역 매핑(fiscal_region_mapping), 대상 사업 식별자의 시·도로 확인한다.
// 사람이 확인·제외한 연결(decision_origin = reviewer)과 판정 주체를 알 수 없는 기존 자료(legacy_unknown)는 자동 작업이 바꾸지 않는다.
import type { SqlDatabase } from "../sql-database.ts";

export const LINK_RULE_VERSION = "link-rules-2026-10-09-scoped";

export type LinkDecision = "verify" | "reject";

export interface RuleScope {
  readonly id: string;
  /** 재정 원천의 재정주체 ID(fiscal_project.fiscal_entity_id). */
  readonly fiscalEntityIds: readonly string[];
  /** 대상 사업 식별자의 시·도와 검증된 재정주체→지역 매핑의 시·도가 모두 이 안에 있어야 한다. */
  readonly regionSido: readonly string[];
  readonly fiscalYears: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly basisDocument: string;
  /** 전국 공통 규칙으로 쓰려면 전국 적용 근거를 여기에 적는다. 비어 있으면 위 범위로만 쓴다. */
  readonly nationwideBasis: string;
}

/** 2026-10-05 운영자 확인: 제주본청 재정사업(2025·2026)과 제주 시행사업 연결 후보를 하나씩 확인한 결과. */
export const JEJU_SCOPE_2026_10_05: RuleScope = {
  id: "scope:jeju-laf-4900000:2025-2026",
  fiscalEntityIds: ["lofin:laf:4900000"],
  regionSido: ["제주특별자치도"],
  fiscalYears: ["2025", "2026"],
  effectiveFrom: "2025-01-01",
  effectiveTo: "2026-12-31",
  basisDocument: "운영자 확인 2026-10-05: 검증 매핑 map:lofin-laf-4900000의 제주 연결 후보를 웹 검색·사업안내로 개별 확인(jeju-link-rules-2026-10-05)",
  nationwideBasis: "",
};

interface LinkRule {
  readonly id: string;
  readonly fiscal: RegExp;
  readonly program: RegExp;
  readonly decision: LinkDecision;
  readonly reason: string;
  readonly scope: RuleScope;
}

/** 대조용 이름: 글자·숫자만 남긴다(띄어쓰기·괄호·가운뎃점 제거). */
export function linkNameKey(name: string): string {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

const J = JEJU_SCOPE_2026_10_05;
const rule = (id: string, fiscal: RegExp, program: RegExp, decision: LinkDecision, reason: string): LinkRule => ({ id, fiscal, program, decision, reason, scope: J });

const LINK_RULES: readonly LinkRule[] = [
  rule("jeju-01", /금연/, /재활/, "reject", "금연지원과 지역사회중심 재활사업은 다른 사업"),
  rule("jeju-02", /지역사회서비스투자/, /재활/, "reject", "지역사회서비스투자사업(바우처)은 지역사회중심 재활사업과 다름"),
  rule("jeju-03", /장기요양서비스개선/, /재가급여|통합재가/, "reject", "포괄 사업명이라 특정 재가급여 사업과 같다고 볼 근거 없음"),
  rule("jeju-04", /활동지원/, /상해보험/, "reject", "활동지원과 상해보험 가입은 다른 사업"),
  rule("jeju-05", /장애인(단체|회관|교육|취업|고용|연금|복지서비스|쉼터)/, /활동지원/, "reject", "단체·회관·교육·취업·연금·쉼터 사업은 장애인 활동지원 서비스와 다름"),
  rule("jeju-06", /발달장애인주간활동/, /활동지원/, "reject", "발달장애인 주간활동서비스는 장애인 활동지원과 별개 바우처"),
  rule("jeju-07", /^(중증)?장애인활동지원/, /^장애인활동지원서비스$/, "verify", "장애인 활동지원(가산급여·추가지원 포함) 재정사업"),
  rule("jeju-08", /발달장애인긴급돌봄/, /긴급돌봄지원/, "reject", "발달장애인 긴급돌봄은 긴급돌봄지원사업(일반)과 다른 사업"),
  rule("jeju-09", /^긴급돌봄지원사업$/, /^긴급돌봄지원사업$/, "verify", "사업명 일치"),
  rule("jeju-10", /치매안심센터/, /^치매안심센터$/, "verify", "보건소별 치매안심센터 운영 재정사업"),
  rule("jeju-11", /치매공공후견/, /^치매공공후견지원$/, "verify", "치매공공후견(지원·광역지원단) 재정사업"),
  rule("jeju-12", /노인맞춤돌봄/, /^노인맞춤돌봄서비스$/, "verify", "사업명 일치"),
  rule("jeju-13", /응급안전/, /응급안전안심/, "verify", "독거노인·(중증)장애인 응급안전안심서비스 재정사업"),
  rule("jeju-14", /제주형건강주치의/, /장애인건강주치의/, "reject", "제주형 건강주치의와 장애인 건강주치의는 다른 사업"),
  rule("jeju-15", /제주형건강주치의/, /^제주형건강주치의/, "verify", "사업명 일치"),
  rule("jeju-16", /여성장애인교육/, /가사도우미/, "reject", "여성장애인 교육사업과 가사도우미 지원은 다른 사업"),
  rule("jeju-17", /장애인가정도우미/, /여성장애인가사도우미/, "reject", "장애인가정 도우미와 여성장애인 가사도우미는 대상이 다른 사업"),
  rule("jeju-18", /여성장애인(가사도우미|돌봄지원)/, /여성장애인가사도우미/, "verify", "여성장애인 가사·자녀돌봄 도우미 지원 재정사업(2026 제주 사업 공고 확인)"),
  rule("jeju-19", /보조기기대여센터/, /보조기기교부/, "reject", "대여센터 운영과 보조기기 교부는 다른 사업"),
  rule("jeju-20", /장애인보조기기(교부|지원)/, /보조기기교부/, "verify", "장애인 보조기기 교부(지원) 재정사업"),
  rule("jeju-21", /어르신행복택시/, /어르신행복택시/, "verify", "사업명 일치"),
  rule("jeju-22", /장애인주택개조/, /장애인주택개조/, "verify", "사업명 일치"),
  rule("jeju-23", /방문건강관리/, /AIIoT/, "reject", "AI·IoT 건강관리는 방문건강관리사업과 별도 사업"),
  rule("jeju-24", /^방문건강관리사업/, /방문건강관리사업$/, "verify", "방문건강관리사업 재정사업"),
  rule("jeju-25", /고혈압당뇨병등록관리/, /고혈압당뇨병등록관리/, "verify", "사업명 일치"),
  rule("jeju-26", /교통약자이동지원센터/, /교통약자지원/, "verify", "교통약자이동지원센터 운영 재정사업"),
  rule("jeju-27", /장애인자립지원시범/, /자립지원시범/, "verify", "장애인 지역사회 자립지원 시범사업 재정사업"),
  rule("jeju-28", /의료취약지원격협진/, /의료취약지원격협진/, "verify", "ICT 활용 의료취약지 원격협진 재정사업"),
  rule("jeju-29", /찾아가는건강돌봄/, /^찾아가는건강돌봄서비스/, "verify", "찾아가는 건강돌봄 서비스(어르신 안심주택 포함, 2026 서귀포시 보도 확인)"),
  rule("jeju-30", /의료급여/, /재가의료급여/, "reject", "의료급여(사업추진)는 재가 의료급여 시범사업과 같다고 볼 근거 없음"),
  rule("jeju-31", /보행환경/, /안전생활환경/, "reject", "보행환경 조성과 안전생활환경 조성은 다른 사업"),
  rule("jeju-32", /저소득노인생활안정/, /노인진료비/, "reject", "생활안정지원과 노인 진료비는 다른 사업"),
  rule("jeju-33", /홀로사는노인지원센터/, /에너지드림/, "reject", "지원센터 운영과 냉·난방비 지원은 다른 사업"),
  rule("jeju-34", /노인안전생활지원/, /안전생활환경/, "reject", "노인안전생활지원과 안전생활환경 조성사업은 다른 사업"),
  rule("jeju-35", /장애인지역사회재활시설/, /./, "reject", "재활시설 운영 지원은 자립지원 시범·통합돌봄 사업과 다름"),
  rule("jeju-36", /삼무형주거환경|제주형주거환경/, /건강안심주거환경/, "reject", "제주(삼무)형 주거환경개선과 건강안심 주거환경 개선은 다른 사업"),
  rule("jeju-37", /^지역사회통합돌봄사업$/, /제주형장애인/, "reject", "지역사회통합돌봄(일반)과 제주형 장애인 통합돌봄은 다른 사업"),
];

/** 연결 하나의 실제 범위. 모두 원천·식별자·검증 매핑에서 읽는다. 하나라도 비면 범위를 확인하지 못한 것으로 본다. */
export interface LinkContext {
  readonly fiscalEntityId: string | null;
  readonly fiscalYear: string | null;
  /** 검증된(VERIFIED) 재정주체→지역 매핑의 시·도. 매핑의 재정주체가 원천과 다르면 null. */
  readonly mappedSido: string | null;
  /** 대상 시행사업 식별자(service:…|시도|시군구|…)의 시·도. */
  readonly targetSido: string | null;
}

export type LinkJudgement =
  | { readonly kind: "decided"; readonly decision: LinkDecision; readonly reason: string; readonly ruleId: string; readonly scopeId: string }
  | { readonly kind: "out_of_scope"; readonly reason: string; readonly ruleId: string; readonly scopeId: string }
  | { readonly kind: "no_rule" };

function scopeMismatch(scope: RuleScope, context: LinkContext): string | null {
  if (!context.fiscalEntityId || !context.fiscalYear || !context.mappedSido || !context.targetSido) return "원천 재정주체·회계연도·검증 매핑·대상 시·도 중 확인하지 못한 값이 있음";
  if (!scope.fiscalEntityIds.includes(context.fiscalEntityId)) return "재정주체 " + context.fiscalEntityId + "는 규칙 적용 범위가 아님";
  if (!scope.fiscalYears.includes(context.fiscalYear)) return "회계연도 " + context.fiscalYear + "는 규칙 적용 범위가 아님";
  if (!scope.regionSido.includes(context.mappedSido) || !scope.regionSido.includes(context.targetSido) || context.mappedSido !== context.targetSido) {
    return "지역(매핑 " + context.mappedSido + " / 대상 " + context.targetSido + ")이 규칙 적용 범위와 다름";
  }
  return null;
}

/** 사업명 짝과 실제 범위로 판정한다. 범위를 주지 않으면 이름만 맞는지 보며 확정하지 않는다(out_of_scope). */
export function judgeLink(fiscalName: string, programName: string, context?: LinkContext): LinkJudgement {
  const fiscal = linkNameKey(fiscalName);
  const program = linkNameKey(programName);
  const found = LINK_RULES.find((item) => item.fiscal.test(fiscal) && item.program.test(program));
  if (!found) return { kind: "no_rule" };
  const mismatch = context ? scopeMismatch(found.scope, context) : "적용 범위를 확인할 자료가 없음";
  if (mismatch) return { kind: "out_of_scope", reason: mismatch, ruleId: found.id, scopeId: found.scope.id };
  return { kind: "decided", decision: found.decision, reason: found.reason, ruleId: found.id, scopeId: found.scope.id };
}

/** 대상 시행사업 식별자(service:<id>|시도|시군구|…)에서 시·도. */
export function targetSidoOf(targetId: string): string | null {
  const parts = targetId.split("|");
  return targetId.startsWith("service:") && parts.length >= 3 && parts[1] ? parts[1] : null;
}

interface LinkRecord {
  readonly link_id: string;
  readonly target_id: string;
  readonly evidence_json: string;
  readonly verification_status: string;
  readonly public_status: string;
  readonly reviewed_at: number | null;
  readonly decision_origin: string;
  readonly decision_revision: number;
  readonly fiscal_entity_id: string | null;
  readonly fiscal_year: string | null;
  readonly mapping_entity_id: string | null;
  readonly mapping_region_id: string | null;
  readonly mapping_status: string | null;
}

export interface LinkRuleChange {
  readonly link_id: string;
  readonly kind: "verify" | "reject" | "revert_to_candidate";
  readonly before: { readonly status: string; readonly public_status: string; readonly origin: string; readonly revision: number; readonly reviewed_at: number | null };
  readonly after: { readonly status: string; readonly public_status: string; readonly origin: string };
  readonly reason: string;
  readonly rule_id: string;
  readonly scope_id: string;
}

export interface LinkRulePlan {
  readonly rule_version: string;
  readonly examined: number;
  readonly changes: readonly LinkRuleChange[];
  readonly unchanged: number;
  readonly no_rule: number;
  readonly out_of_scope_candidates: number;
  readonly protected_reviewer: number;
  readonly protected_legacy_unknown: number;
  readonly unreadable: number;
}

function contextOf(row: LinkRecord): LinkContext {
  const mappingOk = row.mapping_status === "VERIFIED" && row.mapping_entity_id !== null && row.mapping_entity_id === row.fiscal_entity_id;
  const mapped = mappingOk ? /^region:([^|]+)/.exec(row.mapping_region_id ?? "")?.[1] ?? null : null;
  return { fiscalEntityId: row.fiscal_entity_id, fiscalYear: row.fiscal_year, mappedSido: mapped, targetSido: targetSidoOf(row.target_id) };
}

const LINK_QUERY =
  "SELECT l.link_id, l.target_id, l.evidence_json, l.verification_status, l.public_status, l.reviewed_at, l.decision_origin, l.decision_revision, " +
  "p.fiscal_entity_id, p.fiscal_year, m.fiscal_entity_id AS mapping_entity_id, m.region_id AS mapping_region_id, m.verification_status AS mapping_status " +
  "FROM cross_domain_link l LEFT JOIN fiscal_project p ON p.fiscal_project_id = l.source_id " +
  "LEFT JOIN fiscal_region_mapping m ON m.mapping_id = json_extract(l.evidence_json, '$.region_mapping') " +
  "WHERE l.relation = 'fiscalProjectFor' ORDER BY l.link_id";

/**
 * 바꿀 연결 목록(dry-run). 자동 작업이 바꿀 수 있는 것은 판정 전 후보(decision_origin '')와 자동 규칙이 마지막으로 정한 연결(auto_rule)뿐이다.
 * 자동 규칙 판정이 지금 규칙·범위로 뒷받침되지 않으면 후보(비공개)로 되돌린다. 사람 판정·출처 불명 자료는 세기만 한다.
 */
export async function planLinkRules(db: SqlDatabase): Promise<LinkRulePlan> {
  const rows = (await db.prepare(LINK_QUERY).all<LinkRecord>()).results;
  const changes: LinkRuleChange[] = [];
  let unchanged = 0, noRule = 0, outOfScope = 0, reviewer = 0, legacy = 0, unreadable = 0;
  for (const row of rows) {
    if (row.decision_origin === "reviewer") { reviewer += 1; continue; }
    if (row.decision_origin !== "" && row.decision_origin !== "auto_rule") { legacy += 1; continue; }
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(row.evidence_json) as Record<string, unknown>;
    } catch {
      unreadable += 1;
      continue;
    }
    const before = { status: row.verification_status, public_status: row.public_status, origin: row.decision_origin, revision: row.decision_revision, reviewed_at: row.reviewed_at };
    const judged = judgeLink(String(evidence.fiscal_project_name ?? ""), String(evidence.program_name ?? ""), contextOf(row));
    const isAuto = row.decision_origin === "auto_rule";
    if (judged.kind === "decided") {
      const status = judged.decision === "verify" ? "VERIFIED" : "REJECTED";
      if (row.verification_status === status) { unchanged += 1; continue; }
      changes.push({ link_id: row.link_id, kind: judged.decision, before, after: { status, public_status: status === "VERIFIED" ? "PUBLIC" : "HIDDEN", origin: "auto_rule" }, reason: judged.reason, rule_id: judged.ruleId, scope_id: judged.scopeId });
      continue;
    }
    if (judged.kind === "no_rule") noRule += 1; else if (!isAuto) outOfScope += 1;
    if (isAuto && row.verification_status !== "CANDIDATE") {
      changes.push({
        link_id: row.link_id, kind: "revert_to_candidate", before, after: { status: "CANDIDATE", public_status: "HIDDEN", origin: "" },
        reason: judged.kind === "no_rule" ? "자동 판정을 뒷받침하는 현행 규칙이 없음" : "자동 판정 규칙의 적용 범위 밖: " + judged.reason,
        rule_id: judged.kind === "no_rule" ? "" : judged.ruleId, scope_id: judged.kind === "no_rule" ? "" : judged.scopeId,
      });
    }
  }
  return { rule_version: LINK_RULE_VERSION, examined: rows.length, changes, unchanged, no_rule: noRule, out_of_scope_candidates: outOfScope, protected_reviewer: reviewer, protected_legacy_unknown: legacy, unreadable };
}

export interface LinkRuleApplyResult extends Omit<LinkRulePlan, "changes"> {
  readonly verified: number;
  readonly rejected: number;
  readonly reverted: number;
  /** 읽은 뒤 사람이 바꾸는 등 조건부 갱신이 맞지 않아 건너뛴 연결. */
  readonly conflicts: readonly string[];
}

function changed(result: unknown): boolean {
  const value = result as { meta?: { changes?: number }; changes?: number } | null;
  return (value?.meta?.changes ?? value?.changes ?? 0) === 1;
}

/**
 * 계획대로 적용한다. 각 연결은 읽을 때의 판정 번호(decision_revision)·상태·출처가 그대로일 때만 바뀐다(사람이 그 사이 판정하면 충돌로 남김).
 * 같은 규칙을 다시 돌리면 바꿀 것이 없어 이력도 늘지 않는다.
 */
export async function applyLinkRules(db: SqlDatabase, nowSeconds: number, planned?: LinkRulePlan): Promise<LinkRuleApplyResult> {
  const plan = planned ?? await planLinkRules(db);
  let verified = 0, rejected = 0, reverted = 0;
  const conflicts: string[] = [];
  for (const change of plan.changes) {
    const current = await db.prepare("SELECT evidence_json FROM cross_domain_link WHERE link_id = ?").bind(change.link_id).first<{ evidence_json: string }>();
    if (!current) { conflicts.push(change.link_id); continue; }
    let evidence: Record<string, unknown>;
    try { evidence = JSON.parse(current.evidence_json) as Record<string, unknown>; } catch { conflicts.push(change.link_id); continue; }
    const autoReview = { rule_version: LINK_RULE_VERSION, rule_id: change.rule_id, scope_id: change.scope_id, action: change.kind, reason: change.reason, previous_status: change.before.status, previous_origin: change.before.origin, at: nowSeconds };
    const next = JSON.stringify({ ...evidence, auto_review: autoReview });
    const revision = change.before.revision + 1;
    const ruleRef = change.rule_id ? LINK_RULE_VERSION + "#" + change.rule_id : LINK_RULE_VERSION;
    const results = await db.batch([
      db.prepare(
        "UPDATE cross_domain_link SET verification_status = ?, public_status = ?, reviewed_at = ?, evidence_json = ?, decision_origin = ?, decision_rule = ?, decision_revision = ? " +
          "WHERE link_id = ? AND decision_revision = ? AND decision_origin = ? AND verification_status = ? AND public_status = ?",
      ).bind(
        change.after.status, change.after.public_status, change.after.status === "CANDIDATE" ? null : nowSeconds, next, change.after.origin,
        change.after.origin === "auto_rule" ? ruleRef : "", revision,
        change.link_id, change.before.revision, change.before.origin, change.before.status, change.before.public_status,
      ),
      // 이력: 위 갱신이 실제로 일어난 경우에만 남는다(같은 batch 안에서 새 번호·근거로 확인).
      db.prepare(
        "INSERT INTO cross_domain_link_decision_log (link_id, revision, at, actor, action, before_status, before_public, before_origin, before_reviewed_at, after_status, after_public, after_origin, rule_id, reason) " +
          "SELECT link_id, decision_revision, ?, 'auto_rule', ?, ?, ?, ?, ?, verification_status, public_status, decision_origin, ?, ? FROM cross_domain_link WHERE link_id = ? AND decision_revision = ? AND evidence_json = ?",
      ).bind(nowSeconds, change.kind, change.before.status, change.before.public_status, change.before.origin, change.before.reviewed_at, ruleRef, change.reason, change.link_id, revision, next),
    ]);
    if (!changed(results[0])) { conflicts.push(change.link_id); continue; }
    if (change.kind === "verify") verified += 1; else if (change.kind === "reject") rejected += 1; else reverted += 1;
  }
  const { changes: _ignored, ...counts } = plan;
  void _ignored;
  return { ...counts, verified, rejected, reverted, conflicts };
}
/**
 * 자동 규칙이 바꾼 연결을 이력으로 되돌린다(데이터 복구, T12). 이력의 판정 번호가 지금도 그대로인 연결만 이전 상태·공개·출처·검토 시각으로 돌리고,
 * 그 뒤 관리자가 판정했거나 다른 자동 판정이 있으면 충돌로 센다. sinceLogId 이후 이력만 대상으로 한다.
 */
export async function rollbackLinkRuleDecisions(db: SqlDatabase, sinceLogId: number): Promise<{ readonly restored: number; readonly conflicts: readonly string[] }> {
  const logs = (await db.prepare("SELECT log_id, link_id, revision, before_status, before_public, before_origin, before_reviewed_at FROM cross_domain_link_decision_log WHERE actor = 'auto_rule' AND log_id > ? ORDER BY log_id DESC")
    .bind(sinceLogId).all<{ log_id: number; link_id: string; revision: number; before_status: string; before_public: string; before_origin: string; before_reviewed_at: number | null }>()).results;
  let restored = 0;
  const conflicts: string[] = [];
  for (const log of logs) {
    const result = await db.prepare(
      "UPDATE cross_domain_link SET verification_status = ?, public_status = ?, decision_origin = ?, reviewed_at = ?, decision_rule = CASE WHEN ? = 'auto_rule' THEN decision_rule ELSE '' END, decision_revision = decision_revision + 1 " +
        "WHERE link_id = ? AND decision_revision = ?",
    ).bind(log.before_status, log.before_public, log.before_origin, log.before_reviewed_at, log.before_origin, log.link_id, log.revision).run();
    const changes = (result as { meta?: { changes?: number }; changes?: number })?.meta?.changes ?? (result as { changes?: number })?.changes ?? 0;
    if (changes === 1) restored += 1;
    else conflicts.push(log.link_id);
  }
  return { restored, conflicts };
}
