import { z } from 'zod';
import type { SqlDatabase } from '../sql-database.ts';
import pageInventory from '../../data/manual-original-page-inventory.json' with { type: 'json' };
import { manualTableVerifications } from './table-verifications.ts';

const OriginalSchema = z.object({ original_name: z.string(), original_sha256: z.string().regex(/^[a-f0-9]{64}$/), format: z.string(), page_count: z.number().int().positive().nullable(), official_url: z.string().url().nullable(), official_hash_checked_at: z.string().nullable() });
export async function manualOriginalProvenance(db: SqlDatabase, revision: string, documentId: string, sectionId?: string) {
  const row = await db.prepare('SELECT i.original_name, i.original_sha256, i.format, i.page_count, i.official_url, i.official_hash_checked_at FROM manual_document d JOIN manual_original_identity i ON i.parsed_sha256=d.sha256 WHERE d.corpus_revision=? AND d.document_id=?').bind(revision, documentId).first();
  if (!row) return { status: 'ORIGINAL_IDENTITY_UNAVAILABLE', original: null, physical_section_page_verified: false, image_body_verified: false };
  const original = OriginalSchema.parse(row);
  const inventory = pageInventory.find(item => item.original_sha256 === original.original_sha256);
  const section = sectionId ? await db.prepare('SELECT s.content_hash, d.sha256 FROM manual_section s JOIN manual_document d ON d.document_id=s.document_id AND d.corpus_revision=s.corpus_revision WHERE s.corpus_revision=? AND s.document_id=? AND s.section_id=?').bind(revision, documentId, sectionId).first<{ content_hash: string; sha256: string }>() : null;
  const verifiedTables = section && sectionId ? manualTableVerifications(revision, documentId, section.sha256, original.original_sha256, sectionId, section.content_hash) : [];
  return { status: original.official_url ? 'OFFICIAL_FILE_HASH_MATCHED' : 'RETAINED_ORIGINAL_IDENTIFIED', original, hash_basis: 'retained_original_manifest_and_parsed_file_hash', physical_section_page_verified: false, image_body_verified: false,
    retained_original_hash_checked_at: inventory?.retained_hash_checked_at ?? null,
    page_inventory: inventory ? { total_physical_pages: inventory.page_count, ocr_candidate_pages: inventory.ocr_candidate_pages, verification: 'PARSER_PAGE_INVENTORY_ONLY', note: 'OCR 후보 쪽은 그림·저문자·경고 영역으로 원본 이미지 대조가 필요합니다. 후보가 없는 쪽도 검수 완료라는 뜻은 아닙니다.' } : null,
    official_candidate: inventory?.official_candidate ?? null,
    selected_table_facts_verified: verifiedTables.length > 0, selected_table_verifications: verifiedTables,
    note: '전체 쪽수는 원본 파일의 쪽수입니다. 이 절의 PDF 물리 쪽수와 이미지 본문 확인을 뜻하지 않습니다.' };
}
