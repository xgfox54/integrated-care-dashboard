import { AGENCY_WORDS, DICTIONARY_VERSION, NON_WELFARE_HINTS, POPULATION_ONLY_WORDS, PRESS_CATEGORIES, WEAK_WORDS, WELFARE_HINTS } from "./dictionary.ts";

// 제목 규칙 분류. 본문을 읽지 않으므로 근거는 항상 title_rule이다.
// 1단계: 분야 키워드(대상 집단 말만 있으면 보류). 2단계: 복지·비복지 제목 단서(dictionary.ts WELFARE_HINTS·NON_WELFARE_HINTS).
// 두 단계로도 정하지 못한 제목은 NEEDS_REVIEW로 남고, 배경 작업의 학습 판정(auto-classify.ts)이 이어서 보거나 사람이 확정한다.

export type ClassificationStatus = "WELFARE" | "NEEDS_REVIEW" | "NON_WELFARE";

export interface PressClassification {
  readonly status: ClassificationStatus;
  readonly categories: readonly string[];
  readonly basis: "title_rule";
  readonly dictionaryVersion: string;
}

const MAX_CATEGORIES = 5;

export function compactTitle(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function classifyTitle(title: string): PressClassification {
  const stripped = AGENCY_WORDS.reduce((text, word) => text.split(word).join(""), compactTitle(title));
  // 실제 오탐 표본의 시설명만 낱말 경계에서 제외한다. 노후생활·다른 위치의 노후·노인 단서는 보존한다.
  const seniorText = compactTitle(title.replace(/(^|[^\p{L}\p{N}_])노후\s*(?:산업\s*단지|주거지)(?=$|[^\p{L}\p{N}_]|(?:의|에|를|가|는|도|와|로)(?:$|[^\p{L}\p{N}_]))/gu, "$1"));
  const has = (word: string) => (word === "노후" ? seniorText : stripped).includes(compactTitle(word));
  const ruleCategories = PRESS_CATEGORIES.filter((category) => category.keywords.some(has)).map((category) => category.code);
  const matched = PRESS_CATEGORIES.flatMap((category) => category.keywords).filter(has);
  const populationOnly = matched.length > 0 && matched.every((keyword) => POPULATION_ONLY_WORDS.includes(keyword));
  const result = (status: ClassificationStatus, categories: readonly string[]): PressClassification => ({
    status,
    categories: status === "NON_WELFARE" ? [] : [...new Set(categories)].slice(0, MAX_CATEGORIES),
    basis: "title_rule",
    dictionaryVersion: DICTIONARY_VERSION,
  });
  if (ruleCategories.length > 0 && !populationOnly) return result("WELFARE", ruleCategories);

  const welfareHints = WELFARE_HINTS.filter(([word]) => has(word));
  const nonWelfare = NON_WELFARE_HINTS.some(has);
  if (welfareHints.length > 0 && !nonWelfare) return result("WELFARE", [...ruleCategories, ...welfareHints.map(([, code]) => code)]);
  if (nonWelfare && welfareHints.length === 0) return result("NON_WELFARE", []);
  if (populationOnly || welfareHints.length > 0 || WEAK_WORDS.some(has)) return result("NEEDS_REVIEW", [...ruleCategories, ...welfareHints.map(([, code]) => code)]);
  return result("NON_WELFARE", []);
}
