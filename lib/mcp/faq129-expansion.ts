// 일상어로 바꿔 쓴 질문도 129 FAQ를 찾도록 질문어를 어간으로 줄이고 행정 용어로 넓힌다.
// FAQ ID·정답·평가 문항에 맞춘 규칙은 두지 않는다. 사전은 일반 행정 용어 대응만 담는다.
import { compactSearchText } from "./search-text.ts";

export interface QueryConcept {
  readonly stem: string;
  readonly variants: readonly string[];
  /** 활용 어미를 뗀 동사형이면 true. 드문 낱말 검사는 명사형에만 건다. */
  readonly verbal: boolean;
}

export interface ExpandedMatch {
  readonly coverage: number;
  readonly questionCoverage: number;
  readonly questionMatches: number;
  readonly questionStems: readonly string[];
  readonly matched: readonly string[];
  readonly unmatched: readonly string[];
}

const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/둘\s*다/g, " 모두 "], [/다시\s*(?:만들|발급|받)/g, " 재발급 "], [/빌린\s*돈/g, " 대출 "], [/집에서\s*(?:키우|돌보)/g, " 가정양육 "],
  [/오래\s*(?:일하|근무)/g, " 장기근속 "], [/(?:안|못)\s*(?:달아|설치하)/g, " 설치하지 "],
];

// 일상어(앞부분 일치) → FAQ가 쓰는 행정 용어.
const SYNONYMS: readonly (readonly [readonly string[], readonly string[]])[] = [
  [["남편", "아내", "와이프", "배우자"], ["부부", "배우자"]],
  [["깎", "줄어", "줄이", "삭감", "감액"], ["감액", "삭감", "공제", "감산"]],
  [["빚", "대출", "융자", "부채"], ["부채", "대출"]],
  [["기초수급자", "기초생활수급자"], ["수급자", "기초생활"]],
  [["은행", "금융기관"], ["금융기관", "은행"]],
  [["생계비"], ["생계급여"]],
  [["계산", "산정"], ["계산", "산정"]],
  [["인터넷", "온라인", "홈페이지", "웹사이트", "누리집"], ["온라인", "누리집", "홈페이지", "복지로"]],
  [["동사무소", "주민센터", "행정복지센터"], ["행정복지센터", "주민센터", "읍면동"]],
  [["잃어버", "잃었", "분실"], ["분실"]],
  [["재발급", "재발행"], ["재발급", "재발행"]],
  [["접수"], ["신청", "접수"]],
  [["해외", "외국", "국외"], ["국외", "해외", "체류"]],
  [["휴대폰", "핸드폰", "스마트폰"], ["모바일", "스마트폰"]],
  [["담배", "흡연", "피우", "피운"], ["흡연", "금연"]],
  [["돌아가", "사망", "별세"], ["사망"]],
  [["장례"], ["장제", "장례"]],
  [["동생", "남동생", "여동생", "친동생"], ["동생", "가족", "형제", "자매"]],
  [["형제", "자매", "친척"], ["가족", "형제", "자매"]],
  [["도우미"], ["제공인력"]],
  [["생신"], ["생일"]],
  [["신청서"], ["신청"]],
  [["전에", "이전에"], ["이전", "사전"]],
  [["스케일링"], ["치석제거"]],
  [["요양원"], ["노인요양시설", "요양시설"]],
  [["요양보호사"], ["종사자", "요양보호사"]],
  [["월급", "근로소득"], ["근로소득", "상시근로"]],
  [["뗄", "떼"], ["발급"]],
  [["목록", "위치"], ["현황"]],
  [["그만두", "퇴소"], ["퇴소"]],
  [["들어오", "입금", "지급일"], ["지급", "입금"]],
  [["가게", "상점", "매장"], ["사업주", "사업장", "현장"]],
  [["낮아", "하향"], ["하향"]],
  [["못받", "제외"], ["제외"]],
  [["대신", "대리"], ["대리"]],
  [["벌금", "과태료", "처벌", "불이익"], ["과태료", "불이익", "벌칙"]],
  [["청약통장", "주택청약"], ["주택청약", "청약"]],
  [["통장", "계좌"], ["계좌", "통장"]],
  [["압류"], ["압류"]],
];

