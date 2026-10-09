// 복지정보 관계성 지도 View Model(2026-10-06 작업지시서): 원본 집계(MindmapSource)와 기존 나무(buildServerBranches·buildWelfare100Branch)를
// 바꾸지 않고, 탐색 기준 6개(대상자·서비스·지역·복지제도·예산·뉴스)와 고급 탐색(온톨로지)으로 다시 묶는다.
// 화면은 이 구조만 그린다. 수는 모두 원본 집계에서 그대로 가져오며 임의 숫자를 넣지 않는다.
import { buildServerBranches, type MindmapSource, type MindNode, type Welfare100Entry } from "./mindmap.ts";
import { REGION_DEFINITIONS } from "./region-statistics.ts";
import { targetGroupSlug, textsMatchTarget } from "./target-groups.ts";

/** 색 계열: care(통합돌봄·서비스·지역 #0173bc), people(대상자·복지제도 #00a074), data(뉴스·예산·자료 #f18101), advanced(고급 탐색). */
export type ExploreFamily = "root" | "care" | "people" | "data" | "advanced";
export type ExploreIcon = "root" | "target" | "service" | "region" | "welfare" | "budget" | "news" | "advanced" | "item";

export interface RelatedItem {
  readonly key: "services" | "welfare" | "regions" | "news" | "budget" | "entities";
  readonly label: string;
  readonly count: number;
  readonly unit: string;
  readonly href?: string;
}

export interface ExploreLink {
  readonly label: string;
  readonly href: string;
}

export interface ExploreNode {
  /** 주소(?node=)에 쓰는 안정적인 ID. 화면 이름 대신 영문 slug·원천 코드를 쓴다. */
  readonly id: string;
  readonly label: string;
  readonly family: ExploreFamily;
  readonly icon: ExploreIcon;
  readonly count?: number;
  readonly unit?: string;
  readonly note?: string;
  /** 더블클릭·「상세 보기」로 갈 실제 자료 화면 */
  readonly href?: string;
  readonly children?: readonly ExploreNode[];
  /** 정보칸 「관련 자료」(수가 0이거나 없으면 화면에서 숨긴다) */
  readonly related?: readonly RelatedItem[];
  /** 정보칸 「주요 연관 분야」 */
  readonly topics?: readonly string[];
  /** 정보칸 바로가기 단추 */
  readonly links?: readonly ExploreLink[];
  /** 검색 동의어(대상자 낱말 등) */
  readonly keywords?: readonly string[];
}

export const ROOT_LABEL = "복지정보 관계성 지도";
export const TOP_IDS = ["target", "service", "region", "welfare", "budget", "news"] as const;
export const ADVANCED_ID = "advanced";

function query(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  return (search ? path + "?" + search : path) + (path === "/" ? "#search-results" : "");
}

const sum = (nodes: readonly { readonly count?: number }[]) => nodes.reduce((total, node) => total + (node.count ?? 0), 0);

/** 기존 나무 마디를 탐색 마디로 옮긴다(ID·수·주소·설명은 그대로). */
function convert(node: MindNode, family: ExploreFamily, icon: ExploreIcon, related?: (node: MindNode) => readonly RelatedItem[] | undefined): ExploreNode {
  if (node.href === "/" || node.href?.startsWith("/?")) node = { ...node, href: node.href + "#search-results" };
  const children = node.children?.map((child) => convert(child, family, "item", related));
  const extra = related?.(node);
  return {
    id: node.id, label: node.label, family, icon, count: node.count, unit: node.unit, note: node.note, href: node.href,
    ...(children?.length ? { children } : {}),
    ...(extra?.length ? { related: extra } : node.count !== undefined && node.href ? { related: [{ key: "services" as const, label: "관련 자료", count: node.count, unit: node.unit ?? "", href: node.href }] } : {}),
    ...(node.href ? { links: [{ label: "자료 화면 보기", href: node.href }] } : {}),
  };
}

/** 복지제도100 제도명에 대상자 묶음 낱말이 들어간 제도 수. 복지제도100 화면의 target_group 필터와 같은 판정(lib/target-groups.ts). */
function welfareMatches(entries: readonly Welfare100Entry[] | null, groupId: string): number | undefined {
  if (!entries) return undefined;
  const slug = targetGroupSlug(groupId);
  return entries.filter((entry) => textsMatchTarget(slug, [entry.name])).length;
}

