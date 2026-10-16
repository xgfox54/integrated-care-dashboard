// 표현이 다른 질문을 위해 질문(가중 2)·답변 원문의 두 글자 조각으로 BM25 점수를 매긴다.
// 사전·정답·평가 문항을 쓰지 않으며, 결과는 확인이 필요한 관련 후보(RELATED)로만 쓴다.
import { compactSearchText } from "./search-text.ts";

export const FAQ129_BM25_MIN = 25;
const K1 = 1.2;
const B = 0.75;
const ENDING = /(?:인가요|되나요|하나요|있나요|없나요|할까요|될까요|나요|가요|까요|는지|요)$/;

export interface Bm25Index {
  readonly docs: readonly { readonly grams: ReadonlyMap<string, number>; readonly length: number }[];
  readonly df: ReadonlyMap<string, number>;
  readonly averageLength: number;
}

function grams(text: string): Map<string, number> {
  const compact = compactSearchText(text).replace(/[^\p{L}\p{N}]/gu, "");
  const result = new Map<string, number>();
  for (let index = 0; index + 1 < compact.length; index++) {
    const gram = compact.slice(index, index + 2);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

export function buildBm25Index(rows: readonly { readonly question: string; readonly category: string | null; readonly answer: string }[]): Bm25Index {
  const df = new Map<string, number>();
  const docs = rows.map((row) => {
    const merged = new Map<string, number>();
    for (const [gram, count] of grams(row.question + " " + (row.category ?? ""))) merged.set(gram, count * 2);
    for (const [gram, count] of grams(row.answer)) merged.set(gram, (merged.get(gram) ?? 0) + count);
    let length = 0;
    for (const [gram, count] of merged) { length += count; df.set(gram, (df.get(gram) ?? 0) + 1); }
    return { grams: merged, length };
  });
  return { docs, df, averageLength: docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1) };
}

/** 문서 순서와 같은 점수 배열. */
export function scoreBm25(index: Bm25Index, query: string): number[] {
  const queryGrams = [...grams(query.split(/\s+/).map((word) => word.replace(ENDING, "")).join(" ")).keys()];
  const total = index.docs.length;
  const weights = queryGrams.map((gram) => {
    const frequency = index.df.get(gram) ?? 0;
    return [gram, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))] as const;
  });
  return index.docs.map((doc) => {
    let score = 0;
    for (const [gram, idf] of weights) {
      const tf = doc.grams.get(gram);
      if (tf) score += idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * doc.length / (index.averageLength || 1)));
    }
    return score;
  });
}
