import { z } from 'zod';
import type { SqlDatabase } from '../sql-database.ts';
import { verifiedAmountSql } from '../fiscal/unit-check.ts';
import { faq129ClarificationCatalog } from './faq129-clarifications.ts';
import { faqReviewMetadata, sourceReviewRecords } from './source-review.ts';
import { reviewCompletions } from './review-completion.ts';
import pageInventory from '../../data/manual-original-page-inventory.json' with { type: 'json' };
import { fiscalMappings } from '../fiscal/query.ts';
import { manualTableReviewSummary } from '../manuals/table-verifications.ts';

import { ReviewQueueSchema, type ReviewQueue } from './review-queue-schema.ts';
export { ReviewQueueSchema } from './review-queue-schema.ts';
const FaqRow = z.object({ faq_id: z.string(), question: z.string(), content_sha256: z.string(), revision: z.string() });
const ManualRow = z.object({ document_id: z.string(), source_name: z.string(), corpus_revision: z.string(), parsed_sha256: z.string(), original_name: z.string().nullable(), original_sha256: z.string().nullable(), page_count: z.number().nullable(), official_url: z.string().nullable() });
const FiscalRow = z.object({ snapshot_id: z.string(), fiscal_year: z.string(), requested_reference_date: z.string(), scope_label: z.string(), unverified_rows: z.number() });

