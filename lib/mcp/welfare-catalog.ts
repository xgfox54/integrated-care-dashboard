import type { CatalogRow, PackedCatalogIndex } from '../welfare100/catalog-types.ts';
import type { WelfareItemPayload } from '../welfare100/payload.ts';
import { fingerprint, McpToolError } from './contract.ts';
import { manualReferenceEvidence, summarizeManualReferences } from '../welfare100/evidence-status.ts';
import { parseWelfareSearch, welfareSearchExpansions } from '../welfare100/search.ts';
import { matchesSearch, parseSearch, searchableText } from '../search-terms.ts';
import { compactSearchText } from './search-text.ts';
import { provisionReviewFor, recipientProvisionOf } from '../welfare100/provision-review.ts';
import { selectionFieldStatus } from '../welfare100/field-status.ts';
import { gov24FieldYearEvidence, welfareRelevance } from './gov24.ts';
import type { RefinedWelfareQuery } from './query-refiner.ts';

export const WELFARE_CATALOG_PREFIX = 'welfare100_service:';
export interface WelfareCatalogAssets { fetch(request: Request): Promise<Response> }
type Entry = Pick<CatalogRow, 's' | 'n' | 'o' | 'g' | 'a' | 'sd' | 'sg' | 'c' | 't' | 'l' | 'h' | 'pv'>;

export function regionalCatalogBrowse(plan: RefinedWelfareQuery): boolean {
  return Boolean(plan.region_id && plan.region_id !== 'region:전국' && !plan.search_tokens.length && !plan.programs.length && plan.fact_types.every(type => type === 'overview' || type === 'status_check'));
}

export class WelfareCatalog {
  private indexPromise: Promise<{ as_of: string; revision: string; rows: Entry[] }> | null = null;
  private readonly assets: WelfareCatalogAssets;
  constructor(assets: WelfareCatalogAssets) { this.assets = assets; }

  private async asset(path: string): Promise<unknown> {
    const response = await this.assets.fetch(new Request('https://welfare-catalog.invalid/data/welfare100/' + path));
    if (!response.ok) throw new McpToolError(response.status === 404 ? 'NOT_FOUND' : 'WELFARE_CATALOG_UNAVAILABLE', '복지제도100 저장 자료를 읽지 못했습니다.');
    return response.json();
  }

  private index() {
    this.indexPromise ??= this.asset('index-lite.json').then(value => {
      const index = value as PackedCatalogIndex;
      if (!Array.isArray(index.fields) || !Array.isArray(index.items) || typeof index.asOf !== 'string') throw new McpToolError('WELFARE_CATALOG_INVALID', '복지제도100 색인 형식을 확인할 수 없습니다.');
      const rows = index.items.map(values => Object.fromEntries(index.fields.map((key, i) => [key, values[i]])) as Entry);
      if (rows.some(row => typeof row.s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(row.s) || typeof row.n !== 'string' || typeof row.sd !== 'string' || typeof row.sg !== 'string')) throw new McpToolError('WELFARE_CATALOG_INVALID', '복지제도100 지역·사업 식별자가 올바르지 않습니다.');
      return { as_of: index.asOf, revision: 'welfare100:' + fingerprint(index), rows };
    }).catch(error => { this.indexPromise = null; throw error; });
    return this.indexPromise;
  }

