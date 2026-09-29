// 공통 검색어 해석기. 대시보드·통합돌봄 WIKI(서버 검색)와 복지제도100(브라우저 검색)이 같은 규칙으로 검색어를 읽는다.
// - 띄어쓰기로 단어를 나누고, 모든 단어가 들어 있는 항목을 찾는다. 단어 순서는 따지지 않는다.
// - 단어 안의 띄어쓰기는 나뉜 조각이 모두 두 글자 이상이거나 독립된 한 글자 단어일 때만 따지지 않는다.
//   예: 방문진료 = 방문 진료, 퇴원후돌봄 = 퇴원 후 돌봄. 기동은 「집보기 동행」의 「기 동」과 맞지 않는다.
// - 검색어는 사업명·설명 같은 항목의 경계를 넘어 맞지 않는다.
// - 지역어는 정식 이름까지 함께 찾는다. 예: 경북 → 경상북도, 부산시 → 부산광역시, 해운대 → 해운대구
// - 군더더기 말(후·및·관련·사업·서비스 등)은 빼고 찾는다. 모두 군더더기 말이면 그대로 찾는다.
// - 관련도는 사업명 일치 > 분류 일치 > 그 밖의 일치 순이다.
// - 연산자: & 또는 띄어쓰기 = 모두 포함, | 또는 글자 or = 하나라도 포함(&보다 먼저 묶임), ( ) = 묶음,
//   * = 사이에 아무 글자나(순서 유지), 단어 앞 - 또는 ! = 제외. 예: 부산 or 울산 방문*진료 -요양

export interface SearchTerm {
  /** 이용자가 친 단어(화면 표시·검색어 다시 만들기용, 연산자 포함) */
  readonly text: string;
  /** 띄어쓰기를 없앤 소문자(| 로 이은 선택지 포함) */
  readonly key: string;
  /** 이 가운데 하나만 들어 있어도 일치로 본다. * 가 든 것은 순서대로 이어 찾는 말이다. */
  readonly alternatives: readonly string[];
  /** 광역시·도나 시·군·구 이름(선택지가 모두 지역어일 때) */
  readonly region: boolean;
  /** 제외할 단어(앞에 - 또는 !) */
  readonly negated: boolean;
  /** 연산자 없는 보통 단어(오타 고치기·사업명 일치 가산 대상) */
  readonly plain: boolean;
}

export interface ParsedSearch {
  readonly terms: readonly SearchTerm[];
  /** 지역어를 뺀 단어들을 이은 말. 사업명 전체 일치 가산에 쓴다. */
  readonly phrase: string;
  readonly hasRegion: boolean;
}

export type SearchSort = "relevance" | "region" | "name";
export const SEARCH_SORTS: readonly SearchSort[] = ["relevance", "region", "name"];

export function isSearchSort(value: unknown): value is SearchSort {
  return typeof value === "string" && (SEARCH_SORTS as readonly string[]).includes(value);
}

/** 검색어가 있으면 관련도순, 없으면 지역순이 기본이다. */
export function effectiveSort(sort: string | undefined, keyword: string): SearchSort {
  const hasKeyword = parseSearch(keyword).terms.length > 0;
  if (sort === "name") return "name";
  if (sort === "region") return "region";
  return hasKeyword ? "relevance" : "region";
}

export const MAX_SEARCH_TERMS = 6;
const STOPWORDS = new Set(["후", "및", "관련", "위한", "대한", "등", "사업", "서비스", "지원사업"]);

export function normalizeSearchText(value: string): string {
  return value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
}

// ---- 검색용 본문 ----

/** 검색용 본문에서 항목(사업명·설명 등) 사이에 넣는 경계. 검색어는 이 경계를 넘어 맞지 않는다. */
export const FIELD_BREAK = "\u001f";

