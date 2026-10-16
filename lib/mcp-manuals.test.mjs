import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import clarificationCatalog from "../data/manual-source-clarifications.json" with { type: "json" };
import { createHash } from "node:crypto";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { MCP_SERVER_VERSION } from "./mcp/contract.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { advanceManualCorpus } from "./manuals/store.ts";
import { ensureActiveBundle } from "./platform/bundle.ts";

const hash = (text) => createHash("sha256").update(text).digest("hex");

function fixturePack() {
  const revision = "manual-http-fixture-v1";
  const contents = [
    "## 원본 파일: 2025년 기초연금 질의응답.md\n기초연금 배우자 소득 확인 서류를 안내하는 시험 원문입니다.\n📌 본문을 그대로 보존합니다.\n",
    "## 원본 파일: 2026년 기초연금 사업안내.md\n기초연금 신청방법과 제출서류는 이 시험 본문에서 확인합니다.\n",
  ];
  const doc = {
    document_id: "doc-http-test", source_name: "2026년 기초연금 합본.md", source_path: "source-md/2026년 기초연금 합본.md",
    sha256: hash(contents.join("")), byte_size: Buffer.byteLength(contents.join("")), document_year: "2026", category: "시험",
    document_type: "manual", publisher: "원천 기본값", edition: "", effective_from: "", effective_to: "", topic: "기초연금",
    authority: "primary", source_role: "operational_manual", jurisdiction: "national", section_count: 2,
  };
  const sections = contents.map((content, index) => ({
    section_id: "section-http-" + index, document_id: doc.document_id, ordinal: index + 1, node_id: "node-" + index,
    title: index ? "기초연금 신청방법 제출서류" : "기초연금 배우자 소득 확인",
    heading_path: "기초연금 > 신청방법", service_names: "기초연금",
    original_name: index ? "2026년 기초연금 사업안내.md" : "2025년 기초연금 질의응답.md",
    upstream_original_name: doc.source_name, original_name_basis: "explicit_original_file_marker", original_name_line: index ? 4 : 1,
    start_line: index ? 4 : 1, end_line: index ? 5 : 3, content, content_hash: hash(content),
  }));
  const payloads = [[doc], []].map((documents, index) => ({ schema_version: "manual-corpus-1", revision, batch_index: index, documents, sections: index ? sections : [] }));
  const assets = new Map(payloads.map((batch, index) => ["/__manual_corpus/" + revision + "/batch-" + index + ".json", Buffer.from(JSON.stringify(batch))]));
  const manifest = {
    schema_version: "manual-corpus-1", revision, source_repository: "https://gitlab.aigov.go.kr/memory365/seoguipowelfare",
    source_commit: "bdef4e9c16095327302f59b85045267ce9c39e17", created_at: new Date(NOW * 1000).toISOString(), document_count: 1, section_count: 2,
    batches: [...assets].map(([path, bytes], index) => ({ path, sha256: hash(bytes), bytes: bytes.length, documents: index ? 0 : 1, sections: index ? 2 : 0 })),
  };
  return { manifest, assets, sections, loader: async (path) => new Uint8Array(assets.get(path)) };
}

