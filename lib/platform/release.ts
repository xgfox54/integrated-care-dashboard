// 공개 전달 형식 welfare-public-release-v2(작업지시서 v5 §24.5). 활성 통합 공개본 하나의 공개 가능한 자료만 묶는다.
// 뉴스는 허용 메타데이터만, 재정은 공개 snapshot의 관측만, 연결은 검토 완료만 넣고, 자료 종류별 검사기가 금지 필드를 막는다.
// ZIP은 무압축(stored) 형식으로 직접 쓴다(실행 코드·SQL을 넣지 않음).
import { serviceWikiKey } from "../dataset.ts";
import { projectDto, snapshotProjects } from "../fiscal/query.ts";
import { PRESS_FROM_JOINS, PUBLIC_PRESS_CLAUSES, RELATED_COLUMNS, toPressDto, type PressItemRow } from "../press/query.ts";
import { sha256Hex } from "../press/normalize.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { allDocumentFacts, documentEvidence, documentFactDto } from "../imports/public.ts";
import type { BundleRow } from "./bundle.ts";
import { zipStored } from "./zip-writer.ts";

export { crc32, zipStored } from "./zip-writer.ts";

export const RELEASE_FORMAT = "welfare-public-release-v2";
export const RELEASE_GENERATOR = "integrated-care-dashboard/release-v2.0.0";
const NEWS_ALLOWED = new Set([
  "schema_version", "article_id", "press_release_id", "source_kind", "document_kind", "title", "issued_by", "published_at", "published_date",
  "publication_precision", "discovered_at", "original_url", "publisher_region", "category_ids", "classification_basis", "content_scope",
  "source_registry_version", "related_group", "duplicate_group",
]);
const FORBIDDEN_ANYWHERE = /"(body|content_html|summary|snippet|excerpt|raw_ir|password|api_key|service_key|token|cookie|admin_note)"\s*:/i;

export interface ReleaseFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly records: number | null;
}

const encoder = new TextEncoder();
const jsonl = (rows: readonly unknown[]) => encoder.encode(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));

/** 자료 종류별 검사. 하나라도 어기면 묶음을 만들지 않는다. */
export function validateReleaseRecords(kind: "knowledge" | "fiscal" | "news" | "links", rows: readonly Record<string, unknown>[]): string[] {
  const problems: string[] = [];
  rows.forEach((row, index) => {
    if (FORBIDDEN_ANYWHERE.test(JSON.stringify(row))) problems.push(kind + "[" + index + "]: 금지 필드");
    if (kind === "news") {
      for (const key of Object.keys(row)) if (!NEWS_ALLOWED.has(key)) problems.push("news[" + index + "]: 허용되지 않은 필드 " + key);
      if (row.content_scope !== "metadata_only") problems.push("news[" + index + "]: metadata_only가 아님");
    }
    if (kind === "links" && row.verification_status !== "VERIFIED") problems.push("links[" + index + "]: 검토되지 않은 연결");
  });
  return problems;
}

async function knowledgeRows(db: SqlDatabase, runId: string) {
  const rows = (await db.prepare(
    "SELECT service_id AS serviceId, CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END AS sido, sigungu, category, subcategory, name, description, target, detail_target AS detailTarget, provider, type, detail_url AS detailUrl, updated_date AS updatedDate " +
      "FROM official_service_snapshot WHERE sync_run_id = ? ORDER BY sido, sigungu, name, service_id",
  ).bind(runId).all<Record<string, string>>()).results;
  return rows.map((row) => ({
    implementation_id: serviceWikiKey({ serviceId: row.serviceId, sido: row.sido, sigungu: row.sigungu, category: row.category, subcategory: row.subcategory, name: row.name }),
    name: row.name, sido: row.sido, sigungu: row.sigungu || null, category: row.category, subcategory: row.subcategory || null,
    description: row.description || null, target: row.target || null, detail_target: row.detailTarget || null, provider: row.provider || null, service_type: row.type || null,
    source: { kind: "MOHW_INTEGRATED_CARE_MENU", url: row.detailUrl || null, updated: row.updatedDate || null },
  }));
}

