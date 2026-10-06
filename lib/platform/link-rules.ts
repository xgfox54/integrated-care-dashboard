// 사업–재정사업 연결 자동 판정(2026-10-05 운영자 지시). 제주 연결 후보를 웹 검색·사업안내로 하나씩 확인한 결과를 규칙 표로 옮겼다.
// 규칙은 위에서부터 차례로 보고 처음 맞는 규칙 하나만 쓴다(제외 규칙을 같은 이름의 확인 규칙보다 먼저 둔다).
// 표에 없는 짝은 바꾸지 않고 후보로 남긴다. 판정 근거는 evidence_json.auto_review에 남긴다.
import type { SqlDatabase } from "../sql-database.ts";

export const LINK_RULE_VERSION = "jeju-link-rules-2026-10-05";

export type LinkDecision = "verify" | "reject";

interface LinkRule {
  readonly fiscal: RegExp;
  readonly program: RegExp;
  readonly decision: LinkDecision;
  readonly reason: string;
}

/** 대조용 이름: 글자·숫자만 남긴다(띄어쓰기·괄호·가운뎃점 제거). */
export function linkNameKey(name: string): string {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

const LINK_RULES: readonly LinkRule[] = [
  { fiscal: /금연/, program: /재활/, decision: "reject", reason: "금연지원과 지역사회중심 재활사업은 다른 사업" },
  { fiscal: /지역사회서비스투자/, program: /재활/, decision: "reject", reason: "지역사회서비스투자사업(바우처)은 지역사회중심 재활사업과 다름" },
  { fiscal: /장기요양서비스개선/, program: /재가급여|통합재가/, decision: "reject", reason: "포괄 사업명이라 특정 재가급여 사업과 같다고 볼 근거 없음" },
  { fiscal: /활동지원/, program: /상해보험/, decision: "reject", reason: "활동지원과 상해보험 가입은 다른 사업" },
  { fiscal: /장애인(단체|회관|교육|취업|고용|연금|복지서비스|쉼터)/, program: /활동지원/, decision: "reject", reason: "단체·회관·교육·취업·연금·쉼터 사업은 장애인 활동지원 서비스와 다름" },
  { fiscal: /발달장애인주간활동/, program: /활동지원/, decision: "reject", reason: "발달장애인 주간활동서비스는 장애인 활동지원과 별개 바우처" },
  { fiscal: /^(중증)?장애인활동지원/, program: /^장애인활동지원서비스$/, decision: "verify", reason: "장애인 활동지원(가산급여·추가지원 포함) 재정사업" },
  { fiscal: /발달장애인긴급돌봄/, program: /긴급돌봄지원/, decision: "reject", reason: "발달장애인 긴급돌봄은 긴급돌봄지원사업(일반)과 다른 사업" },
  { fiscal: /^긴급돌봄지원사업$/, program: /^긴급돌봄지원사업$/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /치매안심센터/, program: /^치매안심센터$/, decision: "verify", reason: "보건소별 치매안심센터 운영 재정사업" },
  { fiscal: /치매공공후견/, program: /^치매공공후견지원$/, decision: "verify", reason: "치매공공후견(지원·광역지원단) 재정사업" },
  { fiscal: /노인맞춤돌봄/, program: /^노인맞춤돌봄서비스$/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /응급안전/, program: /응급안전안심/, decision: "verify", reason: "독거노인·(중증)장애인 응급안전안심서비스 재정사업" },
  { fiscal: /제주형건강주치의/, program: /장애인건강주치의/, decision: "reject", reason: "제주형 건강주치의와 장애인 건강주치의는 다른 사업" },
  { fiscal: /제주형건강주치의/, program: /^제주형건강주치의/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /여성장애인교육/, program: /가사도우미/, decision: "reject", reason: "여성장애인 교육사업과 가사도우미 지원은 다른 사업" },
  { fiscal: /장애인가정도우미/, program: /여성장애인가사도우미/, decision: "reject", reason: "장애인가정 도우미와 여성장애인 가사도우미는 대상이 다른 사업" },
  { fiscal: /여성장애인(가사도우미|돌봄지원)/, program: /여성장애인가사도우미/, decision: "verify", reason: "여성장애인 가사·자녀돌봄 도우미 지원 재정사업(2026 제주 사업 공고 확인)" },
  { fiscal: /보조기기대여센터/, program: /보조기기교부/, decision: "reject", reason: "대여센터 운영과 보조기기 교부는 다른 사업" },
  { fiscal: /장애인보조기기(교부|지원)/, program: /보조기기교부/, decision: "verify", reason: "장애인 보조기기 교부(지원) 재정사업" },
  { fiscal: /어르신행복택시/, program: /어르신행복택시/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /장애인주택개조/, program: /장애인주택개조/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /방문건강관리/, program: /AIIoT/, decision: "reject", reason: "AI·IoT 건강관리는 방문건강관리사업과 별도 사업" },
  { fiscal: /^방문건강관리사업/, program: /방문건강관리사업$/, decision: "verify", reason: "방문건강관리사업 재정사업" },
  { fiscal: /고혈압당뇨병등록관리/, program: /고혈압당뇨병등록관리/, decision: "verify", reason: "사업명 일치" },
  { fiscal: /교통약자이동지원센터/, program: /교통약자지원/, decision: "verify", reason: "교통약자이동지원센터 운영 재정사업" },
  { fiscal: /장애인자립지원시범/, program: /자립지원시범/, decision: "verify", reason: "장애인 지역사회 자립지원 시범사업 재정사업" },
  { fiscal: /의료취약지원격협진/, program: /의료취약지원격협진/, decision: "verify", reason: "ICT 활용 의료취약지 원격협진 재정사업" },
  { fiscal: /찾아가는건강돌봄/, program: /^찾아가는건강돌봄서비스/, decision: "verify", reason: "찾아가는 건강돌봄 서비스(어르신 안심주택 포함, 2026 서귀포시 보도 확인)" },
  { fiscal: /의료급여/, program: /재가의료급여/, decision: "reject", reason: "의료급여(사업추진)는 재가 의료급여 시범사업과 같다고 볼 근거 없음" },
  { fiscal: /보행환경/, program: /안전생활환경/, decision: "reject", reason: "보행환경 조성과 안전생활환경 조성은 다른 사업" },
  { fiscal: /저소득노인생활안정/, program: /노인진료비/, decision: "reject", reason: "생활안정지원과 노인 진료비는 다른 사업" },
  { fiscal: /홀로사는노인지원센터/, program: /에너지드림/, decision: "reject", reason: "지원센터 운영과 냉·난방비 지원은 다른 사업" },
  { fiscal: /노인안전생활지원/, program: /안전생활환경/, decision: "reject", reason: "노인안전생활지원과 안전생활환경 조성사업은 다른 사업" },
  { fiscal: /장애인지역사회재활시설/, program: /./, decision: "reject", reason: "재활시설 운영 지원은 자립지원 시범·통합돌봄 사업과 다름" },
  { fiscal: /삼무형주거환경|제주형주거환경/, program: /건강안심주거환경/, decision: "reject", reason: "제주(삼무)형 주거환경개선과 건강안심 주거환경 개선은 다른 사업" },
  { fiscal: /^지역사회통합돌봄사업$/, program: /제주형장애인/, decision: "reject", reason: "지역사회통합돌봄(일반)과 제주형 장애인 통합돌봄은 다른 사업" },
];

/** 재정사업명·사업명 짝의 판정. 규칙에 없으면 null(후보 유지). */
export function judgeLink(fiscalName: string, programName: string): { readonly decision: LinkDecision; readonly reason: string } | null {
  const fiscal = linkNameKey(fiscalName);
  const program = linkNameKey(programName);
  const rule = LINK_RULES.find((item) => item.fiscal.test(fiscal) && item.program.test(program));
  return rule ? { decision: rule.decision, reason: rule.reason } : null;
}

interface LinkRecord { readonly link_id: string; readonly evidence_json: string; readonly verification_status: string }

/** 모든 연결(후보·확인·제외)을 규칙으로 다시 판정한다. 판정이 지금 상태와 다를 때만 바꾼다. */
export async function applyLinkRules(db: SqlDatabase, nowSeconds: number): Promise<{ readonly examined: number; readonly verified: number; readonly rejected: number; readonly unchanged: number; readonly unmatched: number }> {
  const rows = (await db.prepare("SELECT link_id, evidence_json, verification_status FROM cross_domain_link WHERE relation = 'fiscalProjectFor'").all<LinkRecord>()).results;
  const statements = [];
  let verified = 0;
  let rejected = 0;
  let unchanged = 0;
  let unmatched = 0;
  for (const row of rows) {
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(row.evidence_json) as Record<string, unknown>;
    } catch {
      unmatched += 1;
      continue;
    }
    const judged = judgeLink(String(evidence.fiscal_project_name ?? ""), String(evidence.program_name ?? ""));
    if (!judged) {
      unmatched += 1;
      continue;
    }
    const status = judged.decision === "verify" ? "VERIFIED" : "REJECTED";
    if (row.verification_status === status) {
      unchanged += 1;
      continue;
    }
    if (judged.decision === "verify") verified += 1;
    else rejected += 1;
    const next = JSON.stringify({ ...evidence, auto_review: { rule_version: LINK_RULE_VERSION, decision: judged.decision, reason: judged.reason, previous_status: row.verification_status, at: nowSeconds } });
    statements.push(
      db.prepare("UPDATE cross_domain_link SET verification_status = ?, public_status = ?, reviewed_at = ?, evidence_json = ? WHERE link_id = ?")
        .bind(status, status === "VERIFIED" ? "PUBLIC" : "HIDDEN", nowSeconds, next, row.link_id),
    );
  }
  for (let start = 0; start < statements.length; start += 50) await db.batch(statements.slice(start, start + 50));
  return { examined: rows.length, verified, rejected, unchanged, unmatched };
}
