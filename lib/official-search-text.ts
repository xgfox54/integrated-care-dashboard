import { spacedVariants, type SearchTerm } from "./search-terms.ts";

const SEARCH_TEXT_FIELDS = [
  { column: "sido", jsonKey: "sido" },
  { column: "sigungu", jsonKey: "sigungu" },
  { column: "category", jsonKey: "category" },
  { column: "subcategory", jsonKey: "subcategory" },
  { column: "name", jsonKey: "name" },
  { column: "description", jsonKey: "description" },
  { column: "target", jsonKey: "target" },
  { column: "detail_target", jsonKey: "detailTarget" },
  { column: "application_method", jsonKey: "applicationMethod" },
  { column: "provider", jsonKey: "provider" },
  { column: "type", jsonKey: "type" },
] as const;

const WHITESPACE_CODES = [9, 10, 11, 12, 13, 160, 12288] as const;
const SPACE_COLLAPSE_PASSES = 5;

/** lib/search-terms.ts의 searchableText와 같은 모양(소문자, 한 칸 띄어쓰기, 항목 경계 char(31), 앞뒤 빈칸)을 SQL로 만든다. */
function spacedSearchText(parts: readonly string[]): string {
  let sql = `LOWER(${parts.map((part) => `COALESCE(${part}, '')`).join(" || char(31) || ")})`;
  for (const code of WHITESPACE_CODES) sql = `REPLACE(${sql}, char(${code}), ' ')`;
  for (let pass = 0; pass < SPACE_COLLAPSE_PASSES; pass++) sql = `REPLACE(${sql}, '  ', ' ')`;
  return `' ' || REPLACE(${sql}, char(31), ' ' || char(31) || ' ') || ' '`;
}

/**
 * 저장용 검색 본문: 띄어쓰기를 남긴 본문 + char(30) + 띄어쓰기를 뺀 본문.
 * 뒤쪽은 빠른 거르기(INSTR 한 번)에만 쓰고, 일치 판정은 앞쪽(char(30) 앞)에서 한다.
 */
function storedSearchText(parts: readonly string[]): string {
  const spaced = spacedSearchText(parts);
  return `${spaced} || char(30) || REPLACE(${spaced}, ' ', '')`;
}

export const SEARCH_TEXT_FROM_COLUMNS = storedSearchText(
  SEARCH_TEXT_FIELDS.map((field) => field.column),
);

export const SEARCH_TEXT_FROM_JSON = storedSearchText(
  SEARCH_TEXT_FIELDS.map((field) => `json_extract(value, '$.${field.jsonKey}')`),
);

export const SEARCH_TEXT_LOOKUP =
  `CASE WHEN search_text <> '' THEN search_text ELSE ${SEARCH_TEXT_FROM_COLUMNS} END`;

/** 관련도 점수용 사업명·분류 본문. */
export const NAME_TEXT_SQL = storedSearchText(["name"]);
export const CATEGORY_TEXT_SQL = storedSearchText(["category", "subcategory"]);

/** 모든 대체어에 공통으로 든 가장 긴 글자열(거르기용). 대체어가 하나면 그 말 그대로다. */
function commonCore(words: readonly string[]): string {
  const [first = "", ...rest] = words;
  for (let length = first.length; length > 0; length--) {
    for (let start = 0; start + length <= first.length; start++) {
      const piece = first.slice(start, start + length);
      if (rest.every((word) => word.includes(piece))) return piece;
    }
  }
  return "";
}

/**
 * 검색어 단어 하나가 저장용 검색 본문(textSql)에 있는지(lib/search-terms.ts의 termMatches와 같은 규칙).
 * 본문 전체에 대체어의 공통 글자열이 있는 행만 골라, char(30) 앞 본문에 허용하는 모양(spacedVariants)이 있는지 본다.
 * 모양 목록은 JSON 하나로 넘겨 D1의 바인딩 개수 제한(100개)에 걸리지 않게 한다.
 * char(30)이 없는 예전 형식 본문은 본문 전체를 쓴다(마이그레이션 전에도 검색이 끊기지 않게).
 */
export function searchTermSql(term: SearchTerm, textSql: string): { sql: string; values: unknown[] } {
  const spacedPart = `SUBSTR(${textSql}, 1, INSTR(${textSql} || char(30), char(30)))`;
  return {
    sql:
      `(INSTR(${textSql}, ?) > 0` +
      ` AND EXISTS (SELECT 1 FROM json_each(?) AS form WHERE INSTR(${spacedPart}, form.value) > 0))`,
    values: [commonCore(term.alternatives), JSON.stringify(term.alternatives.flatMap(spacedVariants))],
  };
}
