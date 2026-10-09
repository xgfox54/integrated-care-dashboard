// 복지 분류 사전(버전 관리). 코드와 화면 이름을 분리하고, 한 제목에 여러 분야를 붙일 수 있다.
// 키워드는 공백을 뺀 제목과 비교한다.

export const DICTIONARY_VERSION = "press-dict-2026-10-06-r3";

export interface PressCategory {
  readonly code: string;
  readonly label: string;
  readonly keywords: readonly string[];
}

export const PRESS_CATEGORIES: readonly PressCategory[] = [
  { code: "integrated_care", label: "통합돌봄", keywords: ["통합돌봄", "돌봄통합", "커뮤니티케어", "퇴원환자", "재택의료", "방문의료", "재가의료"] },
  { code: "senior", label: "노인", keywords: ["노인", "어르신", "고령", "노년", "노후", "치매", "장기요양"] },
  { code: "disability", label: "장애인", keywords: ["장애인", "장애", "활동지원"] },
  { code: "basic_living", label: "기초생활보장", keywords: ["기초생활", "생계급여", "의료급여", "주거급여", "교육급여", "기초연금", "자활", "긴급복지", "차상위", "수급자", "수급권", "생활보장", "내일저축", "희망저축", "자산형성"] },
  { code: "blind_spot", label: "복지사각지대", keywords: ["복지사각", "사각지대", "위기가구", "위기가정", "고위험가구"] },
  { code: "child_care", label: "아동·보육", keywords: ["아동", "보육", "어린이집", "영유아", "육아", "양육", "입양", "아이돌봄", "보호종료", "출산", "산모", "신생아", "임신"] },
  { code: "youth", label: "청소년", keywords: ["청소년", "학교밖청소년", "자립준비"] },
  { code: "young_adult", label: "청년", keywords: ["청년", "위기청년", "고립청년", "은둔청년", "가족돌봄청년", "자립준비청년", "청년월세", "청년가구", "청년주거"] },
  { code: "women", label: "여성", keywords: ["여성", "경력단절", "새로일하기", "성평등", "양성평등", "성폭력", "가정폭력", "성매매", "디지털성범죄", "스토킹", "임산부"] },
  { code: "family_multicultural", label: "가족·다문화", keywords: ["다문화", "한부모", "가족지원", "건강가정", "가족센터", "조손", "다자녀"] },
  { code: "social_service", label: "사회서비스", keywords: ["사회서비스", "돌봄서비스", "바우처", "복지서비스", "지역사회보장", "사회보장", "간병"] },
  { code: "health_care", label: "보건의료", keywords: ["의료", "건강보험", "건강검진", "건강증진", "요양병원", "가짜진료", "비정상진료", "부당청구"] },
  { code: "mental_health", label: "정신건강·자살예방", keywords: ["정신건강", "자살", "마음건강", "우울", "중독", "심리지원", "생명존중"] },
  { code: "housing", label: "주거복지", keywords: ["주거복지", "주거지원", "임대주택", "주거환경", "집수리", "주거취약", "주거비", "임대차", "신혼부부", "공공임대", "전세피해", "전세사기"] },
  { code: "lonely_death", label: "고독사", keywords: ["고독사", "외로움", "고립", "은둔", "1인가구", "무연고"] },
  { code: "welfare_facility", label: "사회복지시설", keywords: ["복지관", "요양시설", "사회복지시설", "노인요양", "보호시설", "재가복지", "경로당"] },
  { code: "other_welfare", label: "기타복지", keywords: ["복지", "돌봄", "수급", "급여", "취약계층", "저소득", "지원금", "자원봉사", "사회복지사", "요양보호사", "의사상자", "의사자", "의상자"] },
];

/** 기관 이름에 들어 있는 '복지'가 분류를 일으키지 않게 먼저 지우는 말. */
export const AGENCY_WORDS: readonly string[] = ["보건복지부", "복지부", "보건복지"];