/**
 * 검색용 본문: 소문자, 띄어쓰기는 한 칸으로 남기고 항목 사이에 경계를 넣는다.
 * 앞뒤와 경계 양옆에 빈칸을 둬서 항목 처음·끝의 한 글자 단어도 독립된 단어로 알아본다.
 * 서버 DB(lib/official-search-text.ts)도 같은 모양으로 저장한다.
 */
export function searchableText(parts: readonly (string | null | undefined)[]): string {
  const joined = parts.map((part) => part ?? "").join(FIELD_BREAK).toLowerCase().replace(/\s+/g, " ");
  return " " + joined.replaceAll(FIELD_BREAK, " " + FIELD_BREAK + " ") + " ";
}

/** 띄어쓰기를 넘어 맞출 때 나눌 수 있는 조각 수. 긴 단어일수록 줄여 서버 조건이 커지지 않게 한다. */
export function maxSpacedPieces(key: string): number {
  return key.length <= 10 ? 4 : key.length <= 20 ? 3 : 2;
}

/**
 * 검색용 본문(searchableText)에 단어(key, 띄어쓰기 없음)가 있는지.
 * 그대로 들어 있거나, 띄어쓰기로 나뉘어 있되 조각마다 두 글자 이상이거나 독립된 한 글자 단어일 때 맞는다.
 */
export function containsTerm(text: string, key: string): boolean {
  if (!key) return false;
  if (text.includes(key)) return true;
  for (let start = text.indexOf(key[0]); start !== -1; start = text.indexOf(key[0], start + 1)) {
    if (spacedMatchAt(text, key, start)) return true;
  }
  return false;
}

function spacedMatchAt(text: string, key: string, start: number): boolean {
  let position = start;
  const pieces = [0];
  for (let index = 0; index < key.length; index++) {
    if (index > 0 && text[position] === " ") {
      pieces.push(0);
      position++;
    }
    if (text[position] !== key[index]) return false;
    pieces[pieces.length - 1]++;
    position++;
  }
  if (pieces.length < 2 || pieces.length > maxSpacedPieces(key)) return false;
  // 가운데 조각은 앞뒤가 띄어쓰기라 늘 독립된 단어다. 처음·끝 한 글자 조각만 단어의 일부인지 본다.
  if (pieces[0] === 1 && text[start - 1] !== " ") return false;
  if (pieces[pieces.length - 1] === 1 && text[position] !== " ") return false;
  return true;
}

/**
 * containsTerm이 맞다고 보는 모양을 모두 적은 목록(서버 SQL 조건용). 첫 항목은 단어 그대로다.
 * 처음·끝 조각이 한 글자면 그 앞·뒤에 빈칸을 붙여 독립된 단어일 때만 맞게 한다.
 */
export function spacedVariants(key: string): string[] {
  const variants = [key];
  const limit = maxSpacedPieces(key);
  const visit = (from: number, pieces: string[]) => {
    if (from === key.length) {
      if (pieces.length < 2) return;
      const head = pieces[0].length === 1 ? " " : "";
      const tail = pieces[pieces.length - 1].length === 1 ? " " : "";
      variants.push(head + pieces.join(" ") + tail);
      return;
    }
    if (pieces.length === limit) return;
    for (let end = from + 1; end <= key.length; end++) visit(end, [...pieces, key.slice(from, end)]);
  };
  visit(0, []);
  return variants;
}

// ---- 지역어 ----

