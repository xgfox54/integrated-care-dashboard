import type { LegalBasisKind } from "./types";

/** 복지로 기관 구분. 민간 서비스는 대장에 포함하지 않는다. */
export type WelfareOrg = "중앙부처" | "지자체";

/** 분야를 정한 근거. */
export type TopicSource = "복지로" | "보정" | "추정" | "편집";

/** 복지톡 DB 연결이 가리키는 원본 파일의 위치와 그 쪽에서 그대로 옮긴 문장(scripts/welfare100/attach-manual-pages.mjs). */
export interface TalkRefOriginal {
  file: string;
  format: "PDF" | "HWPX";
  /** PDF는 파일의 쪽 순서(뷰어에 표시되는 쪽), HWPX는 구역 번호 */
  page: number;
  pageEnd?: number;
  /** 원본 파일 전체 쪽(구역) 수 */
  pages: number;
  /** line: 연결된 줄을 그 쪽에서 찾음, name: 그 쪽에서 제도명을 찾음, context: 앞뒤 문장으로 쪽을 어림, document: 원본 파일 전체 */
  basis: "line" | "name" | "context" | "document";
  ocr: boolean;
  /** OCR 쪽을 원본 PDF 화면과 대조해 쪽 위치를 확인한 날짜(data/welfare100/ocr-page-checks.json). 글자 교정은 뜻하지 않는다. */
  ocrCheckedAt?: string;
  /** 그 쪽의 문장을 그대로 옮긴 발췌. 표는 칸을 " | "로 이었다. */
  quote: string | null;
}

/** 복지톡 DB(사업안내 매뉴얼)에서 찾은 관련 원문 구간. */
export interface TalkRef {
  /** 매뉴얼 번호(01~39) */
  key: string;
  title: string;
  /** 합본 Markdown 줄 번호. 원본 쪽 대조에만 쓰고 화면에는 보여 주지 않는다(편집 근거로 더한 연결은 0). */
  line: number;
  heading?: string;
  match: "제도명 일치" | "관련 언급";
  count: number;
  excerpt: string;
  original?: TalkRefOriginal;
  /** 주요 제도 설명을 정리한 근거 매뉴얼(record.src)에서 찾아 더한 연결 */
  curatedSource?: true;
  /** 원문 줄 검수 판정(data/welfare100/manual-link-reviews.json) 또는 지자체 사업 목록 줄 규칙 */
  review?: TalkRefReview;
}

export interface TalkRefReview {
  decision: "DIRECT" | "LIST_ENTRY" | "SAME_NAME_OTHER_CITY" | "RECHECK" | "GENERAL_STANDARD" | "EXCLUSION_LIST" | "CONTENTS" | "PENDING";
  checkedAt: string;
  source: "review" | "rule";
}

export type BokjiroStepCode = "001" | "002" | "003" | "004" | "005" | "006";

export interface BokjiroLaw {
  name: string;
  article?: string;
  kind: LegalBasisKind;
  url?: string;
  reviewNote?: string;
}

/** 복지로 원자료가 지난 내용일 때, 확인한 최신 자료로 고친 기록(data/welfare100/bokjiro-edits.json). */
export interface BokjiroEdit {
  /** 최신 자료를 확인한 날 */
  checkedAt: string;
  /** 복지로에 등록된 원래 사업명(이름을 바꾼 경우) */
  previousName?: string;
  /** 무엇을 어떤 자료로 고쳤는지 */
  note: string;
  /** 최신 자료로 덮어쓴 복지로 필드 이름 */
  fields?: string[];
  sources: { label: string; url: string }[];
  /** 현장에서 더 확인할 사항 */
  verify?: string[];
}

/** 복지로 복지서비스 상세를 정리한 원자료. */
export interface BokjiroRaw {
  id: string;
  name: string;
  summary: string;
  org: WelfareOrg;
  sido?: string;
  sigungu?: string;
  inst?: string;
  dept?: string;
  provision: string[];
  cycle: string[];
  applyMethods: string[];
  applicants: string[];
  changeEvents: string[];
  ages?: string;
  online: boolean;
  updatedAt?: string;
  startDate?: string;
  endDate?: string;
  target?: string;
  selection?: string;
  benefit?: string;
  applyText?: string;
  contacts: { name: string; value: string }[];
  websites: { name: string; url: string }[];
  forms: string[];
  laws: BokjiroLaw[];
  steps: { code: BokjiroStepCode; org: string }[];
  topics: string[];
  topicSource: TopicSource;
  lifecycle: string[];
  household: string[];
  talkRefs: TalkRef[];
  priority: number;
  edit?: BokjiroEdit;
}

export interface RelatedService {
  slug: string;
  name: string;
}

/** 대장 목록(index.json)의 한 줄. 키를 짧게 줄여 전송량을 줄인다. */
export interface CatalogRow {
  s: string;
  n: string;
  o: string;
  no: number;
  g: 0 | 1;
  a: 0 | 1;
  sd: string;
  sg: string;
  c: string;
  t: string[];
  l: string[];
  h: string[];
  y: string;
  pv: string[];
  cy: string[];
  d: string;
  p: number;
  ln: number;
  gw: number;
  lw: number;
  k: number;
  b: number;
  on: 0 | 1;
  laws: string[];
}

export interface CatalogIndex {
  asOf: string;
  source: string;
  total: number;
  items: CatalogRow[];
}

/** 칸 이름(fields) 순서의 배열로 줄을 담은 색인(index-lite.json, index-extra.json). */
export interface PackedCatalogIndex {
  asOf: string;
  source?: string;
  total: number;
  fields: string[];
  items: unknown[][];
}