const STOP = new Set(["어떻게", "어디서", "어디", "어디에", "언제", "누가", "누구", "무엇", "뭔가", "뭔가요", "어떤", "있는", "있나", "없나", "있을", "할수", "수", "것", "때", "곳",
  "제가", "저는", "저도", "제", "저", "우리", "지금", "혹시", "그냥", "아직", "바로", "미리", "같은", "다른", "이런", "그런", "경우", "궁금", "궁금합니다", "알려", "알려주세요",
  "가능", "가능한", "되나", "하나", "인가", "지원", "신청", "대상", "방법", "기준", "관련", "문의", "안내", "내용", "얼마", "알고", "싶어", "싶은데", "해야", "하는", "받을", "받는", "받으",
  "있고", "없고", "있는", "없는", "되는", "버는", "쳐주", "해주", "빼주", "와도", "써도", "둬도", "어디서",
  "오래", "바로", "미리", "다시", "같이", "함께", "혼자", "계속", "자주", "먼저", "나중", "언제든", "벌써", "이미", "아직도",
  "받고", "돈도", "없어", "나가", "나가기", "들어가", "가고", "가서", "와서", "보고", "주고", "하고", "되고",
  "제도", "설명", "설명해", "주세요"]);

// 긴 어미·조사부터 한 번만 떼어 어간을 남긴다(어간 2자 미만이면 원형 유지).
const SUFFIXES = ["하려면", "하려고", "했는데", "했어요", "하는데", "하나요", "되나요", "됐는데", "되는데", "인가요", "인지요", "일까요", "할까요", "될까요", "있나요", "없나요",
  "이나요", "으려면", "려면", "하러", "하고", "해서", "해도", "하면", "하는", "한데", "되면", "돼서", "에서", "에게", "한테", "으로", "이랑", "까지", "부터", "에는", "에도", "이란", "인지",
  "는데", "은데", "나요", "가요", "까요", "는지", "은지", "이면", "인데", "으면", "했", "한", "된", "할", "을", "를", "은", "는", "이", "가", "에", "의", "도", "만", "로", "와", "과", "랑", "면", "요"];

const VERBAL_SINGLE = new Set(["했", "한", "된", "할", "면", "요"]);

/** 두 글자 이상 어미를 떼면 한 글자만 남는 활용형(찾나요·일해서)은 뜻이 약해 null로 버린다. */
function stemOf(word: string): { readonly stem: string; readonly verbal: boolean } | null {
  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    // 명사+하다(헌혈하러·입원하면)는 어미를 떼면 명사가 남는다.
    const nounVerb = /^(?:하|되|돼|했|됐|한|된|할)/.test(suffix);
    if (word.length - suffix.length >= 2) return { stem: word.slice(0, -suffix.length), verbal: !nounVerb && (suffix.length >= 2 || VERBAL_SINGLE.has(suffix)) };
    if (suffix.length >= 2) return null;
  }
  return { stem: word, verbal: false };
}

const NATIVE_TENS: Readonly<Record<string, number>> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90 };
const NATIVE_ONES: Readonly<Record<string, number>> = { 하나: 1, 둘: 2, 셋: 3, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };

/** 한글로 쓴 수량을 숫자 검색어로도 찾는다. 반환 원문과 실제 나이 조건은 바꾸지 않는다. */
function nativeNumberVariants(word: string): string[] {
  const match = /^(열|스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔)(하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉)?(?:살)?$/.exec(word);
  if (!match) return [];
  return [String((NATIVE_TENS[match[1]] ?? 0) + (NATIVE_ONES[match[2] ?? ""] ?? 0))];
}

function includesVariant(text: string, variant: string): boolean {
  return /^\d+$/.test(variant) ? new RegExp(`(?<![0-9])${variant}(?![0-9])`).test(text) : text.includes(variant);
}