/** 광역시·도 이름과 흔히 쓰는 약칭. 값은 함께 찾을 이름(띄어쓰기 없음). */
const SIDO_WORDS: Record<string, readonly string[]> = {
  서울: ["서울"], 서울시: ["서울시", "서울특별시"], 서울특별시: ["서울특별시"],
  부산: ["부산"], 부산시: ["부산시", "부산광역시"], 부산광역시: ["부산광역시"],
  대구: ["대구"], 대구시: ["대구시", "대구광역시"], 대구광역시: ["대구광역시"],
  인천: ["인천"], 인천시: ["인천시", "인천광역시"], 인천광역시: ["인천광역시"],
  대전: ["대전"], 대전시: ["대전시", "대전광역시"], 대전광역시: ["대전광역시"],
  울산: ["울산"], 울산시: ["울산시", "울산광역시"], 울산광역시: ["울산광역시"],
  세종: ["세종"], 세종시: ["세종시", "세종특별자치시"], 세종특별자치시: ["세종특별자치시"],
  경기: ["경기"], 경기도: ["경기도"],
  강원: ["강원"], 강원도: ["강원도", "강원특별자치도"], 강원특별자치도: ["강원특별자치도", "강원도"],
  충북: ["충북", "충청북도"], 충청북도: ["충청북도"],
  충남: ["충남", "충청남도"], 충청남도: ["충청남도"],
  전북: ["전북", "전라북도"], 전라북도: ["전라북도", "전북특별자치도"], 전북특별자치도: ["전북특별자치도", "전라북도"],
  전남: ["전남", "전라남도"], 전라남도: ["전라남도", "전남광주통합특별시"],
  광주: ["광주"], 광주시: ["광주시", "광주광역시"], 광주광역시: ["광주광역시", "전남광주통합특별시"],
  전남광주: ["전남광주", "광주광역시", "전라남도"], 전남광주통합특별시: ["전남광주통합특별시", "광주광역시", "전라남도"],
  경북: ["경북", "경상북도"], 경상북도: ["경상북도"],
  경남: ["경남", "경상남도"], 경상남도: ["경상남도"],
  제주: ["제주"], 제주도: ["제주도", "제주특별자치도"], 제주특별자치도: ["제주특별자치도"],
};

/** 시·군·구 이름(대시보드 자료와 복지제도 대장에 나오는 것). */
const SIGUNGU_NAMES = new Set<string>([
  "가평군", "강남구", "강동구", "강릉시", "강북구", "강서구", "강진군", "강화군", "거제시", "거창군", "검단구", "경산시",
  "경주시", "계룡시", "계양구", "고령군", "고성군", "고양시", "고창군", "고흥군", "곡성군", "공주시", "과천시", "관악구",
  "광명시", "광산구", "광양시", "광주시", "광진구", "괴산군", "구례군", "구로구", "구리시", "구미시", "군산시", "군위군",
  "군포시", "금산군", "금정구", "금천구", "기장군", "김제시", "김천시", "김포시", "김해시", "나주시", "남구", "남동구",
  "남양주시", "남원시", "남해군", "노원구", "논산시", "단양군", "달서구", "달성군", "담양군", "당진시", "대덕구", "도봉구",
  "동구", "동대문구", "동두천시", "동래구", "동작구", "동해시", "마포구", "목포시", "무안군", "무주군", "문경시", "미추홀구",
  "밀양시", "보령시", "보성군", "보은군", "봉화군", "부산진구", "부안군", "부여군", "부천시", "부평구", "북구", "사상구",
  "사천시", "사하구", "산청군", "삼척시", "상주시", "서구", "서귀포시", "서대문구", "서산시", "서천군", "서초구", "서해구",
  "성남시", "성동구", "성북구", "성주군", "속초시", "송파구", "수성구", "수영구", "수원시", "순창군", "순천시", "시흥시",
  "신안군", "아산시", "안동시", "안산시", "안성시", "안양시", "양구군", "양산시", "양양군", "양주시", "양천구", "양평군",
  "여수시", "여주시", "연수구", "연제구", "연천군", "영광군", "영덕군", "영도구", "영동군", "영등포구", "영암군", "영양군",
  "영월군", "영종구", "영주시", "영천시", "예산군", "예천군", "오산시", "옥천군", "옹진군", "완도군", "완주군", "용산구",
  "용인시", "울릉군", "울주군", "울진군", "원주시", "유성구", "은평구", "음성군", "의령군", "의성군", "의왕시", "의정부시",
  "이천시", "익산시", "인제군", "임실군", "장성군", "장수군", "장흥군", "전주시", "정선군", "정읍시", "제물포구", "제주시",
  "제천시", "종로구", "중구", "중랑구", "증평군", "진도군", "진안군", "진주시", "진천군", "창녕군", "창원시", "천안시",
  "철원군", "청도군", "청송군", "청양군", "청주시", "춘천시", "충주시", "칠곡군", "태백시", "태안군", "통영시", "파주시",
  "평창군", "평택시", "포천시", "포항시", "하남시", "하동군", "함안군", "함양군", "함평군", "합천군", "해남군", "해운대구",
  "홍성군", "홍천군", "화성시", "화순군", "화천군", "횡성군",
]);

