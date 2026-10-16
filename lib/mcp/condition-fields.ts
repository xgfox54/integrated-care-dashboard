export type ConditionField = 'eligibility' | 'income_assets' | 'documents' | 'period' | 'overlap_restrictions' | 'exceptions';
export type ConditionParagraph = { readonly source_block: number; readonly source_quote: string };
const PATTERNS: Readonly<Record<ConditionField, RegExp>> = {
  eligibility: /대상|자격|수급|연령|거주|국적|가구|선정|검사|진단/,
  income_assets: /소득|재산|중위|부채|공제|금융|인정액/,
  documents: /서류|신분증|신청서|동의서|통장|위임장|증명|확인서|아포스티유|영사확인/,
  period: /기간|기한|일 이내|개월|년 이상|일부터|일까지|신청일|생일|매월/,
  overlap_restrictions: /중복|동시|우선|제외|불가|할 수 없|받을 수 없|제한|차감/,
  exceptions: /다만|단,|예외|제외|경우에 한|필요시|필요 시|그 밖/,
};
const FIELDS: readonly ConditionField[] = ['eligibility', 'income_assets', 'documents', 'period', 'overlap_restrictions', 'exceptions'];

/** Paragraph routing only: do not infer mandatory/optional logic from a keyword. */
export function conditionFields(text: string) {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n+/).filter(block => block.trim());
  const fields: Record<ConditionField, ConditionParagraph[]> = {
    eligibility: [], income_assets: [], documents: [], period: [], overlap_restrictions: [], exceptions: [],
  };
  for (const [index, block] of paragraphs.entries()) for (const field of FIELDS) {
    if (PATTERNS[field].test(block)) fields[field].push({ source_block: index + 1, source_quote: block });
  }
  return { extraction_status: 'PARAGRAPH_ROUTING_ONLY' as const, policy_verification: 'NOT_INDEPENDENTLY_VERIFIED' as const,
    fields, unclassified_paragraphs: paragraphs.map((source_quote, index) => ({ source_block: index + 1, source_quote }))
      .filter(row => !Object.values(fields).some(values => values.some(value => value.source_block === row.source_block))),
    instructions: '분야별 문단과 미분류 문단을 모두 읽으세요. 빈 배열은 원문에서 해당 분류를 찾지 못했다는 뜻이며 조건이 없다는 뜻이 아닙니다. 같은 문단의 단서·괄호·각주·예외를 함께 반영하세요.' };
}