async function call(db, name, args = {}) {
  const response = await handleMcpRequest(new Request("https://welfare.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), (error) => { throw error; }, { includeLaw: false });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
}

test("MCP 매뉴얼은 staging을 노출하지 않고 완료 corpus도 통합 공개본에 포함된 뒤 읽는다", async () => {
  const db = database();
  try {
    db.sqlite.prepare("INSERT INTO official_sync_run(id,trigger,status,started_at,completed_at) VALUES ('manual-http-run','manual','succeeded',?,?)").run(NOW - 1, NOW);
    const before = await ensureActiveBundle(db, NOW);
    const { manifest, loader } = fixturePack();
    const id = "manual:" + manifest.revision + ":section-http-0";
    await advanceManualCorpus(db, loader, manifest, { now: () => NOW });
    assert.equal((await call(db, "fetch", { id })).isError, true);
    await advanceManualCorpus(db, loader, manifest, { now: () => NOW });
    assert.equal((await call(db, "search_manuals", { query: "기초연금 신청방법" })).structuredContent.data.results.length, 0);
    assert.equal((await advanceManualCorpus(db, loader, manifest, { now: () => NOW })).status, "ACTIVE");
    assert.equal((await call(db, "fetch", { id })).isError, true, "완료했어도 기존 공개본에는 매뉴얼이 없다");
    const after = await ensureActiveBundle(db, NOW + 1);
    assert.notEqual(after.bundle.bundle_id, before.bundle.bundle_id, "manual revision이 공개본 ID에 반영되어야 한다");
    const fetched = (await call(db, "fetch", { id })).structuredContent;
    assert.equal(fetched.metadata.entity_type, "manual_section");
    assert.equal(fetched.metadata.manual_revision, manifest.revision);
    assert.equal(fetched.metadata.server_version, MCP_SERVER_VERSION);
    assert.equal(fetched.metadata.answer_context.section_complete, true);
    assert.equal(fetched.metadata.answer_context.context_complete, false);
    const conditionLine = fetched.text.split('\n').find(line => line.startsWith('MANUAL_CONDITION_EVIDENCE '));
    const conditionEvidence = JSON.parse(conditionLine.slice('MANUAL_CONDITION_EVIDENCE '.length));
    assert.equal(conditionEvidence.source_content_sha256, fetched.metadata.answer_context.source_content_sha256);
    assert.equal(conditionEvidence.section_complete, fetched.metadata.answer_context.section_complete);
    assert.equal(conditionEvidence.context_complete, false);
    assert.match(fetched.metadata.answer_composition_instructions, /신청자와 대리인의 서류/);
    assert.ok(fetched.text.includes(fetched.metadata.answer_composition_instructions));
    assert.match(fetched.text, /📌 본문을 그대로 보존합니다/);
    const source = fetched.metadata.sources[0];
    assert.equal(source.document_year, "2026");
    assert.equal(source.source_year, "2025");
    assert.equal(source.source_year_basis, "filename_inferred");
    assert.equal(source.applicable_year, null);
    assert.equal(source.authority_verified, false);
    assert.equal(source.location.physical_page, null);
    assert.equal(source.location.physical_page_verified, false);
    assert.equal(source.upstream_original_name, "2026년 기초연금 합본.md");
    assert.equal(source.original_name_line, 1);
    assert.ok(source.url.includes(manifest.source_commit));
    const sources = (await call(db, "get_sources", { subject_type: "manual_section", subject_id: id })).structuredContent;
    assert.deepEqual(sources.data, fetched.metadata.sources);
    const entity = (await call(db, "get_entity", { entity_id: id })).structuredContent;
    assert.equal(entity.data.entity_type, "manual_section");
    const status = (await call(db, "get_dataset_status")).structuredContent;
    assert.equal(status.components.manuals, "manuals:" + manifest.revision);
    assert.equal(status.data.manuals.document_count, 1);
    assert.equal(status.data.manuals.section_count, 2);
  } finally { db.sqlite.close(); }
});

test("통합 검색에 매뉴얼이 연결되고 구간 이어읽기는 같은 원문을 Unicode 문자 단위로 반환한다", async () => {
  const db = database();
  try {
    const { manifest, loader, sections } = fixturePack();
    for (let index = 0; index < 3; index++) await advanceManualCorpus(db, loader, manifest, { now: () => NOW });
    const search = (await call(db, "search", { query: "기초연금 신청방법과 제출서류" })).structuredContent;
    assert.equal(search.manual_revision, manifest.revision);
    assert.ok(search.results.some((hit) => hit.entity_type === "manual_section"));
    assert.equal(search.retrieval_status, "CANDIDATES_FOUND");
    const id = "manual:" + manifest.revision + ":section-http-0";
    let offset = 0, collected = "";
    do {
      const response = (await call(db, "get_manual_section", { section_id: id, offset, limit: 17 })).structuredContent;
      const page = response.data;
      assert.equal(response.coverage.complete, false);
      assert.equal(page.answer_context.section_complete, false);
      assert.equal(page.answer_context.source_content_sha256, page.sources[0].content_sha256);
      assert.ok(page.returned_chars <= 17);
      collected += page.text;
      offset = page.next_offset;
    } while (offset !== null);
    assert.equal(collected, sections[0].content);
    const invalid = await call(db, "get_manual_section", { section_id: "https://example.com/private" });
    assert.equal(invalid.isError, true);
  } finally { db.sqlite.close(); }
});


test("원문의 사용기간 충돌과 공식 보충근거는 세 MCP 상세 경로에 함께 전달된다", async () => {
  const db = database();
  try {
    const record = clarificationCatalog[0];
    const assetDirectory = new URL('../data/manual-corpus/assets/__manual_corpus/' + record.corpus_revision + '/', import.meta.url);
    const packs = readdirSync(assetDirectory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(new URL(name, assetDirectory), 'utf8')));
    const document = packs.flatMap(pack => pack.documents).find(doc => doc.document_id === record.document_id);
    const sections = packs.flatMap(pack => pack.sections).filter(section => record.sections.some(expected => expected.section_id === section.section_id));
    const bytes = Buffer.from(JSON.stringify({ schema_version: 'manual-corpus-1', revision: record.corpus_revision, batch_index: 0, documents: [{ ...document, section_count: sections.length }], sections }));
    const manifest = { schema_version: 'manual-corpus-1', revision: record.corpus_revision, source_repository: 'https://gitlab.aigov.go.kr/memory365/seoguipowelfare', source_commit: 'bdef4e9c16095327302f59b85045267ce9c39e17', created_at: new Date(NOW * 1000).toISOString(), document_count: 1, section_count: sections.length, batches: [{ path: '/__manual_corpus/' + record.corpus_revision + '/batch-0.json', sha256: hash(bytes), bytes: bytes.length, documents: 1, sections: sections.length }] };
    for (let i = 0; i < 2; i++) await advanceManualCorpus(db, async () => new Uint8Array(bytes), manifest, { now: () => NOW });
    await ensureActiveBundle(db, NOW + 1);
    const sectionId = 'manual:' + record.corpus_revision + ':010c438f03fd793ea33e';
    for (const [tool, args] of [['get_manual_section', { section_id: sectionId }], ['get_entity', { entity_id: sectionId }]]) {
      const response = await call(db, tool, args);
      assert.notEqual(response.isError, true);
      const section = response.structuredContent.data;
      assert.equal(section.source_clarifications[0].id, record.id);
      assert.match(JSON.stringify(section.warnings), /SOURCE_CONFLICT_CLARIFIED/);
      assert.match(section.text, /출생일로부터 1년/);
      assert.match(JSON.stringify(section.source_clarifications), /2년/);
    }
    const fetched = (await call(db, 'fetch', { id: sectionId })).structuredContent;
    assert.match(fetched.text, /MANUAL_SOURCE_CLARIFICATIONS/);
    assert.match(fetched.text, /MANUAL_VERIFIED_TABLE_FACTS/);
    assert.equal(fetched.metadata.source_clarifications[0].id, record.id);
    assert.ok(fetched.text.indexOf('MANUAL_SOURCE_CLARIFICATIONS') < fetched.text.indexOf('출생일로부터 1년이며'));
  } finally { db.sqlite.close(); }
});