/** 복지 키워드는 없지만 사람이 볼 만한 제목에 흔한 말. 이 말만 있으면 확정하지 않고 검토로 보류한다. */
/** 대상 집단만 가리키는 말. 이 말 하나로만 분야가 잡히면 확정하지 않고 검토로 보류한다(2026-10-04 판정표에서 오탐 2건). */
export const POPULATION_ONLY_WORDS: readonly string[] = ["청소년", "청년", "여성"];

/**
 * 2단계 제목 단서(2026-10-06): 1단계 분야 키워드가 없거나 대상 집단 말만 있을 때 쓴다.
 * 복지 단서만 있으면 복지(단서의 분야), 비복지 단서만 있으면 비복지, 둘 다 있거나 둘 다 없으면 검토로 남긴다(학습 판정이 이어서 본다).
 * 운영 검토 결과(2026-10-06 기준 확정 57건)에서 사람이 복지·비복지로 가른 제목의 공통 단서를 모았다.
 */
export const WELFARE_HINTS: readonly (readonly [string, string])[] = [
  ["나눔", "other_welfare"], ["이웃사랑", "other_welfare"], ["이웃돕기", "other_welfare"], ["성품", "other_welfare"], ["기탁", "other_welfare"], ["기부금", "other_welfare"], ["기부자", "other_welfare"], ["전액기부", "other_welfare"], ["봉사", "other_welfare"], ["무료급식", "other_welfare"], ["밑반찬", "other_welfare"],
  ["드림스타트", "child_care"], ["보건소", "health_care"], ["건강생활지원센터", "health_care"], ["구강보건", "health_care"], ["암환자", "health_care"], ["환자", "health_care"],
  ["예방접종", "health_care"], ["건강관리", "health_care"], ["노쇠", "senior"], ["청소년센터", "youth"], ["청소년수련관", "youth"], ["청소년문화의집", "youth"], ["청소년재단", "youth"],
  ["청소년상담", "youth"], ["심리", "mental_health"], ["정서지원", "mental_health"], ["영양꾸러미", "health_care"], ["영양지원", "health_care"], ["경로", "senior"], ["국가유공자", "other_welfare"], ["보훈대상자", "other_welfare"],
];

export const NON_WELFARE_HINTS: readonly string[] = [
  "예산편성", "예산정책", "국가예산", "주민참여예산", "추경", "예산안", "공모전", "축제", "박람회", "관광", "기업", "산업", "창업", "스타트업", "상권", "소상공인", "판로",
  "정비사업", "재개발", "재건축", "용적률", "모아타운", "철도", "교통", "도로", "보행", "주차", "착공", "준공", "공사", "재해예방", "재해위험", "급경사지", "산불", "영농", "농기계",
  "농지", "농가", "농업재해", "정책보험", "수확", "수질", "정수장", "폐기물", "탄소중립", "태양광", "친환경차", "지적", "측량", "토지", "공무원", "도서관", "체육", "축구", "공연", "전시", "디자인", "캐릭터",
  "천연기념물", "위생업소", "식품안심", "안전점검", "위험성평가", "cctv", "개인정보", "고향사랑", "시민대상", "정책협의", "투자", "수출", "특구", "공장", "착한가격", "지역화폐",
];

export const WEAK_WORDS: readonly string[] = ["지원", "제도", "시행", "확대", "개선", "사업", "공모", "예산"];

/**
 * 운영자가 수집 대상에서 뺀 낱말(2026-10-09). 제목에 있으면 어르신·나눔 같은 복지 단서가 함께 있어도 비복지로 둔다.
 * 영농부산물: 쓰레기 불법소각 방지 안내 보도자료.
 */
export const EXCLUDED_TITLE_WORDS: readonly string[] = ["영농부산물"];

/** 발행기관 유형(당시 기준). */
export const ORG_TYPE_LABELS: Readonly<Record<string, string>> = {
  CENTRAL: "중앙부처", METROPOLITAN: "광역자치단체", BASIC_CITY: "시", BASIC_COUNTY: "군", AUTONOMOUS_DISTRICT: "자치구", ADMINISTRATIVE_CITY: "행정시", GENERAL_DISTRICT: "일반구",
};

export const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PRESS_CATEGORIES.map((category) => [category.code, category.label]),
);