/** 시·도 이름으로 지방재정365 재정주체 지역(광역 코드)을 찾는다. */
function fiscalRegionFor(source: MindmapSource, sido: string) {
  const definition = REGION_DEFINITIONS.find((region) => region.fullName === sido || (region.aliases as readonly string[]).includes(sido));
  const names = definition ? [definition.fullName, definition.shortLabel, ...definition.aliases] : [sido];
  return source.fiscal.regions.find((region) => names.includes(region.name) || (definition !== undefined && region.name.replace(/[·\s]/g, "") === definition.shortLabel.replace(/[·\s]/g, "")));
}

export interface ExploreInput {
  readonly source: MindmapSource;
  /** 복지제도100 가지(buildWelfare100Branch). 아직 못 받았으면 null. */
  readonly welfareBranch: MindNode | null;
  /** 복지제도100 색인(대상자별 관련 제도 수). 아직 못 받았으면 null. */
  readonly welfareEntries: readonly Welfare100Entry[] | null;
}

export function buildExploreTree({ source, welfareBranch, welfareEntries }: ExploreInput): ExploreNode {
  const branches = buildServerBranches(source);
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const pick = (id: string) => byId.get(id) as MindNode;
  const categoryRegions = new Map((source.services.categoryRegions ?? []).map((row) => [row.category, row.regions]));

  // 대상자별: 묶음 → (대분류별 관련 사업, 관련 복지제도)
  const targets: ExploreNode[] = source.services.targetGroups.map((group): ExploreNode => {
    const slug = group.id.replace(/^target:/, "").replace(/_/g, "-");
    const id = "target/" + slug;
    // 클릭 목록은 집계와 같은 대상자 묶음 조건(target_group)으로 연다. 첫 낱말(q)만 넘기면 「어르신」「65세」만 있는 사업이 빠졌다(D-04).
    const target = targetGroupSlug(group.id);
    const welfareCount = welfareMatches(welfareEntries, group.id);
    const byCategory = [...(group.byCategory ?? [])].filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
    const children: ExploreNode[] = byCategory.map((row) => ({
      id: id + "/svc/" + encodeURIComponent(row.category), label: row.category, family: "people", icon: "item", count: row.count, unit: "건",
      href: query("/", { target_group: target, category: row.category }), note: group.label + " 대상 낱말이 들어간 「" + row.category + "」 사업",
      related: [{ key: "services", label: "통합돌봄 사업", count: row.count, unit: "건", href: query("/", { target_group: target, category: row.category }) }],
      links: [{ label: "통합돌봄 사업 보기", href: query("/", { target_group: target, category: row.category }) }],
    }));
    if (welfareCount) {
      children.push({
        id: id + "/welfare", label: "관련 복지제도", family: "people", icon: "welfare", count: welfareCount, unit: "개", href: query("/welfare100", { target_group: target }),
        note: "복지제도100 이름에 「" + group.keywords.join("」「") + "」가 들어간 제도",
        related: [{ key: "welfare", label: "복지제도", count: welfareCount, unit: "개", href: query("/welfare100", { target_group: target }) }],
        links: [{ label: "복지제도 보기", href: query("/welfare100", { target_group: target }) }],
      });
    }
    const related: RelatedItem[] = [
      { key: "services", label: "통합돌봄 사업", count: group.count, unit: "건", href: query("/", { target_group: target }) },
      ...(welfareCount !== undefined ? [{ key: "welfare" as const, label: "복지제도", count: welfareCount, unit: "개", href: query("/welfare100", { target_group: target }) }] : []),
      ...(group.regionCount !== undefined ? [{ key: "regions" as const, label: "관련 지역(시·군·구)", count: group.regionCount, unit: "곳", href: query("/", { target_group: target }) }] : []),
      ...(group.newsCount !== undefined ? [{ key: "news" as const, label: "공식 보도자료", count: group.newsCount, unit: "건", href: query("/news", { target_group: target }) }] : []),
      ...(group.budgetCount !== undefined ? [{ key: "budget" as const, label: "관련 예산사업(사회복지)", count: group.budgetCount, unit: "건", href: query("/budget", { mode: "social_welfare", target_group: target }) }] : []),
    ];
    return {
      id, label: group.label, family: "people", icon: "target", count: group.count, unit: "건", href: query("/", { target_group: target }),
      note: "지원대상·세부대상·사업명에 「" + group.keywords.join("」「") + "」 중 하나가 들어간 사업(개인 자격 판정 아님). 바로가기도 같은 조건(대상자 묶음)으로 엽니다.",
      keywords: group.keywords, children, related, topics: byCategory.slice(0, 5).map((row) => row.category),
      links: [
        { label: "통합돌봄 사업 보기", href: query("/", { target_group: target }) },
        { label: "복지제도 보기", href: query("/welfare100", { target_group: target }) },
        { label: "지역별 보기", href: query("/", { target_group: target }) },
        { label: "관련 뉴스 보기", href: query("/news", { target_group: target }) },
        { label: "예산 보기", href: query("/budget", { mode: "social_welfare", target_group: target }) },
      ],
    };
  }).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  // 필요한 서비스별: 대분류 → 중분류
  const services = pick("svc").children?.map((category) => convert(category, "care", "service", (node) => {
    if (node.id.split("/").length !== 2) return undefined;
    const regions = categoryRegions.get(node.label);
    return [
      { key: "services", label: "통합돌봄 사업", count: node.count ?? 0, unit: "건", href: node.href },
      ...(regions !== undefined ? [{ key: "regions" as const, label: "시행 지역(시·군·구)", count: regions, unit: "곳", href: node.href }] : []),
    ];
  })) ?? [];

  // 지역별: 시·도 → 시·군·구
  const regions = pick("region").children?.map((sido): ExploreNode => {
    const fiscal = fiscalRegionFor(source, sido.label);
    const news = source.news.bySido?.[sido.label];
    const node = convert(sido, "care", "region");
    const related: RelatedItem[] = [
      { key: "services", label: "통합돌봄 사업", count: sido.count ?? 0, unit: "건", href: node.href },
      ...(sido.children?.length ? [{ key: "regions" as const, label: "시·군·구", count: sido.children.length, unit: "곳" }] : []),
      ...(news !== undefined ? [{ key: "news" as const, label: "공식 보도자료", count: news, unit: "건", href: query("/news", { sido: sido.label }) }] : []),
      ...(fiscal ? [{ key: "budget" as const, label: "복지예산 재정주체", count: fiscal.count, unit: "곳", href: query("/budget", { mode: "social_welfare", region: fiscal.code }) }] : []),
    ];
    return {
      ...node, related,
      links: [
        { label: sido.label + " 통합돌봄 사업 보기", href: node.href ?? query("/", {}) },
        ...(news !== undefined ? [{ label: "관련 뉴스 보기", href: query("/news", { sido: sido.label }) }] : []),
        ...(fiscal ? [{ label: "복지예산 보기", href: query("/budget", { mode: "social_welfare", region: fiscal.code }) }] : []),
      ],
    };
  }) ?? [];

  const welfare = welfareBranch ? convert(welfareBranch, "people", "welfare") : null;
  const fiscal = convert(pick("fiscal"), "data", "budget");
  const news = convert(pick("news"), "data", "news");
  const onto = pick("onto");

  const top: ExploreNode[] = [
    {
      id: "target", label: "대상자별", family: "people", icon: "target", count: targets.length, unit: "묶음", children: targets,
      note: "공개 원문 문구로 묶은 대상자. 한 사업이 여러 묶음에 들 수 있습니다.",
    },
    {
      id: "service", label: "필요한 서비스별", family: "care", icon: "service", count: source.services.total, unit: "건", href: query("/", {}), children: services,
      note: "보건복지부 통합돌봄 사업안내의 서비스 대분류 → 중분류",
      related: [{ key: "services", label: "통합돌봄 사업", count: source.services.total, unit: "건", href: query("/", {}) }],
      links: [{ label: "통합돌봄 사업 보기", href: query("/", {}) }],
    },
    {
      id: "region", label: "지역별", family: "care", icon: "region", count: regions.length, unit: "시·도", href: "/", children: regions,
      note: "통합돌봄 사업이 속한 지역. 시·도 → 시·군·구",
      related: [{ key: "services", label: "통합돌봄 사업", count: sum(regions), unit: "건", href: "/" }],
      links: [{ label: "지도로 보기(대시보드)", href: "/" }],
    },
    welfare
      ? { ...welfare, id: "welfare", label: "복지제도별", links: [{ label: "복지제도 보기", href: "/welfare100" }], related: [{ key: "welfare", label: "복지제도", count: welfare.count ?? 0, unit: "개", href: "/welfare100" }] }
      : { id: "welfare", label: "복지제도별", family: "people", icon: "welfare", href: "/welfare100", note: "복지제도 대장을 불러오는 중입니다." },
    { ...fiscal, id: "budget", label: "예산·현황", links: [{ label: "복지예산 보기", href: "/budget" }] },
    { ...news, id: "news", label: "뉴스·자료", links: [{ label: "복지뉴스 보기", href: "/news" }], related: [{ key: "news", label: "공식 보도자료", count: source.news.total, unit: "건", href: "/news" }] },
  ];
  // 복지제도100 가지의 하위 ID(w100/...)는 그대로 두고 맨 위만 welfare로 바꾼다.

  const advanced: ExploreNode = {
    id: ADVANCED_ID, label: "고급 탐색", family: "advanced", icon: "advanced",
    note: "대시보드 데이터가 어떤 항목과 관계로 연결되어 있는지 확인할 수 있는 데이터 구조 탐색 기능입니다.",
    children: [
      { id: "advanced/data", label: "데이터 관계도", family: "advanced", icon: "item", href: "/sources", note: onto.note, links: [{ label: "데이터 출처 보기", href: "/sources" }] },
      ...(onto.children ?? []).map((child) => convert({ ...child, label: child.id === "onto/relations" ? "관계 유형" : child.label }, "advanced", "item")),
    ],
  };

  return {
    id: "root", label: ROOT_LABEL, family: "root", icon: "root",
    note: "사업·대상자·지역·복지제도의 관계를 따라 필요한 정보를 찾아보세요.",
    children: [...top, advanced],
  };
}

