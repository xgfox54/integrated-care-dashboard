import type { ComponentState } from "../platform/bundle.ts";

export const MANUAL_CORPUS_SCHEMA = "manual-corpus-1" as const;
export const MANUAL_ASSET_PREFIX = "/__manual_corpus/";
export const MANUAL_SECTION_PREFIX = "manual:";
export const MANUAL_MAX_EXCERPT = 8_000;
export type ManualOriginalNameBasis = "explicit_original_file_marker" | "upstream_metadata" | "mixed_original_files";

/** Deployment code supplies this manifest; it is never accepted from an HTTP body or MCP input. */
export interface ManualCorpusManifest {
  readonly schema_version: typeof MANUAL_CORPUS_SCHEMA;
  readonly revision: string;
  readonly source_commit: string;
  readonly source_repository: string;
  readonly created_at: string;
  readonly document_count: number;
  readonly section_count: number;
  readonly batches: readonly ManualBatchDescriptor[];
}

export interface ManualBatchDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly documents: number;
  readonly sections: number;
}

/** Original metadata is retained as metadata, not an assertion of authority, eligibility or applicable year. */
export interface ManualDocumentInput {
  readonly document_id: string;
  readonly source_name: string;
  readonly source_path: string;
  readonly sha256: string;
  readonly byte_size: number;
  readonly document_year: string | null;
  readonly category: string;
  readonly document_type: string;
  readonly publisher: string;
  readonly edition: string;
  readonly effective_from: string;
  readonly effective_to: string;
  readonly topic: string;
  readonly authority: string;
  readonly source_role: string;
  readonly jurisdiction: string;
  readonly section_count: number;
}

export interface ManualSectionInput {
  readonly section_id: string;
  readonly document_id: string;
  readonly ordinal: number;
  readonly node_id: string;
  readonly title: string;
  readonly heading_path: string;
  readonly service_names: string;
  readonly original_name: string;
  readonly upstream_original_name: string;
  readonly original_name_basis: ManualOriginalNameBasis;
  readonly original_name_line: number | null;
  readonly start_line: number;
  readonly end_line: number;
  readonly content: string;
  readonly content_hash: string;
}

export interface ManualCorpusBatch {
  readonly schema_version: typeof MANUAL_CORPUS_SCHEMA;
  readonly revision: string;
  readonly batch_index: number;
  readonly documents: readonly ManualDocumentInput[];
  readonly sections: readonly ManualSectionInput[];
}

export type ManualAssetLoader = (path: string, signal?: AbortSignal) => Promise<Uint8Array>;

export interface ManualAdvanceOptions {
  /** Unix seconds. */
  readonly now?: () => number;
  readonly leaseSeconds?: number;
  readonly maxMillis?: number;
}

export interface ManualAdvanceResult {
  readonly revision: string;
  readonly status: "ACTIVE" | "ADVANCED" | "BUSY" | "RETRY_LATER" | "FAILED" | "SUPERSEDED";
  readonly next_batch: number;
  readonly batch_count: number;
  readonly error_code?: string;
}

export interface ManualCorpusSummary {
  readonly revision: string;
  readonly source_repository: string;
  readonly source_commit: string;
  readonly manifest_sha256: string;
  readonly document_count: number;
  readonly section_count: number;
  readonly activated_at: number | null;
}

export interface ManualCorpusProgress {
  readonly revision: string;
  readonly status: string;
  readonly next_batch: number;
  readonly batch_count: number;
  readonly document_count: number;
  readonly section_count: number;
  readonly expected_documents: number;
  readonly expected_sections: number;
  readonly last_error: string | null;
  readonly retry_after: number | null;
}

export interface ManualCorpusState {
  readonly active_revision: string | null;
  readonly active: ManualCorpusSummary | null;
  readonly ingestion: ManualCorpusProgress | null;
}

export type ManualComponent = ComponentState;

/** A RefinedWelfareQuery is structurally compatible. All terms remain query hints, never source facts. */
export interface ManualSearchQuery {
  readonly raw_query: string;
  readonly search_tokens: readonly string[];
  readonly search_queries?: readonly string[];
  readonly programs?: readonly string[];
  readonly detail_terms?: readonly string[];
  readonly subservices?: readonly string[];
  readonly excluded_programs?: readonly string[];
  readonly requested_years?: readonly number[];
  readonly excluded_years?: readonly number[];
  readonly year?: number | null;
  readonly year_source?: string;
  readonly region_id?: string | null;
  readonly include_ancestor_scope?: boolean;
}

export interface ManualSearchOptions {
  /** Undefined selects the active corpus; an empty string deliberately selects no corpus. */
  readonly revision?: string;
  readonly limit?: number;
}

export interface ManualSectionOptions extends ManualSearchOptions {
  /** Unicode code-point offset, not a byte offset or a physical page. */
  readonly offset?: number;
}

export interface ManualSourceCitation {
  readonly source_repository: string;
  readonly source_commit: string;
  readonly source_path: string;
  readonly url: string;
  readonly url_kind: "repository_parsed_copy";
  readonly official_url: null;
  readonly document_title: string;
  readonly original_name: string;
  readonly upstream_original_name: string;
  readonly original_name_basis: ManualOriginalNameBasis;
  readonly original_name_line: number | null;
  readonly document_year: string | null;
  readonly document_year_basis: "filename_inferred" | "unknown";
  readonly source_year: string | null;
  readonly source_year_basis: "filename_inferred" | "unknown";
  readonly source_year_origin: "original_name" | "document_name" | "unknown";
  readonly applicable_year: null;
  readonly publisher: string;
  readonly publisher_verified: false;
  readonly authority: string;
  readonly authority_verified: false;
  readonly source_role: string;
  readonly jurisdiction: string;
  readonly jurisdiction_verified: false;
  readonly location: {
    readonly basis: "parsed_markdown_lines";
    readonly start_line: number;
    readonly end_line: number;
    readonly heading_path: string;
    readonly physical_page: null;
    readonly physical_page_verified: false;
  };
  readonly content_sha256: string;
  readonly document_sha256: string;
}

export interface ManualSearchHit {
  readonly id: string;
  readonly entity_type: "manual_section";
  readonly content_scope: "parsed_manual_section";
  readonly revision: string;
  readonly section_id: string;
  readonly document_id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly score: number;
  /** 제목·이미지 자리표시·표 구분선을 뺀 본문 글자 수. */
  readonly body_chars?: number;
  /** 읽을 수 있는 본문 문장이 없으면 false(표·이미지 전용 또는 제목만 있는 구간). */
  readonly body_available?: boolean;
  /** 빈 본문 구간 바로 다음의 본문 구간을 이어 붙였을 때, 원래 구간 ID. */
  readonly continued_from?: string;
  readonly sources: readonly [ManualSourceCitation];
  readonly warnings: readonly string[];
}

export interface ManualSectionDetail extends Omit<ManualSearchHit, "excerpt" | "score"> {
  readonly text: string;
  readonly offset: number;
  readonly returned_chars: number;
  readonly total_chars: number;
  readonly next_offset: number | null;
  readonly truncated: boolean;
  readonly image_content_available: false;
}
