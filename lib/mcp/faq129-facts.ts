export interface Faq129Facts {
  readonly amounts: readonly string[];
  readonly durations: readonly string[];
  readonly ages: readonly string[];
  readonly percents: readonly string[];
  readonly phones: readonly string[];
  readonly laws: readonly string[];
}

export function faq129Facts(answer: string): Faq129Facts {
  const all = (pattern: RegExp) => [...new Set([...answer.matchAll(pattern)].map((match) => (match[1] ?? match[0]).replace(/\s+/g, " ").trim()))].slice(0, 20);
  return {
    amounts: all(/(?<![\d.])\d[\d,.]*\s*(?:천원|만원|억원|원)/g),
    // 4자리 연도(2025년)는 기간이 아니다.
    durations: all(/(?<![\d.,])(?!(?:19|20)\d{2}\s*년)(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:일|개월|년|주|시간)(?:\s*(?:이내|이상|이하|간|동안|전|후))?/g),
    ages: all(/(?:만\s*)?(?<![\d.])\d{1,3}\s*세(?:\s*(?:이상|이하|미만|초과))?/g),
    percents: all(/(?<![\d.])\d+(?:\.\d+)?\s*%/g),
    phones: all(/(?<!\d)(?:\d{2,4}-\d{3,4}-\d{4}|1\d{3}(?:-\d{4})?)(?!\d)/g).filter((value) => /-/.test(value) || /^1[0-9]{3}$/.test(value) && /☎|전화|콜센터|상담/.test(answer)),
    laws: all(/「([^」]{2,60})」/g),
  };
}