/** 나무 전체 마디 수(검증·안내용). */
export function countExplore(node: ExploreNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countExplore(child), 0);
}

export function findExplorePath(root: ExploreNode, id: string): ExploreNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children ?? []) {
    const path = findExplorePath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}

// ---------- 검색(부분 일치·초성·동의어) ----------
const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

export function chosungOf(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0) - 0xac00;
    out += code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : char;
  }
  return out;
}

const isChosungQuery = (value: string) => /^[ㄱ-ㅎ]+$/.test(value);
const compact = (value: string) => value.replace(/[\s·・,()]/g, "").toLowerCase();

/** 흔한 다른 이름(동의어). 검색어를 이 이름으로도 찾는다. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  어르신: ["노인"], 고령자: ["노인"], 독거: ["1인 가구·독거"], 혼자: ["1인 가구·독거"], 보호자: ["가족돌봄자·보호자"], 간병: ["가족돌봄자·보호자"],
  기초수급: ["저소득"], 차상위: ["저소득"], 장애: ["장애인"], 퇴원: ["퇴원환자"], 청년: ["청소년·청년"], 어린이: ["아동"], 제주: ["제주특별자치도"],
};

export interface SearchHit {
  readonly node: ExploreNode;
  readonly path: readonly ExploreNode[];
  readonly score: number;
}

/** 검색: 이름 부분 일치(공백·가운뎃점 무시), 초성(ㅊㅁ → 치매), 동의어·대상자 낱말. 정확히 같을수록, 얕을수록 앞에 둔다. */
export function searchExplore(root: ExploreNode, raw: string, limit = 30): SearchHit[] {
  const term = compact(raw.trim());
  if (!term) return [];
  const terms = [term, ...(SYNONYMS[term] ?? []).map(compact)];
  const chosung = isChosungQuery(term);
  const hits: SearchHit[] = [];
  const walk = (node: ExploreNode, path: ExploreNode[]) => {
    const here = [...path, node];
    if (node.id !== "root") {
      const label = compact(node.label);
      let score = 0;
      for (const value of terms) {
        if (label === value) score = Math.max(score, 100);
        else if (label.startsWith(value)) score = Math.max(score, 70);
        else if (label.includes(value)) score = Math.max(score, 50);
      }
      if (chosung && compact(chosungOf(node.label)).includes(term)) score = Math.max(score, 45);
      if (!score && node.keywords?.some((keyword) => terms.some((value) => compact(keyword).includes(value) || value.includes(compact(keyword))))) score = 60;
      if (score) hits.push({ node, path: here, score: score - here.length * 2 + (node.family === "advanced" ? -20 : 0) });
    }
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(root, []);
  return hits.sort((a, b) => b.score - a.score || (b.node.count ?? 0) - (a.node.count ?? 0)).slice(0, limit);
}
