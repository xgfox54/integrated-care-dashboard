import { matchesSearch, parseSearch, relevanceScore, type ParsedSearch } from "../search-terms.ts";

/** Retrieval hints only: these terms never establish eligibility or service identity. */
const RELATED_TERMS: Readonly<Record<string, readonly string[]>> = {
  밥: ["식사", "급식", "도시락"],
  집수리: ["주거환경개선", "수선"],
  병원동행: ["진료동행", "의료동행"],
};

export interface WelfareSearchExpansion {
  readonly input: string;
  readonly related: readonly string[];
}

export function welfareSearchExpansions(query: string): WelfareSearchExpansion[] {
  return parseSearch(query).terms.flatMap((term) => {
    const related = term.plain && !term.negated && !term.region ? RELATED_TERMS[term.key] : undefined;
    return related ? [{ input: term.text, related }] : [];
  });
}

/** Do not expand negative terms, region names, wildcards or explicit OR groups. */
export function parseWelfareSearch(query: string): ParsedSearch {
  const parsed = parseSearch(query);
  return {
    ...parsed,
    terms: parsed.terms.map((term) => {
      const related = term.plain && !term.negated && !term.region ? RELATED_TERMS[term.key] : undefined;
      return related ? { ...term, alternatives: [...new Set([...term.alternatives, ...related])] } : term;
    }),
  };
}

/** Literal matches precede matches found only through related words. */
export function welfareSearchScore(fields: { name: string; category?: string; searchText: string }, query: string, ignoreRegion = false): number {
  const literal = parseSearch(query);
  const literalBonus = literal.terms.length > 0 && matchesSearch(fields.searchText, literal, { ignoreRegion }) ? 1000 : 0;
  return literalBonus + relevanceScore(fields, parseWelfareSearch(query));
}