/**
 * 시·군·구 이름에서 시·군·구를 뗀 말 가운데 복지 자료에서 일반어로 흔히 쓰는 것.
 * 이 말만 치면 지역어로 보지 않고 보통 단어로 찾는다(예: 영양 지원, 장수 수당, 고령 어르신).
 * 보통 단어로 찾아도 그 지역 사업은 본문에 지역명이 있어 함께 나온다. 영양군처럼 이름을 다 치면 지역어로 본다.
 */
const COMMON_WORD_PLACES = new Set<string>([
  "강화", "거창", "경주", "고령", "공주", "관악", "광산", "구리", "구미", "기장", "남동", "달성", "동작", "무안",
  "보은", "부여", "사상", "상주", "수영", "양산", "양주", "연수", "영광", "영양", "예산", "오산", "완주", "용인",
  "음성", "인제", "장수", "정선", "진도", "진주", "화성",
]);

function regionAlternatives(key: string): readonly string[] | null {
  const sido = SIDO_WORDS[key];
  if (sido) return sido;
  if (SIGUNGU_NAMES.has(key)) return [key];
  // 해운대 → 해운대구, 수원 → 수원시 (두 글자 이상이고 흔한 일반어가 아닐 때만)
  if (key.length >= 2 && !COMMON_WORD_PLACES.has(key) && ["시", "군", "구"].some((suffix) => SIGUNGU_NAMES.has(key + suffix))) {
    return [key];
  }
  return null;
}

// ---- 해석 ----

const EDGE_PUNCTUATION = /^["'“”‘’()[\]{}<>「」『』]+|["'“”‘’()[\]{}<>「」『』.,!?]+$/g;
/** D1의 LIKE 패턴 길이 한도(바이트). 이보다 긴 * 검색어는 * 없이 이어 붙인 말로 찾는다. */
const LIKE_PATTERN_MAX_BYTES = 50;

export const WILDCARD = "*";

/** * 검색어를 LIKE 패턴으로(%·_·\ 는 \ 로 가린다). */
export function wildcardLikePattern(alternative: string): string {
  return "%" + alternative.split(WILDCARD).filter(Boolean).map((piece) => piece.replace(/[\\%_]/g, "\\$&")).join("%") + "%";
}

function cleanOption(option: string): string {
  const key = normalizeSearchText(option).replace(EDGE_PUNCTUATION, "").replace(/\*+/g, WILDCARD).replace(/^\*|\*$/g, "");
  if (!key.includes(WILDCARD)) return key;
  return new TextEncoder().encode(wildcardLikePattern(key)).length <= LIKE_PATTERN_MAX_BYTES ? key : key.replaceAll(WILDCARD, "");
}

interface ParsedWord {
  readonly text: string;
  readonly key: string;
  readonly options: readonly string[];
  readonly negated: boolean;
}

type Token = { readonly kind: "word"; readonly raw: string } | { readonly kind: "or" | "not" | "open" | "close" };

/** 검색어 묶음(절): 단어 가운데 하나라도 들면 맞는다. negated면 어느 단어도 들지 않아야 맞는다. */
interface Clause {
  readonly words: readonly string[];
  readonly negated: boolean;
}

const WORD_SEPARATOR = /[\s,·/&]/u;
/** 영문 or(대소문자 무관)는 | 와 같다. */
const OR_WORD = /^or$/iu;
/** 괄호 묶음을 풀 때(분배) 생기는 묶음 수 한도. 넘는 묶음은 버린다. */
const MAX_CLAUSES = 24;

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  const chars = [...query];
  let word = "";
  const flush = () => {
    if (word) tokens.push(OR_WORD.test(word) ? { kind: "or" } : { kind: "word", raw: word });
    word = "";
  };
  chars.forEach((char, index) => {
    const next = chars[index + 1];
    if (WORD_SEPARATOR.test(char)) flush();
    else if (char === "|") {
      flush();
      tokens.push({ kind: "or" });
    } else if (char === "(" || char === ")") {
      flush();
      tokens.push({ kind: char === "(" ? "open" : "close" });
    } else if ((char === "-" || char === "!") && word === "" && next !== undefined && !WORD_SEPARATOR.test(next)) {
      tokens.push({ kind: "not" });
    } else word += char;
  });
  flush();
  return tokens;
}

