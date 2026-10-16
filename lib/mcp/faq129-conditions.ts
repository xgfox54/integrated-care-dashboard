import { conditionFields } from './condition-fields.ts';
export type Faq129ConditionRule = {
  readonly id: string;
  readonly operator: "AND" | "OR" | "EXCEPTION" | "REQUIRED" | "OPTIONAL_IF_NEEDED" | "DEFINITION";
  readonly source_block: number;
  readonly source_quote: string;
  readonly operands: readonly string[];
  readonly applies_to: string | null;
};
export type Faq129Conditions = {
  readonly condition_fields: ReturnType<typeof conditionFields>;
  readonly verification_status: "SOURCE_REVIEWED" | "UNREVIEWED";
  readonly scope: "selected_source_conditions_only";
  readonly policy_verification: "NOT_INDEPENDENTLY_VERIFIED";
  readonly source_content_sha256: string;
  readonly rules: readonly Faq129ConditionRule[];
  readonly scope_constraints: readonly Faq129ScopeConstraint[];
  readonly warning_markers: readonly Faq129ConditionWarning[];
};
export type Faq129ScopeConstraint = {
  readonly id: string;
  readonly rule_id: string;
  readonly target_rule_id: string;
  readonly target_operand: string | null;
  readonly scope: "TARGET_RULE" | "TARGET_OPERAND" | "COMMON_TO_ALL_ALTERNATIVES";
  readonly common_operands: readonly string[];
  readonly source_block: number;
  readonly source_quote: string;
  readonly source_content_sha256: string;
  readonly reviewed_scope_note: string;
};
export type Faq129ConditionWarning = {
  readonly code: "CONDITION_LOGIC_UNREVIEWED" | "CONDITION_REVIEW_STALE";
  readonly source_content_sha256: string;
  readonly verification_status: "UNREVIEWED";
  readonly source_block: number | null;
  readonly source_quote: string | null;
};
type RuleSpec = {
  readonly id: string;
  readonly operator: Faq129ConditionRule["operator"];
  readonly anchor: string;
  readonly operands: readonly string[];
  readonly applies_to?: string;
  readonly target_operand?: string;
};
type Review = { readonly hash: string; readonly rules: readonly RuleSpec[] };
// These relationships were reviewed against the cited source paragraphs, not current policy.
const residence = (hardship: string): readonly RuleSpec[] => [
  { id: "household-inclusion", operator: "AND", anchor: hardship, operands: ["국내에 30일 이상 거주할 목적으로", "주민등록", hardship, "시군구청장이 인정하는 경우", "가구원으로서 포함"] },
  { id: "registration", operator: "OR", anchor: hardship, operands: ["주민등록을 재등록", "주민등록이 말소되지 않은"], applies_to: "household-inclusion", target_operand: "주민등록" },
];
const REVIEWS: Readonly<Record<string, Review>> = {
  "7170": { hash: "3a409776315ac9e78ecfa25ba7807b267b8b39fa06565c3f5ba10d9158371789", rules: [
    { id: "normal-tests", operator: "AND", anchor: "정액검사•배란기능•자궁강 및 난관검사", operands: ["정액검사", "배란기능", "자궁강 및 난관검사", "모두 정상"] },
    { id: "ivf-period", operator: "REQUIRED", anchor: "3년 이상 임신", operands: ["3년 이상 임신이 되지 않은 경우"], applies_to: "normal-tests" },
    { id: "ivf-age-exception", operator: "EXCEPTION", anchor: "3년 이상 임신", operands: ["부인연령이 35세 이상", "1년 이상 임신"], applies_to: "ivf-period" },
    { id: "iui-period", operator: "REQUIRED", anchor: "1년 이상 자연임신", operands: ["1년 이상 자연임신이 되지 않은 경우"], applies_to: "normal-tests" },
    { id: "iui-age-exception", operator: "EXCEPTION", anchor: "1년 이상 자연임신", operands: ["부인연령이 35세 이상", "6개월 이상 자연임신"], applies_to: "iui-period" },
  ] },
  "14238": { hash: "160109c79971d04f820c77ba7c42f76f81e8da7d378b48c8936e86d246dcdcfd", rules: [
    { id: "foreign-document-path", operator: "OR", anchor: "당사자가 외국인인 경우 대사관", operands: ["대사관에서 발급한", "자국행정기관에서 발급받은"] },
    { id: "domestic-authority-certification", operator: "REQUIRED", anchor: "당사자가 외국인인 경우 대사관", operands: ["자국행정기관에서 발급받은", "아포스티유 또는 영사확인을 거친 후"], applies_to: "foreign-document-path", target_operand: "자국행정기관에서 발급받은" },
    { id: "certification-options", operator: "OR", anchor: "당사자가 외국인인 경우 대사관", operands: ["아포스티유", "영사확인"], applies_to: "domestic-authority-certification" },
    { id: "notarization-translation", operator: "OPTIONAL_IF_NEEDED", anchor: "당사자가 외국인인 경우 대사관", operands: ["필요시 공증 및 번역"], applies_to: "domestic-authority-certification" },
  ] },
  "13140": { hash: "8759dd0f1f54a9c1d21825e4d014adb920d044c35afad2a42fd7dd6182383ee2", rules: [
    { id: "hospital-definition", operator: "DEFINITION", anchor: "대학병원급 병원이란", operands: ["대학병원급 병원"] },
    { id: "hospital-capabilities", operator: "AND", anchor: "대학병원급 병원이란", operands: ["영아에게 진정제 투여 후 ABR을 안전하게 시행", "연령에 맞는 언어발달 검사", "언어치료"], applies_to: "hospital-definition" },
  ] },
  "10734": { hash: "861dc100d6aa6070483a169849c05b7fc880d014ce5f490818e7f5c2b9091c8c", rules: residence("실제 생계가 곤란하여 필요하다고") },
  "14013": { hash: "a9aa7aaf0a4d4868cbf83fc31fb0779705bd3949b16fd8dfa1b0b8c0185c0d74", rules: residence("실제 생계곤란하여 보호가 필요하다고") },
  "6334": { hash: "f7d89f2276c4a90f20b99ba7efd55939e5b769eb435fa2a7d280825463ccb74e", rules: [
    { id: "selection-discouraged", operator: "OR", anchor: "단독으로 일상생활", operands: ["단독으로 일상생활이 가능", "실제 생활을 함께 하는 부양가족이 있는 경우"] },
    { id: "selection-exception", operator: "EXCEPTION", anchor: "단독으로 일상생활", operands: ["만65세 미만의 의료급여수급자 중 장기입원 사례관리 퇴원자 제외"], applies_to: "selection-discouraged" },
    { id: "activity-priority", operator: "REQUIRED", anchor: "활동지원서비스를 우선 활용", operands: ["장애인활동지원 등급판정을 받은 자", "활동지원서비스를 우선 활용"] },
    { id: "activity-exception", operator: "EXCEPTION", anchor: "활동지원서비스를 우선 활용", operands: ["만 65세 미만의 의료급여 수급자 중 장기입원 사례관리 퇴원자 제외"], applies_to: "activity-priority" },
  ] },
  "9710": { hash: "626505b28a2fd4f6b49c35cdb26165f9ed9ecef8fb485f93ecde582569bd210c", rules: [
    { id: "separate-transport", operator: "AND", anchor: "원래 소속으로 복귀하여", operands: ["원래 소속으로 복귀하여", "새로운 요청과정을 거쳐", "동일한 응급환자가", "이전 이송이 종료된 장소에서 다시 탑승하였을 경우"] },
    { id: "separate-basic-fee", operator: "REQUIRED", anchor: "원래 소속으로 복귀하여", operands: ["별도 행위로 간주하여 기본 요금 산정이 가능합니다"], applies_to: "separate-transport" },
  ] },
  "861": { hash: "1097cec3b38ff36421233bfa1c5a2809ec81bfcccec63866e5c8fad7205ba621", rules: [
    { id: "repeat-support", operator: "REQUIRED", anchor: "지원이 종료된 때로부터", operands: ["지원이 종료된 때로부터 2년이 경과한 후", "동일한 사유로 다시 지원"] },
    { id: "livelihood-only", operator: "REQUIRED", anchor: "생계지원에 한해", operands: ["생계지원에 한해", "동일 위기상황이라도 2년 경과 시"], applies_to: "repeat-support" },
  ] },
};
export function faq129Conditions(id: string, hash: string, answer: string): Faq129Conditions {
  const base = { scope: "selected_source_conditions_only", policy_verification: "NOT_INDEPENDENTLY_VERIFIED", source_content_sha256: hash } as const;
  const review = REVIEWS[id];
  const blocks = answer.split(/\r?\n[\t ]*\r?\n+/).filter((text) => text.trim());
  const rules: Faq129ConditionRule[] = [];
  if (review?.hash === hash) for (const spec of review.rules) {
    const index = blocks.findIndex((block) => block.includes(spec.anchor) && spec.operands.every((part) => block.includes(part)));
    const quote = blocks[index];
    if (quote === undefined) break;
    rules.push({ id: spec.id, operator: spec.operator, source_block: index + 1, source_quote: quote, operands: spec.operands, applies_to: spec.applies_to ?? null });
  }
  const constraints: Faq129ScopeConstraint[] = [];
  if (review?.hash === hash && rules.length === review.rules.length) for (const spec of review.rules) {
    if (!spec.applies_to) continue;
    const rule = rules.find(candidate => candidate.id === spec.id);
    const target = rules.find(candidate => candidate.id === spec.applies_to);
    if (!rule || !target || (spec.target_operand && !target.operands.includes(spec.target_operand))) break;
    constraints.push({ id: rule.id + ':scope', rule_id: rule.id, target_rule_id: target.id,
      target_operand: spec.target_operand ?? null, scope: spec.target_operand ? "TARGET_OPERAND" : "TARGET_RULE", common_operands: [],
      source_block: rule.source_block, source_quote: rule.source_quote, source_content_sha256: hash,
      reviewed_scope_note: spec.target_operand ? "지정한 원문 선택지에만 적용됩니다." : "지정한 조건 전체에 적용됩니다." });
    if (rule.id === 'registration' && target.id === 'household-inclusion') {
      constraints.push({ id: target.id + ':common', rule_id: target.id, target_rule_id: rule.id,
        target_operand: null, scope: "COMMON_TO_ALL_ALTERNATIVES", common_operands: target.operands.filter(operand => operand !== spec.target_operand),
        source_block: target.source_block, source_quote: target.source_quote, source_content_sha256: hash,
        reviewed_scope_note: "주민등록의 두 선택지 모두에 나머지 공통 조건이 적용됩니다." });
    }
  }
  const expectedConstraints = review?.rules.filter(rule => rule.applies_to).length ?? 0;
  const reviewed = review?.hash === hash && rules.length === review.rules.length && constraints.filter(scope => scope.scope !== 'COMMON_TO_ALL_ALTERNATIVES').length === expectedConstraints;
  const warning_markers: readonly Faq129ConditionWarning[] = reviewed ? [] : [{ code: review ? "CONDITION_REVIEW_STALE" : "CONDITION_LOGIC_UNREVIEWED",
    source_content_sha256: hash, verification_status: "UNREVIEWED", source_block: null, source_quote: null }];
  return { ...base, condition_fields: conditionFields(answer), verification_status: reviewed ? "SOURCE_REVIEWED" : "UNREVIEWED", rules: reviewed ? rules : [], scope_constraints: reviewed ? constraints : [], warning_markers };
}