/** 활성 공개본으로 v2 묶음을 만든다. 금지 필드가 있으면 예외로 중단한다. */
export async function buildPublicRelease(db: SqlDatabase, bundle: BundleRow, nowSeconds: number): Promise<{ readonly zip: Uint8Array<ArrayBuffer>; readonly manifest: Record<string, unknown> }> {
  const components = JSON.parse(bundle.components_json) as Record<string, { status?: string; detail?: Record<string, unknown> } | undefined>;
  const runId = bundle.knowledge_snapshot_id ? bundle.knowledge_snapshot_id.slice(3) : null;
  const knowledge = runId ? await knowledgeRows(db, runId) : [];
  const snapshotIds = Array.isArray(components.fiscal?.detail?.snapshot_ids) ? (components.fiscal?.detail?.snapshot_ids as string[]) : [];
  const fiscal: Record<string, unknown>[] = [];
  for (const snapshotId of snapshotIds) {
    const status = await db.prepare("SELECT status FROM fiscal_snapshot WHERE snapshot_id = ?").bind(snapshotId).first<{ status: string }>();
    if (status?.status !== "PUBLISHED") continue;
    const { rows } = await snapshotProjects(db, snapshotId, {}, 0, 100_000);
    for (const row of rows) fiscal.push({ snapshot_id: snapshotId, ...projectDto(row) });
  }
  const watermark = typeof components.news?.detail?.discovered_watermark === "number" ? (components.news.detail.discovered_watermark as number) : 0;
  const pressRows = bundle.news_snapshot_id
    ? (await db.prepare(
      "SELECT i.item_id, i.title, i.canonical_url, i.published_date, i.published_at, i.publication_precision, i.discovered_at, i.categories, i.classification_basis, " +
        "o.organization_id AS org_id, o.name AS org_name, o.org_type, o.sido AS org_sido, o.sigungu AS org_sigungu, s.registry_version, " + RELATED_COLUMNS + " " +
        PRESS_FROM_JOINS + " WHERE " + PUBLIC_PRESS_CLAUSES.join(" AND ") + " AND i.discovered_at <= ? ORDER BY i.published_date DESC, i.item_id",
    ).bind(watermark).all<PressItemRow>()).results
    : [];
  const news = pressRows.map((row) => toPressDto(row) as unknown as Record<string, unknown>);
  const pairs = components.documents?.detail?.pairs;
  const documentRows = Array.isArray(pairs) && pairs.length ? await allDocumentFacts(db, pairs.filter((pair): pair is string => typeof pair === "string"), runId, 10_000) : [];
  const documentProofs = await documentEvidence(db, documentRows);
  const documents = documentRows.map((row) => ({ subject_id: row.subject_id, subject_label: row.subject_label, subject_sido: row.subject_sido, subject_sigungu: row.subject_sigungu, ...documentFactDto(row, documentProofs.get(row.import_id + "|" + row.statement_id) ?? []) }));
  const links = (await db.prepare("SELECT link_id, source_type, source_id, target_type, target_id, relation, mapping_version, verification_status, candidate_basis, reviewed_at FROM cross_domain_link WHERE verification_status = 'VERIFIED' AND public_status = 'PUBLIC' ORDER BY link_id").all<Record<string, unknown>>()).results;
  const problems = [
    ...validateReleaseRecords("knowledge", knowledge),
    ...validateReleaseRecords("knowledge", documents),
    ...validateReleaseRecords("fiscal", fiscal),
    ...validateReleaseRecords("news", news),
    ...validateReleaseRecords("links", links),
  ];
  if (problems.length) throw new Error("공개 묶음 검사 실패: " + problems.slice(0, 5).join("; "));
  const quality = {
    release_bundle_id: bundle.bundle_id,
    compatibility: JSON.parse(bundle.compatibility_report) as unknown,
    counts: { knowledge: knowledge.length, document_facts: documents.length, fiscal: fiscal.length, news: news.length, links: links.length },
    notes: [
      "knowledge: 보건복지부 통합돌봄 사업안내 수록 시행사업(지역 자체사업 전체가 아님)",
      "knowledge/document_facts: 관리자가 승인·활성화한 HWP/HWPX 문서 사실과 근거 위치(파싱 구조 기준, 인쇄 쪽수 미확인)",
      "fiscal: 지방재정365 세부사업별 세출현황 공개값(단위 원. 공식 화면과 대조한 snapshot은 VERIFIED_OFFICIAL_SCREEN, 나머지는 UNVERIFIED_IN_SCOPE)",
      "news: 공식 보도자료 메타데이터만(본문·요약 없음)",
      "links: 관리자가 검토한 사업–재정사업 연결만(금액 배분 없음)",
    ],
  };
  const readme = [
    "# " + RELEASE_FORMAT,
    "",
    "전국 통합돌봄 대시보드의 공개 자료 묶음입니다. 통합 공개본 " + bundle.bundle_id + " 기준입니다.",
    "data/knowledge: 시행사업 카드, data/fiscal: 재정 관측, data/news: 보도자료 메타데이터, data/links: 검토된 연결, quality/report.json: 검증 요약.",
    "자료마다 출처와 기준일이 다르며 하나의 최신 날짜로 합치지 않습니다. 이 묶음에는 실행 코드·SQL이 없습니다.",
    "",
  ].join("\n");
  const files: ReleaseFile[] = [
    { path: "data/knowledge/implementations.jsonl", bytes: jsonl(knowledge), records: knowledge.length },
    { path: "data/knowledge/document_facts.jsonl", bytes: jsonl(documents), records: documents.length },
    { path: "data/fiscal/observations.jsonl", bytes: jsonl(fiscal), records: fiscal.length },
    { path: "data/news/press_releases.jsonl", bytes: jsonl(news), records: news.length },
    { path: "data/links/links.jsonl", bytes: jsonl(links), records: links.length },
    { path: "quality/report.json", bytes: encoder.encode(JSON.stringify(quality, null, 2)), records: null },
    { path: "README.md", bytes: encoder.encode(readme), records: null },
  ];
  const declared = await Promise.all(files.map(async (file) => ({
    path: file.path, size: file.bytes.length, records: file.records,
    sha256: await sha256Hex(new TextDecoder().decode(file.bytes)),
  })));
  const manifest = {
    format: RELEASE_FORMAT,
    artifact_id: "rel_" + bundle.bundle_id.slice(3) + "_" + nowSeconds,
    generator: RELEASE_GENERATOR,
    created_at: new Date(nowSeconds * 1000).toISOString(),
    release_bundle_id: bundle.bundle_id,
    bundle_schema_version: bundle.bundle_schema_version,
    components: { knowledge_snapshot_id: bundle.knowledge_snapshot_id, fiscal_snapshot_id: bundle.fiscal_snapshot_id, news_snapshot_id: bundle.news_snapshot_id, link_snapshot_id: bundle.link_snapshot_id, document_snapshot_id: (components.documents as { id?: string | null } | undefined)?.id ?? null },
    modules_present: ["knowledge", "fiscal", "news", "links"].filter((module) => files.find((file) => file.path.startsWith("data/" + module + "/"))?.records),
    domains: {
      knowledge: { schema_version: "welfare-knowledge-card-1", publication_scope: "public", snapshot_mode: "self_contained" },
      fiscal: { schema_version: "fiscal-observation-1", publication_scope: "public", snapshot_mode: "self_contained" },
      news: { schema_version: "2.1", publication_scope: "public_metadata_only", snapshot_mode: "self_contained", source_registry_version: components.news?.detail?.registry_version ?? null },
      links: { schema_version: "cross-domain-link-1", publication_scope: "public_verified_only", snapshot_mode: "self_contained" },
    },
    files: declared,
  };
  const zip = zipStored([{ path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }, ...files]);
  return { zip, manifest };
}