/** (A 그리고 B) 또는 (C 그리고 D) = (A|C)(A|D)(B|C)(B|D). 한쪽이 비면 다른 쪽을 그대로 쓴다. */
function distribute(left: readonly Clause[], right: readonly Clause[]): Clause[] {
  if (left.length === 0) return [...right];
  if (right.length === 0) return [...left];
  return left
    .flatMap((one) => right.map((other) => ({ words: [...one.words, ...other.words], negated: false })))
    .slice(0, MAX_CLAUSES);
}

/** 제외는 묶음 하나에만 걸 수 있다. 여러 묶음을 빼라고 하면(-(A B)) 든 단어를 모두 뺀다. */
function negate(clauses: readonly Clause[]): Clause[] {
  if (clauses.length === 0) return [];
  return [{ words: clauses.flatMap((clause) => clause.words), negated: !(clauses.length === 1 && clauses[0].negated) }];
}

/** 검색어를 「그리고로 이은 묶음들」로 푼다. 또는(| · or)이 그리고보다 먼저 묶이고, 괄호가 가장 먼저다. */
function toClauses(tokens: readonly Token[]): Clause[] {
  let at = 0;
  const peek = () => tokens[at];
  const primary = (): Clause[] => {
    const token = peek();
    if (token?.kind === "word") {
      at++;
      return [{ words: [token.raw], negated: false }];
    }
    if (token?.kind !== "open") return [];
    at++;
    const inner = sequence(true);
    if (peek()?.kind === "close") at++;
    return inner;
  };
  const alternatives = (): Clause[] => {
    let negated = false;
    while (peek()?.kind === "not") {
      negated = true;
      at++;
    }
    let result = primary();
    while (peek()?.kind === "or") {
      at++;
      while (peek()?.kind === "not") at++;
      result = distribute(result, primary());
    }
    return negated ? negate(result) : result;
  };
  const sequence = (inGroup: boolean): Clause[] => {
    const clauses: Clause[] = [];
    while (at < tokens.length) {
      const kind = peek().kind;
      if (kind === "close" && inGroup) break;
      if (kind === "close" || kind === "or") {
        at++;
        continue;
      }
      clauses.push(...alternatives());
    }
    return clauses;
  };
  return sequence(false);
}

function toWord(clause: Clause): ParsedWord | null {
  const kept = clause.words.map((raw) => ({ raw: raw.trim(), key: cleanOption(raw) })).filter((word) => word.key);
  if (kept.length === 0) return null;
  const options = [...new Set(kept.map((word) => word.key))];
  const text = (clause.negated ? "-" : "") + [...new Set(kept.map((word) => word.raw))].join("|");
  return { text, key: options.join("|"), options, negated: clause.negated };
}

