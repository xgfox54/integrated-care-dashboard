// 대상자 묶음(작업지시서 2026-10-09 D-04). 관계성 지도 집계·클릭 목록·검색 API·CSV·MCP가 같은 정의를 쓴다.
// 공개 원문 문구에 낱말이 들어 있는지만 본다(개인 자격 판정이 아님). 묶음 안 낱말은 OR, 다른 조건(지역·분류·중분류·검색어)과는 AND.
// 영역별 대상 필드: 시행사업은 지원대상·세부대상·사업명, 보도자료는 제목, 복지제도100은 제도명, 예산은 세부사업명. 각 영역의 집계와 목록은 같은 필드를 쓴다.

export interface TargetGroup {
  readonly label: string;
  readonly keywords: readonly string[];
}

/** 대상자 묶음. MCP ID는 target:<slug>, 웹 주소는 target_group=<slug>. 바꾸면 정의 판본도 바꾼다. */
export const TARGET_GROUPS: Readonly<Record<string, TargetGroup>> = {
  "target:elderly": { label: "노인", keywords: ["노인", "어르신", "65세"] },
  "target:dementia": { label: "치매", keywords: ["치매"] },
  "target:disabled": { label: "장애인", keywords: ["장애"] },
  "target:child": { label: "아동", keywords: ["아동", "영유아", "어린이"] },
  "target:youth": { label: "청소년·청년", keywords: ["청소년", "청년"] },
  "target:low_income": { label: "저소득", keywords: ["기초생활", "수급자", "차상위", "저소득", "중위소득"] },
  "target:single_household": { label: "1인 가구·독거", keywords: ["독거", "1인 가구", "1인가구", "홀로"] },
  "target:caregiver": { label: "가족돌봄자·보호자", keywords: ["보호자", "가족돌봄", "돌봄가족"] },
  "target:discharged_patient": { label: "퇴원환자", keywords: ["퇴원"] },
};

/** 정의 판본. 묶음·낱말·대상 필드를 바꾸면 올려 캐시를 새로 만든다. */
export const TARGET_GROUP_DEFINITION_VERSION = "target-groups-2026-10-09";

export function targetGroupSlug(id: string): string {
  return id.replace(/^target:/, "");
}

/** 주소 값(slug 또는 target:slug)을 확인한다. 알 수 없으면 null(호출 쪽이 요청을 거절한다). */
export function parseTargetGroup(value: string): string | null {
  const slug = targetGroupSlug(value.trim());
  return /^[a-z_]{1,40}$/.test(slug) && ("target:" + slug) in TARGET_GROUPS ? slug : null;
}

export function targetGroupOf(slug: string): TargetGroup | null {
  return TARGET_GROUPS["target:" + slug] ?? null;
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (char) => "\\" + char);
}

/** SQL 조건: 낱말 하나라도 주어진 열 중 하나에 들어 있으면 참. */
export function targetGroupSql(slug: string, columns: readonly string[]): { readonly sql: string; readonly values: readonly string[] } {
  const group = targetGroupOf(slug);
  if (!group) throw new Error("UNKNOWN_TARGET_GROUP");
  const parts: string[] = [];
  const values: string[] = [];
  for (const keyword of group.keywords) {
    for (const column of columns) {
      parts.push(column + " LIKE ? ESCAPE '\\'");
      values.push("%" + escapeLike(keyword) + "%");
    }
  }
  return { sql: "(" + parts.join(" OR ") + ")", values };
}

/** 메모리 판정: SQL 조건과 같은 결과(대소문자 구분 없는 영문 포함 부분 일치). */
export function textsMatchTarget(slug: string, texts: readonly string[]): boolean {
  const group = targetGroupOf(slug);
  if (!group) throw new Error("UNKNOWN_TARGET_GROUP");
  const lowered = texts.map((text) => text.toLowerCase());
  return group.keywords.some((keyword) => lowered.some((text) => text.includes(keyword.toLowerCase())));
}

/** 시행사업 대상 필드(지원대상·세부대상·사업명). */
export const SERVICE_TARGET_COLUMNS = ["target", "detail_target", "name"] as const;

export function serviceMatchesTarget(row: { readonly target: string; readonly detailTarget: string; readonly name: string }, slug: string): boolean {
  return textsMatchTarget(slug, [row.target, row.detailTarget, row.name]);
}
