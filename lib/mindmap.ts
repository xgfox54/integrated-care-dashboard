// 복지 마인드맵: 복지 마인드맵 DB의 분류·관계를 마디(node) 나무로 만든다. 서버(집계)와 화면(복지제도100 색인)이 함께 쓰는 순수 함수만 둔다.
// 수는 모두 실제 저장 자료를 센 값이며, 사업 수는 수혜자 수·예산 규모가 아니다.
import { orderServiceCategories } from "./dataset-summary.ts";

export interface MindNode {
  readonly id: string;
  readonly label: string;
  /** 이 마디에 속한 실제 항목 수 */
  readonly count?: number;
  /** count의 단위(건·개·곳) */
  readonly unit?: string;
  /** 누르면 갈 화면(같은 사이트 상대 주소) */
  readonly href?: string;
  /** 짧은 설명·근거 */
  readonly note?: string;
  readonly children?: readonly MindNode[];
}

/** 대상자 묶음(MCP find_programs와 같은 낱말 규칙). 관련 수는 모두 같은 낱말로 실제 자료를 센 값이다. */
export interface TargetGroupSource {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly count: number;
  /** 대분류별 사업 수 */
  readonly byCategory?: readonly { readonly category: string; readonly count: number }[];
  /** 사업이 있는 시·군·구(광역 단위 포함) 수 */
  readonly regionCount?: number;
  /** 제목에 낱말이 들어간 공개 보도자료 수 */
  readonly newsCount?: number;
  /** 최신 회계연도 사회복지 분야 세부사업 중 사업명에 낱말이 들어간 수 */
  readonly budgetCount?: number;
}

export interface MindmapSource {
  readonly generatedAt: string;
  readonly knowledge: { readonly dataAsOf: string; readonly completedAt: string };
  readonly services: {
    readonly total: number;
    readonly documents: number;
    readonly categories: readonly { readonly category: string; readonly subcategory: string; readonly count: number }[];
    readonly regions: readonly { readonly sido: string; readonly sigungu: string; readonly count: number }[];
    readonly targetGroups: readonly TargetGroupSource[];
    /** 대분류별 사업이 있는 시·군·구 수(관계성 지도 정보칸). 없으면 표시하지 않는다. */
    readonly categoryRegions?: readonly { readonly category: string; readonly regions: number }[];
  };
  readonly news: {
    readonly total: number;
    readonly categories: readonly { readonly code: string; readonly label: string; readonly count: number }[];
    /** 발행기관 관할 시·도별 공개 보도자료 수. */
    readonly bySido?: Readonly<Record<string, number>>;
  };
  readonly fiscal: {
    readonly entityTotal: number;
    readonly regions: readonly { readonly code: string; readonly name: string; readonly count: number }[];
    readonly integratedCare: readonly { readonly basis: string; readonly count: number }[];
  };
  readonly ontology: {
    readonly entities: readonly { readonly id: string; readonly status: string; readonly note?: string }[];
    readonly relations: readonly { readonly id: string; readonly domain: string; readonly range: string; readonly status: string }[];
  };
}