/** 다른 묶음을 품은 또는-묶음은 뺀다. 예: (부산|방문진료) 그리고 방문진료 = 방문진료 */
function withoutRedundant(words: readonly ParsedWord[]): ParsedWord[] {
  return words.filter((word, index) =>
    word.negated ||
    !words.some((other, otherIndex) =>
      otherIndex !== index &&
      !other.negated &&
      other.options.every((option) => word.options.includes(option)) &&
      (other.options.length < word.options.length || otherIndex < index)));
}

function toTerm(word: ParsedWord): SearchTerm {
  const expanded = word.options.map((option) => (option.includes(WILDCARD) ? null : regionAlternatives(option)));
  const alternatives = word.options.flatMap((option, index) => expanded[index] ?? [option]);
  const region = expanded.every((value) => value !== null);
  const plain = !word.negated && word.options.length === 1 && !word.key.includes(WILDCARD);
  return { text: word.text, key: word.key, alternatives: [...new Set(alternatives)], region, negated: word.negated, plain };
}

export function parseSearch(query: string): ParsedSearch {
  const words = withoutRedundant(
    toClauses(tokenize(query))
      .map(toWord)
      .filter((word) => word !== null),
  );
  const meaningful = words.filter((word) => word.negated || !STOPWORDS.has(word.key));
  const chosen = (meaningful.length > 0 ? meaningful : words).filter(
    (word, index, list) => list.findIndex((other) => other.key === word.key && other.negated === word.negated) === index,
  );
  const terms = chosen.slice(0, MAX_SEARCH_TERMS).map(toTerm);
  const positive = terms.filter((term) => !term.negated);
  return {
    terms,
    phrase: positive.every((term) => term.plain || term.region) ? positive.filter((term) => !term.region).map((term) => term.key).join("") : "",
    hasRegion: positive.some((term) => term.region),
  };
}

/** * 검색어: 띄어쓰기를 뺀 본문에 조각들이 이 순서대로 들어 있는지(서버의 LIKE '%조각%조각%'과 같다). */
function wildcardMatches(text: string, alternative: string): boolean {
  const flat = text.replaceAll(" ", "");
  let from = 0;
  for (const piece of alternative.split(WILDCARD).filter(Boolean)) {
    const index = flat.indexOf(piece, from);
    if (index === -1) return false;
    from = index + piece.length;
  }
  return true;
}

export function termMatches(text: string, term: SearchTerm): boolean {
  return term.alternatives.some((alternative) =>
    alternative.includes(WILDCARD) ? wildcardMatches(text, alternative) : containsTerm(text, alternative));
}

/**
 * 검색용 본문(searchableText로 만든 text)이 검색어의 모든 단어를 담고, 제외어는 담지 않는지.
 * ignoreRegion: 전국 공통 제도처럼 지역과 관계없는 항목은 지역어를 따지지 않는다.
 */
export function matchesSearch(text: string, parsed: ParsedSearch, options: { ignoreRegion?: boolean } = {}): boolean {
  return parsed.terms.every((term) =>
    (options.ignoreRegion && term.region) || term.negated !== termMatches(text, term));
}

// ---- 관련도 ----

export const RELEVANCE = {
  nameTerm: 20,
  nameRegionTerm: 5,
  categoryTerm: 6,
  exactName: 60,
  namePhrase: 15,
} as const;

/** 관련도 점수. 서버 정렬(SQL)도 같은 점수표를 쓴다. */
export function relevanceScore(fields: { readonly name: string; readonly category?: string }, parsed: ParsedSearch): number {
  const name = searchableText([fields.name]);
  const category = searchableText([fields.category]);
  const nameKey = normalizeSearchText(fields.name);
  let score = 0;
  for (const term of parsed.terms) {
    if (term.negated) continue;
    if (termMatches(name, term)) score += term.region ? RELEVANCE.nameRegionTerm : RELEVANCE.nameTerm;
    else if (!term.region && termMatches(category, term)) score += RELEVANCE.categoryTerm;
  }
  if (parsed.phrase) {
    if (nameKey === parsed.phrase) score += RELEVANCE.exactName;
    else if (parsed.terms.filter((term) => !term.region && !term.negated).length >= 2 && nameKey.includes(parsed.phrase)) score += RELEVANCE.namePhrase;
  }
  return score;
}

