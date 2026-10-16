// 검색어는 항상 바인딩한다. SQL 식과 JS 순위가 같은 공백·구분기호를 무시한다.
const SEPARATORS = [" ", "\t", "\n", "\r", "\v", "\f", "\u00a0", "\u3000", "·", "ㆍ", "・", "(", ")", "[", "]", "{", "}", "<", ">", "「", "」", "『", "』", ":", "：", ",", "，", "/", "-", "–", "—"];
const SEPARATOR_SET = new Set(SEPARATORS);

export function compactSearchText(value: string): string {
  return [...value.normalize("NFKC")].filter((character) => !SEPARATOR_SET.has(character)).join("").toLowerCase();
}

/** column은 개발자가 정한 열/식만 전달한다. 사용자 문자열을 식으로 전달하지 않는다. */
export function compactSearchSql(column: string): string {
  return "LOWER(" + SEPARATORS.reduce((sql, character) => `REPLACE(${sql}, CHAR(${character.codePointAt(0)}), '')`, `COALESCE(${column}, '')`) + ")";
}