/** 마디 id에 쓰는 안전한 조각 */
function key(...parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function query(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  return search ? path + "?" + search : path;
}


const sum = (nodes: readonly { readonly count?: number }[]) => nodes.reduce((total, node) => total + (node.count ?? 0), 0);

/** 복지 마인드맵 구조의 개체 유형 한글 이름(스키마 id → 화면 이름). */
export const ENTITY_LABELS: Readonly<Record<string, string>> = {
  ProgramImplementation: "통합돌봄 시행사업", Region: "지역", ServiceType: "서비스 분류", Organization: "기관",
  FiscalEntity: "재정주체(자치단체)", FiscalDepartment: "예산 부서", FiscalProject: "예산 세부사업", FiscalObservation: "예산·지출 수치",
  BudgetDocument: "예산서", BudgetRevision: "예산 변경(추경)", BudgetLine: "예산서 항목", FundingSource: "재원", FundingComponent: "재원 구성",
  NewsArticle: "언론 기사", NewsPublisher: "언론사", NewsCategory: "복지뉴스 분야", OfficialPublication: "공식 발간물", PressRelease: "보도자료",
  RegionCode: "지역 코드", StatisticalTable: "통계표", StatisticalObservation: "통계 수치", CareProvider: "장기요양기관",
  CareServiceType: "장기요양 기관 유형", PublicBenefitService: "정부24 공공서비스", LegalProvision: "법령 조문",
};

/** 복지 마인드맵 구조의 관계 한글 이름. */
export const RELATION_LABELS: Readonly<Record<string, string>> = {
  located_in: "소재 지역", classified_as: "서비스 분류", fiscalProjectFor: "예산 세부사업 연결", observesFiscalProject: "세부사업 예산·지출 수치",
  reportedByFiscalEntity: "공시 재정주체", assignedToFiscalDepartment: "담당 예산 부서", documentedInBudget: "예산서 수록", hasFundingComponent: "재원 구성",
  mentionsInTitle: "제목 속 언급", "classifiedAs(news)": "복지뉴스 분야 분류", issuedBy: "발행 기관", repostedBy: "재게시 기관",
  "reposts/corrects/withdraws": "재게시·정정·철회", has_jurisdiction: "관할 지역", part_of: "상위 지역·기관", codeMapsTo: "코드 대응",
  observesRegion: "지역 통계 수치", providerLocatedIn: "기관 소재지", providesCareService: "제공 기관 유형", hasAgreementWith: "협약 기관",
  sameProgramAs: "같은 사업 대응", legalBasis: "법적 근거",
};

const STATUS_LABELS: Readonly<Record<string, string>> = { IMPLEMENTED: "구현", PARTIAL: "일부 구현", NOT_IMPLEMENTED: "미구현", NOT_COLLECTED: "미수집" };

/** "Region|Organization"처럼 여러 개체를 묶은 값도 한글로 바꾼다. */
const entityLabel = (value: string) => value.split("|").map((part) => ENTITY_LABELS[part] ?? part).join(" 또는 ");

const BASIS_LABELS: Readonly<Record<string, string>> = { wiki_name_match: "WIKI 사업명 일치", name_keyword: "세부사업명에 「통합돌봄」 포함" };

/** 서버 집계로 만드는 가지들(통합돌봄 사업·대상자·지역·복지뉴스·복지예산·온톨로지 구조). */
export function buildServerBranches(source: MindmapSource): MindNode[] {
  const { services, news, fiscal, ontology } = source;
  const byCategory = new Map<string, { subcategory: string; count: number }[]>();
  for (const row of services.categories) {
    const list = byCategory.get(row.category) ?? [];
    list.push({ subcategory: row.subcategory, count: row.count });
    byCategory.set(row.category, list);
  }
  const categories: MindNode[] = orderServiceCategories([...byCategory.keys()]).map((category) => {
    const rows = byCategory.get(category) ?? [];
    const children = rows.map((row): MindNode => ({
      id: key("svc", category, row.subcategory || "(중분류 없음)"), label: row.subcategory || "중분류 없음", count: row.count, unit: "건",
      href: query("/", { category, subcategory: row.subcategory }), note: category + " 대분류의 중분류",
    }));
    return {
      id: key("svc", category), label: category, count: sum(rows), unit: "건", href: query("/", { category }), note: "중분류 " + rows.length + "개",
      children: [...children].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    };
  });

  const bySido = new Map<string, { sigungu: string; count: number }[]>();
  for (const row of services.regions) {
    const list = bySido.get(row.sido) ?? [];
    list.push({ sigungu: row.sigungu, count: row.count });
    bySido.set(row.sido, list);
  }
  const regions: MindNode[] = [...bySido].map(([sido, rows]) => {
    const local = rows.filter((row) => row.sigungu && row.sigungu !== sido);
    const children = local.map((row): MindNode => ({ id: key("region", sido, row.sigungu), label: row.sigungu, count: row.count, unit: "건", href: query("/", { sido, sigungu: row.sigungu }) }));
    const provinceWide = sum(rows.filter((row) => !row.sigungu || row.sigungu === sido));
    return {
      id: key("region", sido), label: sido, count: sum(rows), unit: "건", href: query("/", { sido }),
      note: (local.length ? "시·군·구 " + local.length + "곳" : "시·군·구 구분 없음") + (provinceWide ? " · 광역 단위 사업 " + provinceWide.toLocaleString("ko-KR") + "건" : ""),
      children: local.length ? [...children].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)) : undefined,
    };
  }).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const targets: MindNode[] = services.targetGroups.map((group) => ({
    id: key("target", group.id), label: group.label, count: group.count, unit: "건", href: query("/", { q: group.keywords[0] ?? group.label }),
    note: "지원대상·세부대상·사업명에 「" + group.keywords.join("」「") + "」가 들어간 사업(개인 자격 판정 아님)",
  })).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const newsNodes: MindNode[] = news.categories.map((row) => ({ id: key("news", row.code), label: row.label, count: row.count, unit: "건", href: query("/news", { category: row.code }) }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const fiscalRegions: MindNode[] = fiscal.regions.map((row) => ({ id: key("fiscal", row.code), label: row.name, count: row.count, unit: "곳", href: query("/budget", { mode: "social_welfare", region: row.code }), note: "현행 지방자치단체(광역 본청·기초) 수. 통합 전 광주·전남 본청은 세지 않음" }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const careNodes: MindNode[] = fiscal.integratedCare.map((row) => ({ id: key("fiscal", "care", row.basis), label: BASIS_LABELS[row.basis] ?? row.basis, count: row.count, unit: "건", href: query("/budget", { mode: "integrated_care" }) }));

  const entityNodes: MindNode[] = ontology.entities.map((entity) => ({ id: key("onto", "entity", entity.id), label: entityLabel(entity.id), note: (STATUS_LABELS[entity.status] ?? entity.status) + (entity.note ? " · " + entity.note : "") }));
  const relationNodes: MindNode[] = ontology.relations.map((relation) => ({ id: key("onto", "relation", relation.id), label: RELATION_LABELS[relation.id] ?? relation.id, note: entityLabel(relation.domain) + " → " + entityLabel(relation.range) + " · " + (STATUS_LABELS[relation.status] ?? relation.status) }));
  const implemented = ontology.entities.filter((entity) => entity.status === "IMPLEMENTED").length;

  return [
    {
      id: "svc", label: "통합돌봄 사업", count: services.total, unit: "건", href: "/",
      note: "보건복지부 통합돌봄 사업안내의 시행사업. 대분류 → 중분류", children: categories,
    },
    { id: "target", label: "대상자", count: targets.length, unit: "묶음", note: "공개 원문 문구로 묶은 대상자 묶음. 한 사업이 여러 묶음에 들 수 있습니다.", children: targets },
    { id: "region", label: "지역", count: regions.length, unit: "시·도", href: "/", note: "시행사업이 속한 지역. 시·도 → 시·군·구", children: regions },
    {
      id: "news", label: "복지뉴스", count: news.total, unit: "건", href: "/news",
      note: "공식 보도자료 공개 정보의 분야(제목 키워드 분류). 한 건이 여러 분야에 들 수 있습니다.", children: newsNodes,
    },
    {
      id: "fiscal", label: "복지예산", count: fiscal.entityTotal, unit: "자치단체", href: "/budget",
      note: "현행 지방자치단체 243곳(광역 16·기초 227)의 지방재정365 세출과 통합돌봄 분류 세부사업. 원천에 남아 있는 통합 전 광주·전남 본청 2곳은 세지 않습니다.",
      children: [
        { id: "fiscal/regions", label: "광역별 자치단체", count: fiscal.entityTotal, unit: "곳", href: "/budget", children: fiscalRegions },
        { id: "fiscal/care", label: "통합돌봄 예산 분류", count: sum(careNodes), unit: "건", href: query("/budget", { mode: "integrated_care" }), note: "세부사업 분류 근거별 건수(연도·기준일 구분 없이 분류 기록 수)", children: careNodes },
      ],
    },
    {
      id: "onto", label: "온톨로지 구조", count: ontology.entities.length, unit: "개체 유형", href: "/sources",
      note: "복지 마인드맵 구조 2판. 구현 " + implemented + "종, 관계 " + ontology.relations.length + "종",
      children: [
        { id: "onto/entities", label: "개체 유형", count: entityNodes.length, unit: "종", children: entityNodes },
        { id: "onto/relations", label: "관계", count: relationNodes.length, unit: "종", children: relationNodes },
      ],
    },
  ];
}

/** 복지제도100 색인 항목(화면에서 받은 index-lite)의 분류 필드만. */
export interface Welfare100Entry {
  readonly slug: string;
  readonly name: string;
  readonly org: string;
  readonly curated: boolean;
  readonly priority: number;
  readonly category: string;
  readonly lifecycle: readonly string[];
  readonly household: readonly string[];
}

/** 복지제도100 가지: 관심주제(대표 분류) → 주요 제도, 생애주기, 가구상황, 구분. */
export function buildWelfare100Branch(entries: readonly Welfare100Entry[], order: { topics: readonly string[]; lifecycle: readonly string[]; household: readonly string[] }): MindNode {
  const count = (pick: (entry: Welfare100Entry) => boolean) => entries.filter(pick).length;
  const topics: MindNode[] = order.topics.map((topic) => {
    const inTopic = entries.filter((entry) => entry.category === topic);
    const featured = inTopic.filter((entry) => entry.curated).sort((a, b) => a.priority - b.priority);
    return {
      id: key("w100", "topic", topic), label: topic, count: inTopic.length, unit: "개", href: query("/welfare100", { category: topic }),
      note: featured.length ? "주요 제도 " + inTopic.filter((entry) => entry.curated).length + "개" : undefined,
      children: featured.length ? featured.map((entry) => ({ id: key("w100", "item", entry.slug), label: entry.name, href: "/welfare100/" + encodeURIComponent(entry.slug), note: entry.org + " · 주요 제도" })) : undefined,
    };
  }).filter((node) => (node.count ?? 0) > 0);
  const lifecycle: MindNode[] = order.lifecycle.map((value) => ({ id: key("w100", "life", value), label: value, count: count((entry) => entry.lifecycle.includes(value)), unit: "개", href: query("/welfare100", { life: value }) }));
  const household: MindNode[] = order.household.map((value) => ({ id: key("w100", "household", value), label: value, count: count((entry) => entry.household.includes(value)), unit: "개", href: query("/welfare100", { household: value }) }));
  const scopes: MindNode[] = [
    { id: "w100/scope/curated", label: "주요 제도", count: count((entry) => entry.curated), unit: "개", href: query("/welfare100", { scope: "주요 제도" }) },
    { id: "w100/scope/central", label: "중앙부처", count: count((entry) => entry.org === "중앙부처"), unit: "개", href: query("/welfare100", { scope: "중앙부처" }) },
    { id: "w100/scope/local", label: "지자체", count: count((entry) => entry.org === "지자체"), unit: "개", href: query("/welfare100", { scope: "지자체" }) },
  ];
  return {
    id: "w100", label: "복지제도100", count: entries.length, unit: "개", href: "/welfare100",
    note: "복지로 중앙부처·지자체 복지서비스 대장. 생애주기·가구상황은 한 제도가 여러 값에 들 수 있습니다.",
    children: [
      { id: "w100/topics", label: "관심주제", count: entries.length, unit: "개", children: topics },
      { id: "w100/life", label: "생애주기", count: lifecycle.length, unit: "단계", children: lifecycle.filter((node) => (node.count ?? 0) > 0) },
      { id: "w100/household", label: "가구상황", count: household.length, unit: "유형", children: household.filter((node) => (node.count ?? 0) > 0) },
      { id: "w100/scope", label: "구분", count: scopes.length, unit: "구분", children: scopes },
    ],
  };
}

/** 마디 수(검증·화면 안내용). */
export function countNodes(node: MindNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

/**
 * 현행 지방자치단체 수(광역 16 + 기초 227 = 243). 지방재정365 재정주체 표에는 2026-07-01 전남광주통합특별시 설치로 폐지된
 * 광주본청(2900000)·전남본청(4600000)이 예산 단위로 남아 있어 그대로 세면 245가 된다. 두 본청은 세지 않고,
 * 광주·전남 지역코드에 남은 시·군·구(현행 기초자치단체)는 전남광주(1300000)로 묶는다.
 */
const ABOLISHED_METRO_CODES = "'2900000', '4600000'";
export const FISCAL_ENTITY_REGIONS_SQL =
  "SELECT CASE WHEN wa_code IN (" + ABOLISHED_METRO_CODES + ") THEN '1300000' ELSE wa_code END AS code, " +
  "MAX(CASE WHEN wa_code IN (" + ABOLISHED_METRO_CODES + ", '1300000') THEN '전남광주' ELSE wa_name END) AS name, COUNT(*) AS count " +
  "FROM fiscal_entity WHERE code NOT IN (" + ABOLISHED_METRO_CODES + ") GROUP BY 1";