  async search(plan: RefinedWelfareQuery, baseUrl: string, offset = 0, limit = 20) {
    const index = await this.index();
    const locationCandidates = new Map<string, string>();
    if (!plan.region_id) {
      for (const row of index.rows) {
        if (row.sg && plan.normalized_query.includes(row.sg)) locationCandidates.set(row.sd + '|' + row.sg, 'region:' + row.sd + '|' + row.sg);
      }
    }
    const resolvedRegion = plan.region_id ?? (locationCandidates.size === 1 ? locationCandidates.values().next().value : null);
    const [sido = '', sigungu = ''] = (resolvedRegion ?? '').replace(/^region:/, '').split('|');
    const question = compactSearchText(plan.normalized_query);
    const explicitOperators = /[|*&]|(?:^|\s)[!-]\S/.test(plan.raw_query);
    const titleMatch = (row: Entry) => !explicitOperators && compactSearchText(row.n).length >= 6 && question.includes(compactSearchText(row.n));
    const scoped = index.rows.filter(row => !sido || sido === '전국' || (row.g === 0 ? plan.include_ancestor_scope : row.sd === sido && (!sigungu || row.sg === sigungu || plan.include_ancestor_scope && !row.sg)));
    const searchQueries = explicitOperators ? [plan.raw_query] : plan.search_queries;
    const variants = searchQueries.map(query => ({ literal: parseSearch(query), expanded: parseWelfareSearch(query), expansions: welfareSearchExpansions(query) })).filter(value => value.expanded.terms.length);
    const textOf = (row: Entry) => searchableText([row.n, row.o, row.c, row.sd, row.sg, ...row.t, ...row.l, ...row.h]);
    const directMatch = (row: Entry) => variants.some(value => matchesSearch(textOf(row), value.literal, { ignoreRegion: row.g === 0 }));
    const matched = scoped.filter(row => {
      if (welfareRelevance(row.n, plan) <= -100) return false;
      if (titleMatch(row)) return true;
      if (!variants.length) return true;
      return variants.some(value => matchesSearch(textOf(row), value.expanded, { ignoreRegion: row.g === 0 }));
    });
    const scopeOrder = (row: Entry) => sigungu && row.sd === sido && row.sg === sigungu ? 0 : row.g === 1 ? 1 : 2;
    matched.sort((a, b) => Number(titleMatch(b)) - Number(titleMatch(a)) || scopeOrder(a) - scopeOrder(b) || Number(directMatch(b)) - Number(directMatch(a)) || welfareRelevance(b.n, plan) - welfareRelevance(a.n, plan) || a.n.localeCompare(b.n, 'ko') || a.s.localeCompare(b.s));
    return {
      as_of: index.as_of, revision: index.revision, total_count: matched.length, resolved_region_id: resolvedRegion,
      search_expansions: variants.flatMap(value => value.expansions),
      scope_counts: {
        central: matched.filter(row => row.g === 0).length,
        provincial: matched.filter(row => row.g === 1 && !row.sg).length,
        municipal: matched.filter(row => row.g === 1 && Boolean(row.sg)).length,
      },
      local_count: matched.filter(row => sido && row.sd === sido && (!sigungu || row.sg === sigungu)).length,
      next_offset: offset + limit < matched.length ? offset + limit : null,
      items: matched.slice(offset, offset + limit).map(row => ({
        id: WELFARE_CATALOG_PREFIX + row.s, name: row.n, summary: row.o,
        entity_type: 'welfare100_service' as const, content_scope: 'stored_welfare_catalog',
        region_id: row.g === 0 ? 'region:전국' : 'region:' + row.sd + (row.sg ? '|' + row.sg : ''),
        sido: row.sd, sigungu: row.sg, category: row.c, topics: row.t, lifecycle: row.l, household: row.h,
        recipient_provision: recipientProvisionOf(row.s, row.pv),
        match_kind: !variants.length ? 'BROWSE' : directMatch(row) ? 'QUERY_MATCH' : 'RELATED_TERM',
        match_note: '검색 일치는 동일 제도나 개인별 수급 자격의 판정이 아닙니다.',
        source_kind: row.a ? 'curated_manual_catalog' : 'bokjiro_catalog',
        url: baseUrl + '/welfare100/' + encodeURIComponent(row.s),
        rank: titleMatch(row) ? 180 : variants.length ? welfareRelevance(row.n, plan) : 120,
      })),
    };
  }