export async function readReviewQueue(db: SqlDatabase, now = new Date()): Promise<ReviewQueue> {
  const catalog = faq129ClarificationCatalog();
  const [checks, faqResult, manualResult, fiscalResult, mappings] = await Promise.all([
    sourceReviewRecords(db),
    db.prepare('SELECT faq_id, question, content_sha256, revision FROM faq_129 WHERE faq_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(catalog.map((item) => item.faq_id))).all(),
    db.prepare('SELECT d.document_id, d.source_name, d.corpus_revision, d.sha256 AS parsed_sha256, i.original_name, i.original_sha256, i.page_count, i.official_url FROM manual_document d LEFT JOIN manual_original_identity i ON i.parsed_sha256=d.sha256 WHERE d.corpus_revision = (SELECT revision FROM manual_active WHERE id = 1) ORDER BY d.source_name LIMIT 250').all(),
    db.prepare('SELECT s.snapshot_id, s.fiscal_year, s.requested_reference_date, sc.label AS scope_label, SUM(CASE WHEN ' + verifiedAmountSql('o') + ' THEN 0 ELSE 1 END) AS unverified_rows FROM fiscal_snapshot s JOIN fiscal_scope sc ON sc.scope_id=s.scope_id JOIN fiscal_snapshot_member m ON m.snapshot_id=s.snapshot_id JOIN fiscal_observation o ON o.observation_id=m.observation_id WHERE s.status=\'PUBLISHED\' GROUP BY s.snapshot_id HAVING unverified_rows > 0 ORDER BY s.requested_reference_date DESC LIMIT 250').all(),
    fiscalMappings(db),
  ]);
  const faqs = z.array(FaqRow).parse(faqResult.results);
  const manuals = z.array(ManualRow).parse(manualResult.results);
  const fiscal = z.array(FiscalRow).parse(fiscalResult.results);
  const history = await reviewCompletions(db);
  const items: ReviewQueue['items'] = await Promise.all(catalog.map(async ({ faq_id, clarification }) => {
    const row = faqs.find((candidate) => candidate.faq_id === faq_id);
    const metadata = await faqReviewMetadata(db, faq_id, row?.content_sha256 ?? '', now.toISOString().slice(0, 10));
    return { id: 'faq129:' + faq_id, kind: 'FAQ' as const, title: row?.question ?? 'FAQ 원문 적재 필요: ' + faq_id, revision: row?.revision ?? '', content_sha256: row?.content_sha256,
      status: metadata?.status ?? 'ORIGINAL_CHANGED',
      reviewed_at: clarification.reviewed_at, due_at: metadata?.review_due_at ?? clarification.review_due_at,
      gaps: [...clarification.remaining_uncertainties, '검수 범위: 보강 안내에 한정. FAQ 전체 현행 기준 검증 아님.',
        ...checks.filter(check => check.status === 'CHANGED' && clarification.sources.some(source => source.url === check.source_url))
          .map(check => '출처 변경 영향: ' + catalog.filter(entry => entry.clarification.sources.some(source => source.url === check.source_url)).map(entry => 'faq129:' + entry.faq_id).join(', ') + '. 관련 검색·상세·보강 안내를 재검토하세요.')], sources: [...clarification.sources] };
  }));
  items.push(...manuals.map((row) => ({ id: row.document_id, kind: 'MANUAL' as const, title: row.source_name, revision: row.corpus_revision, status: row.official_url ? 'PAGE_AND_IMAGE_CHECK_REQUIRED' : 'PROVENANCE_REQUIRED', reviewed_at: null, due_at: null,
    gaps: [row.original_name ? '보관 원본: ' + row.original_name + ' / SHA-256 ' + row.original_sha256 + ' / 전체 ' + (row.page_count ?? '미확인') + '쪽' : '보관 원본 식별 정보 미확인', ...(row.official_url ? ['공식 PDF 파일 해시 대조 일치. 절별 PDF 물리 쪽수·이미지 본문 대조 필요.'] : ['공식 원본 URL·절별 PDF 물리 쪽수·이미지 본문 대조 필요.']),
      ...manualTableReviewSummary(row.document_id, row.parsed_sha256, row.original_sha256), ...pageInventory.filter(item => item.original_sha256 === row.original_sha256).flatMap(item => [
        '보관 파일 재대조 ' + item.retained_hash_checked_at.slice(0, 10) + '. 이미지·저문자 원본 확인 후보 ' + item.ocr_candidate_pages.length + '쪽: ' + item.ocr_candidate_pages.slice(0, 30).join(', ') + (item.ocr_candidate_pages.length > 30 ? ' 외' : ''),
        ...(item.official_candidate ? ['추가 공식 PDF는 보관 파일과 해시 불일치. 두 원문의 내용·개정 차이를 검수해야 합니다. ' + item.official_candidate.url] : []),
      ])],
    sources: row.official_url ? [{ title: '공식 원본 PDF · 파일 해시 대조', url: row.official_url, location: '원본 전체 파일. 이 절의 물리 쪽수는 미확인.' }] : [] })));
  items.push(...fiscal.map((row) => ({ id: row.snapshot_id, kind: 'FISCAL' as const, title: row.scope_label + ' / ' + row.fiscal_year + ' / ' + row.requested_reference_date, revision: row.snapshot_id, status: 'AMOUNT_CHECK_REQUIRED', reviewed_at: null, due_at: null, gaps: ['공식 화면 금액·단위 대조 미확인 ' + row.unverified_rows + '행. 미검증 금액은 MCP에서 null 유지.'], sources: [{ title: '지방재정365 세부사업별 세출현황', url: 'https://www.lofin365.go.kr/lf/hub/QWGJK', location: row.requested_reference_date }] })));
  items.push(...mappings.filter(mapping => mapping.verification_status !== 'VERIFIED').slice(0, 250).map(mapping => ({
    id: mapping.mapping_id, kind: 'FISCAL' as const, title: '지역·재정주체 대조: ' + mapping.region_id,
    revision: mapping.fiscal_entity_id, status: 'AMOUNT_CHECK_REQUIRED', reviewed_at: null, due_at: null,
    gaps: ['지역별 금액을 제공하기 전 재정주체·부서 범위의 공식 대조가 필요합니다.', mapping.basis, '관계: ' + mapping.relation + ' / 상태: ' + mapping.verification_status, '확정 전 상위 자치단체 전체 금액으로 대체하지 않습니다.'],
    sources: [{ title: '지방재정365 공식 범위 대조', url: 'https://www.lofin365.go.kr/lf/hub/QWGJK', location: mapping.fiscal_entity_id + (mapping.fiscal_department_id ? ' / 부서 ' + mapping.fiscal_department_id : '') }],
  })));
  return ReviewQueueSchema.parse({ generated_at: now.toISOString(), items, source_checks: checks, review_history: history });
}