// ---- 0건일 때 도움말 ----

/** index번째 단어를 뺀(또는 바꾼) 검색어. */
export function rebuildQuery(parsed: ParsedSearch, index: number, replacement?: string): string {
  return parsed.terms
    .map((term, position) => (position === index ? replacement ?? "" : term.text))
    .filter(Boolean)
    .join(" ");
}

/** 오타 제안에 쓸 이름 목록(띄어쓰기·기호를 뺀 소문자). */
export function namesForSuggestion(names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const name of names) {
    const clean = normalizeSearchText(name).replace(/[^0-9a-z가-힣]/g, "");
    if (clean) out.push(clean);
  }
  return out;
}

/** a와 b가 한 글자 바꾸기·넣기·빼기로 같아지는지. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 한글 음절을 초성·중성·종성 번호로 나눈다. 한글이 아니면 글자 그대로 둔다. */
function toJamo(value: string): string[] {
  const out: string[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < HANGUL_START || code > HANGUL_END) {
      out.push(char);
      continue;
    }
    const offset = code - HANGUL_START;
    out.push("c" + Math.floor(offset / 588), "v" + Math.floor((offset % 588) / 28), "f" + (offset % 28));
  }
  return out;
}

/** 자모 단위 편집 거리. 치메→치매(모음 1개)가 치메→치료(자모 2개)보다 가깝다. */
export function jamoDistance(a: string, b: string): number {
  const x = toJamo(a);
  const y = toJamo(b);
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

/**
 * 오타로 보이는 단어의 고칠 말. 이름들(namesForSuggestion)에서 한 글자만 다른 말을 찾는다.
 * 두 번 이상 나온 후보 가운데 자모가 가장 가까운 말을 고르고, 같으면 많이 나온 말, 같은 길이의 말 순으로 고른다.
 * 한글이 없거나 두 글자 미만이거나, 두 번 이상 나온 후보가 없으면 null.
 */
export function correctionFrom(key: string, names: readonly string[]): string | null {
  if (key.length < 2 || key.length > 12 || !/[가-힣]/.test(key)) return null;
  const counts = new Map<string, number>();
  const lengths = [key.length - 1, key.length, key.length + 1].filter((length) => length >= 2);
  for (const name of names) {
    const seen = new Set<string>();
    for (const length of lengths) {
      for (let start = 0; start + length <= name.length; start++) {
        const piece = name.slice(start, start + length);
        if (seen.has(piece) || !withinOneEdit(key, piece)) continue;
        seen.add(piece);
        counts.set(piece, (counts.get(piece) ?? 0) + 1);
      }
    }
  }
  let best: { word: string; count: number; distance: number } | null = null;
  for (const [word, count] of counts) {
    if (count < 2) continue;
    const distance = jamoDistance(key, word);
    const better =
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (count > best.count || (count === best.count && word.length === key.length && best.word.length !== key.length)));
    if (better) best = { word, count, distance };
  }
  return best ? best.word : null;
}

/** 0건일 때 화면에 보여 줄 도움말. */
export interface SearchHelp {
  /** 오타를 고친 검색어와 그 결과 수 */
  readonly suggestion?: { readonly query: string; readonly count: number };
  /** 단어를 하나씩 뺐을 때의 검색어와 결과 수(두 단어 이상일 때) */
  readonly withoutTerm?: readonly { readonly term: string; readonly query: string; readonly count: number }[];
}