  async detail(id: string, baseUrl: string, requestedYear: number | null = null) {
    const slug = id.startsWith(WELFARE_CATALOG_PREFIX) ? id.slice(WELFARE_CATALOG_PREFIX.length) : '';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(slug)) throw new McpToolError('WELFARE_CATALOG_ID_INVALID', 'search가 반환한 welfare100_service: ID를 사용하세요.');
    const index = await this.index();
    if (!index.rows.some(row => row.s === slug)) throw new McpToolError('NOT_FOUND', '복지제도100 대장에 이 사업이 없습니다.');
    let canonical = slug;
    let payload = await this.asset('items/' + canonical + '.json') as WelfareItemPayload;
    for (let hop = 0; payload.kind === 'alias' && hop < 2; hop++) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(payload.slug)) throw new McpToolError('WELFARE_CATALOG_INVALID', '사업 별칭이 올바르지 않습니다.');
      canonical = payload.slug;
      payload = await this.asset('items/' + canonical + '.json') as WelfareItemPayload;
    }
    if (payload.kind !== 'auto' && payload.kind !== 'curated') throw new McpToolError('WELFARE_CATALOG_INVALID', '사업 상세 형식을 확인할 수 없습니다.');
    const entry = index.rows.find(row => row.s === canonical);
    if (!entry) throw new McpToolError('NOT_FOUND', '별칭 사업이 현재 대장에 없습니다.');
    const raw = payload.kind === 'auto' ? payload.raw : null;
    const record = payload.kind === 'curated' ? payload.record : null;
    const url = baseUrl + '/welfare100/' + encodeURIComponent(canonical);
    const sourceUrl = raw ? 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=' + encodeURIComponent(raw.id) + '&wlfareInfoReldBztpCd=' + (raw.org === '중앙부처' ? '01' : '02') : url;
    const source = { evidence_id: WELFARE_CATALOG_PREFIX + canonical, kind: raw ? 'BOKJIRO_CATALOG' : 'CURATED_MANUAL_CATALOG', title: entry.n, url: sourceUrl, catalog_url: url, catalog_as_of: index.as_of, source_modified_at: raw?.updatedAt ?? null };
    const fields = { target: raw?.target ?? record?.target ?? null, selection: raw?.selection ?? null, benefit: raw?.benefit ?? record?.benefit ?? null, apply_method: raw?.applyText ?? record?.apply ?? null, contact: raw?.contacts ?? record?.contact ?? null };
    const yearEvidence = gov24FieldYearEvidence([entry.n, fields.target, fields.selection, fields.benefit, fields.apply_method].filter(Boolean).join('\n'), requestedYear, raw?.updatedAt ?? null);
    const references = payload.kind === 'curated' ? payload.extra.talkRefs : raw?.talkRefs ?? [];
    const manualReferences = references.map(ref => ({ ...ref, ...manualReferenceEvidence(ref, entry.n) }));
    return {
      id: WELFARE_CATALOG_PREFIX + canonical, requested_id: id, entity_type: 'welfare100_service' as const, name: entry.n,
      summary: entry.o, region_id: entry.g === 0 ? 'region:전국' : 'region:' + entry.sd + (entry.sg ? '|' + entry.sg : ''),
      ...fields, as_of: index.as_of, revision: index.revision, url, source, year_evidence: yearEvidence,
      content_scope: raw ? 'stored_bokjiro_service_fields' : 'curated_manual_service_fields',
      manual_references: manualReferences,
      manual_link_summary: summarizeManualReferences(references, entry.n),
      field_status: { selection: selectionFieldStatus(fields.selection) },
      recipient_provision: recipientProvisionOf(canonical, entry.pv),
      source_provision: entry.pv,
      provision_review: provisionReviewFor(canonical),
      additional_sources: raw?.edit?.sources ?? [], personal_determination: false,
      warnings: ['복지제도100 웹과 같은 저장 자료입니다. 대장 기준일·원문 수정일은 적용연도 확인값이 아닙니다.', '신청기간·지원횟수·거주요건은 수록된 대상·선정기준·지원내용·신청방법에서 확인하세요. 본문에 없는 조건은 미확인으로 안내하고, 지급일을 신청마감일로 또는 금액 상한을 연간 지원횟수로 해석하지 마세요.', '정부24·시행사업과의 동일성이 검증된 연결은 아닙니다. 개인별 수급 자격을 판정하지 않습니다.',
        ...(manualReferences.some((ref) => ref.original) ? ['manual_references[].original은 원본 파일 이름, 원본 PDF의 쪽(파일 쪽 순서이며 인쇄 쪽 번호와 다를 수 있음)과 그 쪽 문장의 발췌입니다. line은 내부 합본 Markdown 줄 번호이므로 출처 위치로 인용하지 마세요.'] : [])],
    };
  }
}

const catalogs = new WeakMap<WelfareCatalogAssets, WelfareCatalog>();
export function welfareCatalogFor(assets: WelfareCatalogAssets): WelfareCatalog {
  let catalog = catalogs.get(assets);
  if (!catalog) { catalog = new WelfareCatalog(assets); catalogs.set(assets, catalog); }
  return catalog;
}

export function welfareCatalogText(detail: Awaited<ReturnType<WelfareCatalog['detail']>>): string {
  return [detail.name, detail.summary, '지역: ' + detail.region_id, '대상: ' + (detail.target ?? '미수록'), '선정기준: ' + (detail.selection ?? detail.field_status.selection.note), '지원내용: ' + (detail.benefit ?? '미수록'), '신청방법: ' + (detail.apply_method ?? '미수록'), '문의: ' + (typeof detail.contact === 'string' ? detail.contact : detail.contact?.map(row => row.name + ': ' + row.value).join(', ') ?? '미수록'), '대장 기준일: ' + detail.as_of, '출처: ' + detail.source.url, ...detail.warnings].join('\n');
}