export function queryConcepts(rawQuery: string, excluded: readonly string[] = []): QueryConcept[] {
  let text = rawQuery.normalize("NFKC").replace(/[0-9]{4}\s*년/g, " ");
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  const skip = new Set(excluded.map(compactSearchText));
  const concepts = new Map<string, QueryConcept>();
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const word = compactSearchText(raw);
    if (word.length < 2 || STOP.has(word)) continue;
    const parsed = stemOf(word);
    const synonymKey = SYNONYMS.flatMap(([keys]) => keys).find((key) => word.startsWith(key));
    if (parsed === null && !synonymKey) continue;
    const parsedStem = parsed ?? { stem: synonymKey ?? word, verbal: true };
    const stem = parsedStem.stem.replace(/(?<=[가-힣]{2})님$/, "");
    const verbal = parsedStem.verbal;
    if ((stem.length < 2 && !synonymKey) || STOP.has(stem) || skip.has(stem) || [...skip].some((value) => value.includes(stem))) continue;
    const synonyms = SYNONYMS.filter(([keys]) => keys.some((key) => stem.startsWith(key) || word.startsWith(key))).flatMap(([, values]) => values);
    // 활동지원의 시간은 급여량으로 표현되지만 다른 사업의 시간·금액은 같은 뜻으로 넓히지 않는다.
    const activityVariants = skip.has("장애인활동지원")
      ? (stem === "시간" ? ["이용량", "급여량"] : stem === "활동지원사" ? ["활동지원인력"] : []) : [];
    if (!concepts.has(stem)) concepts.set(stem, { stem, variants: [...new Set([stem, ...synonyms, ...nativeNumberVariants(stem), ...activityVariants])], verbal });
  }
  return [...concepts.values()];
}

/** 정확 일치에 쓸 질문어. 뜻이 약한 활용형(있는데·받으면·갖추면)은 빼고, 명사+하다(출산하고)는 명사만 남긴다. */
export function strictTerm(term: string, generic: ReadonlySet<string>): string | null {
  if (STOP.has(term) || generic.has(term.replace(/해야?$/, ""))) return null;
  const parsed = stemOf(term);
  if (!parsed || parsed.verbal) return null;
  const nounVerb = parsed.stem !== term && /^(?:하|되|돼|했|됐|한|된|할)/.test(term.slice(parsed.stem.length));
  const value = nounVerb ? parsed.stem : term;
  return value.length < 2 || STOP.has(value) || generic.has(value) ? null : value;
}

/** 질문·분야·별칭에서 맞으면 1, 답변에서만 맞으면 0.5로 센다. */
export function expandedMatch(concepts: readonly QueryConcept[], questionText: string, answerText: string, programMatched = false): ExpandedMatch {
  if (!concepts.length) return { coverage: 0, questionCoverage: 0, questionMatches: 0, questionStems: [], matched: [], unmatched: [] };
  // 질문의 제도명과 FAQ 제도가 맞으면 제도명을 질문에서 맞은 개념 하나로 센다.
  const size = concepts.length + (programMatched ? 1 : 0);
  let total = programMatched ? 1 : 0, question = total;
  const matched: string[] = [];
  const unmatched: string[] = [];
  const questionStems: string[] = [];
  for (const concept of concepts) {
    const hit = concept.variants.find((variant) => includesVariant(questionText, variant));
    if (hit) { total += 1; question += 1; matched.push(hit); questionStems.push(concept.stem); continue; }
    const inAnswer = concept.variants.find((variant) => includesVariant(answerText, variant));
    if (inAnswer) { total += 0.5; matched.push(inAnswer); } else unmatched.push(concept.stem);
  }
  return { coverage: total / size, questionCoverage: question / size, questionMatches: question, questionStems, matched, unmatched };
}

/** 전체 FAQ 중 1~10건에만 나오는 드문 질문어. 느슨한 일치에서도 후보 FAQ가 반드시 담아야 한다. */
export function rareConcepts(concepts: readonly QueryConcept[], documents: readonly string[]): Set<string> {
  const rare = new Set<string>();
  for (const concept of concepts) {
    if (concept.verbal) continue;
    let count = 0;
    for (const document of documents) if (concept.variants.some((variant) => includesVariant(document, variant)) && ++count > 10) break;
    if (count >= 1 && count <= 10) rare.add(concept.stem);
  }
  return rare;
}
