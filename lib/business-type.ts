// 사업구분(전국·광역·지역특화·공통_연계·미분류) 관리 기준. 7개 사업 대분류(category)와는 다른 필드다.
// 보건복지부 메뉴판 '구분' 칸의 원문 표기를 승인 규칙으로만 공식 사업구분에 대응시키고, 근거 없는 값은 추정하지 않는다.
import restorations from "../data/business-type-restorations.json" with { type: "json" };

export const OFFICIAL_BUSINESS_TYPES = ["전국", "광역", "지역특화", "공통_연계", "미분류"] as const;
export type OfficialBusinessType = (typeof OFFICIAL_BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_DEFINITIONS: Readonly<Record<OfficialBusinessType, string>> = {
  전국: "중앙정부(보건복지부 등)가 전국 공통으로 시행하는 사업으로 메뉴판 사업구분 칸에 '전국'으로 표기된 사업",
  광역: "광역시·도가 시행하는 사업으로 메뉴판 사업구분 칸에 '광역'(또는 경기도 메뉴판의 '경기도')으로 표기된 사업",
  지역특화: "해당 시·군·구가 자체적으로 시행하는 사업으로 메뉴판 사업구분 칸에 '지역특화'로 표기된 사업",
  공통_연계: "메뉴판의 '공통·연계' 묶음에 실린 사업(여러 기관 연계 또는 공통 제공 사업). 원문 표기를 그대로 보존한다",
  미분류: "원문 사업구분 칸이 비어 있거나 판독할 수 없어 공식 근거로 구분을 정하지 못한 사업",
};

export const BUSINESS_TYPE_MAPPING_RULES = [
  { from: "경기도", to: "광역", basis: "경기도 시·군 메뉴판은 광역 사업을 '경기도'로 표기한다(기존 화면 규칙 lib/dataset.ts·lib/official-query.ts와 같음)." },
] as const;

export function displayBusinessType(value: string): string {
  const rule = BUSINESS_TYPE_MAPPING_RULES.find((entry) => entry.from === value.trim());
  return rule ? rule.to : value.trim() || "미분류";
}

const APPROVED_LABELS: readonly (readonly [RegExp, OfficialBusinessType, string])[] = [
  [/^전국(사업)?$/, "전국", "원문 표기 그대로"],
  [/^지역특화(\(자체\))?$/, "지역특화", "원문 표기 그대로"],
  [/^광역(사업)?$/, "광역", "원문 표기 그대로"],
  [/^경기도$/, "광역", "기존 화면 규칙: 경기도 메뉴판의 '경기도' 표기는 광역"],
  [/^공통[·ㆍ_]?연계$/, "공통_연계", "원문 표기 그대로"],
  [/^미분류$/, "미분류", "원문 표기 그대로"],
];

const PROPOSED_LABELS: readonly (readonly [RegExp, OfficialBusinessType, string])[] = [
  [/^국가(사업)?$/, "전국", "제안: '국가'는 중앙정부 사업 표기로 보임(대구 메뉴판 등). 승인 전 적용하지 않음"],
  [/^(지자체|\(?자체\)?|시군구?|시|군|구)(사업)?$/, "지역특화", "제안: 시·군·구 자체 사업 표기. 승인 전 적용하지 않음"],
  [/^(도|시도|도특화|도비|.+도|.+특별자치도|.+광역시)(사업)?$/, "광역", "제안: 광역 단위 사업 표기. 승인 전 적용하지 않음"],
  [/^연계(서비스|사업)?$/, "공통_연계", "제안: '연계서비스'는 공통·연계 묶음으로 보임. 승인 전 적용하지 않음"],
];

export function classifySourceTypeLabel(label: string): { value: OfficialBusinessType; rule: "approved" | "proposed" | "none"; basis: string } {
  const compact = label.replace(/[\s]/g, "");
  if (!compact) return { value: "미분류", rule: "none", basis: "원문 칸에서 글자를 찾지 못함" };
  for (const [pattern, value, basis] of APPROVED_LABELS) if (pattern.test(compact)) return { value, rule: "approved", basis };
  for (const [pattern, value, basis] of PROPOSED_LABELS) if (pattern.test(compact)) return { value, rule: "proposed", basis };
  return { value: "미분류", rule: "none", basis: "승인·제안 규칙에 없는 원문 표기" };
}

export interface BusinessTypeRestoration {
  readonly type: OfficialBusinessType;
  readonly label: string;
  readonly page: number;
}

const RESTORATIONS: ReadonlyMap<string, BusinessTypeRestoration> = new Map(
  Object.entries((restorations as { rows: Record<string, BusinessTypeRestoration> }).rows),
);

export function verifiedBusinessTypeRestoration(serviceId: string): BusinessTypeRestoration | undefined {
  return RESTORATIONS.get(serviceId);
}

