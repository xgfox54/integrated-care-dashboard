import catalog from '../../data/manual-table-verifications.json' with { type: 'json' };

export function manualTableVerifications(revision: string, documentId: string, parsedHash: string, originalHash: string, sectionId: string, sectionHash: string) {
  return catalog.filter(item => item.corpus_revision === revision && item.document_id === documentId && item.parsed_sha256 === parsedHash
    && item.original_sha256 === originalHash && item.section_id === sectionId && item.section_content_sha256 === sectionHash);
}

export function manualTableReviewSummary(documentId: string, revision: string, originalHash: string | null) {
  const records = catalog.filter(item => item.document_id === documentId && item.corpus_revision === revision && item.original_sha256 === originalHash);
  return records.length ? ['선별 표·각주 원본 이미지 대조 ' + records.length + '건: PDF 물리 ' + records.map(item => item.physical_page).join(', ') + '쪽. 검증한 사실과 해시가 일치하는 절에 한해 MCP 상세에 제공하며, 전체 절·전체 이미지 검수 완료는 아닙니다.'] : [];
}
