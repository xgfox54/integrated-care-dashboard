// 문서 사실 반입(작업지시서 v5 §10, T38~T41·T136·T80 일부): 검사·상태 전이·멱등·경쟁·차단·고정 조회.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { buildDocumentPack } from "../factory/release/pack-builder.mjs";
import { contentDigestOf, sourceSetDigestOf, statementIdOf, validatePack } from "./imports/pack.ts";
import { documentComponent, documentFactsFor } from "./imports/public.ts";
import {
  activateImport, approveImport, beginImport, blockSource, CHUNK_MAX_BYTES, finalizeImport, ImportError, putChunk, readImport, restoreImport,
} from "./imports/store.ts";
import { crc32, zipStored } from "./platform/zip-writer.ts";
import { database } from "./press-test-support.mjs";

const NOW = 1_791_100_000;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const encoder = new TextEncoder();
const SUBJECT = { subject_id: "docprog:test-paper-reward", subject_label: "시험 폐지 보상금 사업", subject_sido: "제주특별자치도", subject_sigungu: "서귀포시" };

function source(id, version, retrievedAt, extra = {}) {
  return {
    source_id: id, source_version_id: version, source_kind: "PUBLIC_NOTICE", title: "시험 공고 " + id, issuer: "서귀포시", issuer_sido: "제주특별자치도", issuer_sigungu: "서귀포시",
    document_number: "", url: null, published_date: null, retrieved_at: retrievedAt, raw_sha256: sha(version), format: "HWP5", parse_id: "p_" + sha(version).slice(0, 32),
    parser: "kordoc@4.18.8", adapter_version: "welfare-hwp-adapter-1.0.0", locator_precision: "parsed_structural", page_mode: "layout", rights_basis: "시험", ...extra,
  };
}
function fact(version, predicate, value, extra = {}) {
  return {
    ...SUBJECT, predicate_id: predicate, value_text: value, unit: null, scope_text: null, source_version_id: version, reviewed_at: "2026-10-04T00:00:00Z",
    evidence: [{ block_id: "b:" + sha(value).slice(0, 16), ir_pointer: "/blocks/3", table_id: null, cell: null, layout_page_start: 1, quote: value.slice(0, 300) }], ...extra,
  };
}
async function pack(artifactId, sources, facts, options = {}) {
  return buildDocumentPack({ artifactId, createdAt: "2026-10-04T00:00:00Z", producerRunId: "test", mappingVersion: "m1", baseSourceRunId: null, sources, facts, ...options });
}

/** 행을 그대로 써서(사실 ID를 다시 계산하지 않고) 해시만 맞춘 묶음. 일부러 잘못된 행을 넣는 시험용. */
async function rawPack({ manifest = {}, sources, statements, evidence, extra = [], replace = {} }) {
  const jsonl = (rows) => encoder.encode(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  const files = [
    { path: "data/knowledge/sources.jsonl", bytes: jsonl(sources), records: sources.length },
    { path: "data/knowledge/statements.jsonl", bytes: jsonl(statements), records: statements.length },
    { path: "data/knowledge/evidence.jsonl", bytes: jsonl(evidence), records: evidence.length },
    ...extra,
  ];
  const full = {
    format: "welfare-public-release-v2", artifact_id: "raw-pack-0001", created_at: "2026-10-04T00:00:00Z", producer_run_id: "t", modules_present: ["knowledge"],
    module_schema_versions: { knowledge: "document-facts-1" }, module_modes: { knowledge: "source_scoped_replace" },
    publication_scope: { knowledge: { source_ids: [...new Set(sources.map((row) => row.source_id))] } }, ontology_version: "welfare-v2", mapping_version: "m1",
    base_release_bundle_id: null, base_source_run_id: null, base_component_ids: {}, source_set_digest: await sourceSetDigestOf(sources),
    content_digest: await contentDigestOf(statements, evidence), source_policy_versions: {},
    files: files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha(file.bytes), records: file.records ?? null })),
    coverage: {}, validation: {}, ...manifest,
  };
  const entries = [{ path: "manifest.json", bytes: encoder.encode(JSON.stringify(full)) }, ...files.map(({ path, bytes }) => ({ path, bytes: replace[path] ?? bytes }))];
  return zipStored(entries);
}

async function rows(sources, facts) {
  const built = await pack("rows-0001", sources, facts);
  return { sources, statements: built.statements, evidence: built.evidence };
}

const codes = (result) => result.problems.map((problem) => problem.code);
const anySubject = async (ids) => new Set(ids);
const noSubject = async () => new Set();

async function upload(db, built, artifactId = built.manifest.artifact_id) {
  const total = Math.ceil(built.zip.length / CHUNK_MAX_BYTES);
  const { row } = await beginImport(db, { artifactId, archiveSha256: built.sha256, sizeBytes: built.zip.length, totalChunks: total }, NOW);
  for (let index = 0; index < total; index += 1) await putChunk(db, row.import_id, index, built.zip.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES), NOW);
  return row.import_id;
}

async function publish(db, built, subjects = anySubject) {
  const id = await upload(db, built);
  const staged = await finalizeImport(db, id, subjects, NOW);
  assert.equal(staged.status, "staged", staged.report_json);
  await approveImport(db, id, built.sha256, NOW + 1);
  return activateImport(db, id, subjects, NOW + 2);
}

test("검사 통과 → 승인 → 활성화를 거친 사실만 공개되고, 같은 사실은 언제 만들어도 같은 ID·지문을 가진다", async () => {
  const db = database();
  const sources = [source("doc:test-a", "sv-aaaaaaaa01", "2026-02-01T00:00:00Z")];
  const facts = [fact("sv-aaaaaaaa01", "target_group", "등록 수집자"), fact("sv-aaaaaaaa01", "benefit_amount", "25원/kg")];
  const first = await pack("artifact-a-0001", sources, facts);
  const again = await buildDocumentPack({ artifactId: "artifact-a-0002", createdAt: "2027-01-01T00:00:00Z", producerRunId: "other", mappingVersion: "m1", baseSourceRunId: null, sources, facts });
  assert.deepEqual(again.statements.map((row) => row.statement_id), first.statements.map((row) => row.statement_id));
  assert.equal(again.manifest.content_digest, first.manifest.content_digest);

  const id = await upload(db, first);
  assert.equal((await readImport(db, id)).status, "received");
  assert.equal((await documentFactsFor(db, [SUBJECT.subject_id], null)).length, 0, "받기만 한 묶음은 공개되지 않는다");
  const staged = await finalizeImport(db, id, anySubject, NOW);
  assert.equal(staged.status, "staged");
  assert.equal((await documentFactsFor(db, [SUBJECT.subject_id], null)).length, 0, "검사를 통과해도 승인 전에는 공개되지 않는다");
  await assert.rejects(activateImport(db, id, anySubject, NOW), (error) => error instanceof ImportError && error.code === "IMPORT_NOT_APPROVED", "상태를 건너뛸 수 없다");
  await assert.rejects(approveImport(db, id, "0".repeat(64), NOW), (error) => error.code === "APPROVED_HASH_MISMATCH");
  await approveImport(db, id, first.sha256, NOW);
  const active = await activateImport(db, id, anySubject, NOW);
  assert.equal(active.status, "active");
  const visible = await documentFactsFor(db, [SUBJECT.subject_id], null);
  assert.equal(visible.length, 2);
  assert.ok((await documentComponent(db)).id?.startsWith("docs:"));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM import_chunk").first()).n, 0, "조립 뒤 청크는 지운다");
});

test("같은 artifact·같은 해시 재전송은 이어받고, 다른 해시는 거절한다. 청크도 같은 내용만 다시 받는다", async () => {
  const db = database();
  const built = await pack("artifact-b-0001", [source("doc:test-b", "sv-bbbbbbbb01", "2026-02-01T00:00:00Z")], [fact("sv-bbbbbbbb01", "eligibility", "만 19세 이상 주민")]);
  const id = await upload(db, built);
  const resumed = await beginImport(db, { artifactId: "artifact-b-0001", archiveSha256: built.sha256, sizeBytes: built.zip.length, totalChunks: 1 }, NOW);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.row.import_id, id);
  await assert.rejects(beginImport(db, { artifactId: "artifact-b-0001", archiveSha256: "f".repeat(64), sizeBytes: built.zip.length, totalChunks: 1 }, NOW), (error) => error.code === "ARTIFACT_ID_CONFLICT");
  await putChunk(db, id, 0, built.zip, NOW);
  const tampered = built.zip.slice();
  tampered[100] ^= 0xff;
  await assert.rejects(putChunk(db, id, 0, tampered, NOW), (error) => error.code === "CHUNK_CONFLICT");
  assert.equal((await finalizeImport(db, id, anySubject, NOW)).status, "staged");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM doc_statement").first()).n, 1, "재전송에도 중복 적재 없음");
});

test("변조된 묶음·청크 조립 해시 불일치·manifest와 다른 파일은 거절한다", async () => {
  const db = database();
  const built = await pack("artifact-c-0001", [source("doc:test-c", "sv-cccccccc01", "2026-02-01T00:00:00Z")], [fact("sv-cccccccc01", "target_group", "등록 수집자")]);
  const { row } = await beginImport(db, { artifactId: "artifact-c-0001", archiveSha256: sha("다른 내용"), sizeBytes: built.zip.length, totalChunks: 1 }, NOW);
  await putChunk(db, row.import_id, 0, built.zip, NOW);
  const rejected = await finalizeImport(db, row.import_id, anySubject, NOW);
  assert.equal(rejected.status, "rejected");
  assert.match(rejected.report_json, /ARCHIVE_HASH_MISMATCH/);

  const base = await rows([source("doc:test-c", "sv-cccccccc01", "2026-02-01T00:00:00Z")], [fact("sv-cccccccc01", "target_group", "등록 수집자")]);
  const swapped = await rawPack({ ...base, replace: { "data/knowledge/statements.jsonl": encoder.encode(JSON.stringify({ ...base.statements[0], value_text: "바꾼 값" }) + "\n") } });
  const result = await validatePack(swapped);
  assert.equal(result.ok, false);
  assert.ok(codes(result).some((code) => code === "FILE_HASH_MISMATCH" || code === "FILE_SIZE_MISMATCH"));
  const broken = built.zip.slice();
  broken[built.zip.length - 200] ^= 0x01;
  const crc = await validatePack(broken);
  assert.equal(crc.ok, false, "ZIP 안 내용이 바뀌면 CRC나 구조 검사에서 걸린다");
});

test("허용 목록 밖 파일(SQL·스크립트)·위험한 경로·압축 폭탄·암호화 항목은 풀기 전에 거절한다", async () => {
  const base = await rows([source("doc:test-d", "sv-dddddddd01", "2026-02-01T00:00:00Z")], [fact("sv-dddddddd01", "target_group", "등록 수집자")]);
  const sql = await rawPack({ ...base, extra: [{ path: "data/knowledge/load.sql", bytes: encoder.encode("DROP TABLE doc_active;"), records: null }] });
  assert.deepEqual(codes(await validatePack(sql)), ["FILE_NOT_ALLOWED"]);
  const script = await rawPack({ ...base, extra: [{ path: "hooks/postinstall.js", bytes: encoder.encode("process.exit(1)"), records: null }] });
  assert.deepEqual(codes(await validatePack(script)), ["FILE_NOT_ALLOWED"]);
  for (const path of ["../escape.jsonl", "/abs.jsonl", "C:/x.jsonl", "a\\b.jsonl", "data//x"]) {
    const zip = zipStored([{ path, bytes: encoder.encode("{}") }]);
    assert.deepEqual(codes(await validatePack(zip)), ["UNSAFE_PATH"], path);
  }
  const duplicate = zipStored([{ path: "manifest.json", bytes: encoder.encode("{}") }, { path: "MANIFEST.json", bytes: encoder.encode("{}") }]);
  assert.deepEqual(codes(await validatePack(duplicate)), ["DUPLICATE_ENTRY"]);

  // deflate 폭탄: 2MiB의 0을 압축하면 압축비가 100을 훌쩍 넘는다.
  const zeros = new Uint8Array(2 * 1024 * 1024);
  const bomb = deflateZip("data/knowledge/statements.jsonl", zeros);
  assert.deepEqual(codes(await validatePack(bomb)), ["COMPRESSION_RATIO_TOO_HIGH"]);
  const encrypted = zipStored([{ path: "manifest.json", bytes: encoder.encode("{}") }]);
  const view = new DataView(encrypted.buffer);
  const central = view.getUint32(encrypted.length - 22 + 16, true);
  view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
  assert.deepEqual(codes(await validatePack(encrypted)), ["ENCRYPTED_ENTRY"]);
});

function deflateZip(path, data) {
  const name = encoder.encode(path);
  const compressed = deflateRawSync(data);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, crc32(data), true);
  local.setUint32(18, compressed.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, name.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(10, 8, true);
  central.setUint32(16, crc32(data), true);
  central.setUint32(20, compressed.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, name.length, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + name.length, true);
  end.setUint32(16, 30 + name.length + compressed.length, true);
  return Buffer.concat([Buffer.from(local.buffer), name, compressed, Buffer.from(central.buffer), name, Buffer.from(end.buffer)]);
}

test("미검토 사실·보도자료 위장·모르는 필드·로컬 경로·사실 ID 위조·근거 없는 사실은 거절한다", async () => {
  const sv = "sv-eeeeeeee01";
  const base = await rows([source("doc:test-e", sv, "2026-02-01T00:00:00Z")], [fact(sv, "target_group", "등록 수집자")]);
  const unreviewed = await rawPack({ ...base, statements: [{ ...base.statements[0], review_status: "candidate" }] });
  assert.ok(codes(await validatePack(unreviewed)).includes("UNREVIEWED_FACT"));
  const news = await rawPack({ ...base, sources: [{ ...base.sources[0], source_kind: "OFFICIAL_PRESS_RELEASE" }] });
  assert.ok(codes(await validatePack(news)).includes("NEWS_NOT_ALLOWED_AS_KNOWLEDGE"));
  const extraField = await rawPack({ ...base, statements: [{ ...base.statements[0], summary: "본문 요약" }] });
  assert.ok(codes(await validatePack(extraField)).includes("FIELD_NOT_ALLOWED"));
  const localPath = await rawPack({ ...base, evidence: [{ ...base.evidence[0], quote: "C:\\Users\\USER\\원문.hwp" }] });
  assert.ok(codes(await validatePack(localPath)).includes("LOCAL_PATH_IN_PUBLIC_DATA"));
  const forged = await rawPack({ ...base, statements: [{ ...base.statements[0], value_text: "다른 값" }] });
  assert.ok(codes(await validatePack(forged)).includes("STATEMENT_ID_MISMATCH"), "같은 ID에 다른 내용은 받지 않는다");
  const noEvidence = await rawPack({ ...base, evidence: [] });
  assert.ok(codes(await validatePack(noEvidence)).includes("STATEMENT_WITHOUT_EVIDENCE"));
  const page = await rawPack({ ...base, evidence: [{ ...base.evidence[0], physical_page_verified: true }] });
  assert.ok(codes(await validatePack(page)).includes("PHYSICAL_PAGE_NOT_VERIFIED"));
});

test("서버가 직접 모으는 모듈(재정·보도자료·연결)과 v1·모르는 형식은 반입하지 않는다", async () => {
  const base = await rows([source("doc:test-f", "sv-ffffffff01", "2026-02-01T00:00:00Z")], [fact("sv-ffffffff01", "target_group", "등록 수집자")]);
  for (const name of ["fiscal", "news", "links"]) {
    const zip = await rawPack({ ...base, manifest: { modules_present: ["knowledge", name] } });
    assert.ok(codes(await validatePack(zip)).includes("MODULE_NOT_PERMITTED"), name);
  }
  assert.deepEqual(codes(await validatePack(await rawPack({ ...base, manifest: { format: "welfare-public-release-v1" } }))), ["FORMAT_V1_NOT_SUPPORTED"]);
  assert.deepEqual(codes(await validatePack(await rawPack({ ...base, manifest: { format: "opencrab-pack-v1" } }))), ["FORMAT_UNKNOWN"]);
  assert.ok(codes(await validatePack(await rawPack({ ...base, manifest: { unexpected: true } }))).includes("FIELD_NOT_ALLOWED"), "manifest의 모르는 필드도 거절");
});

test("범위의 Source가 비어 있으면 명시적 빈 교체로 선언해야 하고, 선언하면 그 Source의 공개 사실만 내린다", async () => {
  const db = database();
  await publish(db, await pack("artifact-g-0001", [source("doc:test-g", "sv-99999999a1", "2026-02-01T00:00:00Z"), source("doc:test-h", "sv-99999999b1", "2026-02-01T00:00:00Z")], [
    fact("sv-99999999a1", "target_group", "가 대상"), fact("sv-99999999b1", "target_group", "나 대상"),
  ]));
  assert.equal((await documentFactsFor(db, [SUBJECT.subject_id], null)).length, 2);
  const undeclared = await rawPack({ sources: [], statements: [], evidence: [], manifest: { publication_scope: { knowledge: { source_ids: ["doc:test-g"] } } } });
  assert.ok(codes(await validatePack(undeclared)).includes("EMPTY_SCOPE_NOT_DECLARED"));
  const emptied = await pack("artifact-g-0002", [], [], { emptyReplaceSourceIds: ["doc:test-g"] });
  await publish(db, emptied);
  const left = await documentFactsFor(db, [SUBJECT.subject_id], null);
  assert.deepEqual(left.map((row) => row.source_id), ["doc:test-h"], "범위 밖 Source(doc:test-h)는 그대로");
});

test("더 새 원본으로 만든 자료가 공개 중이면 오래된 묶음은 덮어쓰지 않는다", async () => {
  const db = database();
  await publish(db, await pack("artifact-i-0002", [source("doc:test-i", "sv-11111111b2", "2026-03-01T00:00:00Z")], [fact("sv-11111111b2", "benefit_amount", "30원/kg")]));
  const old = await pack("artifact-i-0001", [source("doc:test-i", "sv-11111111a1", "2026-01-01T00:00:00Z")], [fact("sv-11111111a1", "benefit_amount", "25원/kg")]);
  const id = await upload(db, old);
  await finalizeImport(db, id, anySubject, NOW);
  await approveImport(db, id, old.sha256, NOW);
  await assert.rejects(activateImport(db, id, anySubject, NOW), (error) => error.code === "STALE_SOURCE_VERSION");
  assert.deepEqual((await documentFactsFor(db, [SUBJECT.subject_id], null)).map((row) => row.value_text), ["30원/kg"]);
});

test("승인 뒤 공개 정책이 바뀌면 다시 검토하고, 차단한 Source는 과거 파일을 다시 올려도 공개되지 않는다", async () => {
  const db = database();
  const a = await pack("artifact-j-0001", [source("doc:test-j", "sv-22222222a1", "2026-02-01T00:00:00Z")], [fact("sv-22222222a1", "target_group", "가 대상")]);
  const k = await pack("artifact-k-0001", [source("doc:test-k", "sv-33333333a1", "2026-02-01T00:00:00Z")], [fact("sv-33333333a1", "target_group", "다른 대상")]);
  await publish(db, a);
  const id = await upload(db, k);
  await finalizeImport(db, id, anySubject, NOW);
  await approveImport(db, id, k.sha256, NOW);
  await blockSource(db, "doc:test-j", "개인정보 혼입 확인", NOW + 5);
  assert.equal((await documentFactsFor(db, [SUBJECT.subject_id], null)).length, 0, "차단 즉시 공개 목록에서 빠진다");
  await assert.rejects(activateImport(db, id, anySubject, NOW + 6), (error) => error.code === "POLICY_CHANGED_SINCE_APPROVAL");
  assert.equal((await readImport(db, id)).status, "staged", "다시 승인해야 한다");
  await approveImport(db, id, k.sha256, NOW + 7);
  assert.equal((await activateImport(db, id, anySubject, NOW + 8)).status, "active");

  const again = await pack("artifact-j-0002", [source("doc:test-j", "sv-22222222b1", "2026-04-01T00:00:00Z")], [fact("sv-22222222b1", "target_group", "가 대상")]);
  const reupload = await upload(db, again);
  const result = await finalizeImport(db, reupload, anySubject, NOW + 9);
  assert.equal(result.status, "rejected");
  assert.match(result.report_json, /SOURCE_BLOCKED/);
});

test("대시보드에 없는 사업(service:)을 가리키는 사실은 받지 않는다", async () => {
  const db = database();
  const built = await pack("artifact-l-0001", [source("doc:test-l", "sv-44444444a1", "2026-02-01T00:00:00Z")], [fact("sv-44444444a1", "target_group", "대상", { subject_id: "service:nothere|제주특별자치도|서귀포시|a|b|c" })]);
  const id = await upload(db, built);
  const result = await finalizeImport(db, id, noSubject, NOW);
  assert.equal(result.status, "rejected");
  assert.match(result.report_json, /SUBJECT_NOT_FOUND/);
});

test("고정된 공개본 목록으로 읽으면 새 반입이 활성화돼도 요청 중 결과가 바뀌지 않는다", async () => {
  const db = database();
  await publish(db, await pack("artifact-m-0001", [source("doc:test-m", "sv-55555555a1", "2026-02-01T00:00:00Z")], [fact("sv-55555555a1", "benefit_amount", "25원/kg")]));
  const pinned = (await documentComponent(db)).detail.pairs;
  await publish(db, await pack("artifact-m-0002", [source("doc:test-m", "sv-55555555b1", "2026-05-01T00:00:00Z")], [fact("sv-55555555b1", "benefit_amount", "30원/kg")]));
  assert.deepEqual((await documentFactsFor(db, [SUBJECT.subject_id], pinned)).map((row) => row.value_text), ["25원/kg"]);
  assert.deepEqual((await documentFactsFor(db, [SUBJECT.subject_id], null)).map((row) => row.value_text), ["30원/kg"]);
  assert.equal((await db.prepare("SELECT status FROM import_artifact WHERE artifact_id = 'artifact-m-0001'").first()).status, "superseded");
  assert.equal(await statementIdOf({ ...SUBJECT, predicate_id: "benefit_amount", value_text: "30원/kg", unit: null, scope_text: null, source_version_id: "sv-55555555b1" }), (await documentFactsFor(db, [SUBJECT.subject_id], null))[0].statement_id);
});


test("같은 Source에 바이트가 다른 원문(HWP→HWPX)이 오면 새 원문 버전으로 알리고, 두 버전을 합치지 않는다(T74)", async () => {
  const db = database();
  await publish(db, await pack("artifact-n-0001", [source("doc:test-n", "sv-66666666a1", "2026-02-01T00:00:00Z", { format: "HWP5" })], [fact("sv-66666666a1", "target_group", "가 대상")]));
  const next = await pack("artifact-n-0002", [source("doc:test-n", "sv-66666666b1", "2026-03-01T00:00:00Z", { format: "HWPX", title: "시험 공고 doc:test-n" })], [fact("sv-66666666b1", "target_group", "가 대상")]);
  const id = await upload(db, next);
  const staged = await finalizeImport(db, id, anySubject, NOW);
  const report = JSON.parse(staged.report_json);
  assert.deepEqual(report.version_changes, [{ source_id: "doc:test-n", previous_version: "sv-66666666a1", previous_format: "HWP5", new_version: "sv-66666666b1", new_format: "HWPX", format_changed: true }]);
  await approveImport(db, id, next.sha256, NOW);
  await activateImport(db, id, anySubject, NOW);
  const versions = db.sqlite.prepare("SELECT source_version_id, format FROM doc_source WHERE source_id = 'doc:test-n' ORDER BY source_version_id").all().map((row) => [row.source_version_id, row.format]);
  assert.deepEqual(versions, [["sv-66666666a1", "HWP5"], ["sv-66666666b1", "HWPX"]], "두 원문 버전을 따로 보관");
  const visible = await documentFactsFor(db, [SUBJECT.subject_id], null);
  assert.deepEqual(visible.map((row) => row.source_version_id), ["sv-66666666b1"], "공개는 새 버전 하나만, 이전 버전 사실을 섞지 않음");
  assert.notEqual(visible[0].statement_id, (await pack("x-check-0001", [source("doc:test-n", "sv-66666666a1", "2026-02-01T00:00:00Z")], [fact("sv-66666666a1", "target_group", "가 대상")])).statements[0].statement_id, "같은 글이라도 원문 버전이 다르면 다른 사실 ID");
});


test("새 묶음으로 바뀐 이전 반입을 관리자가 되돌리면 다시 공개되고, 차단·정책 변경 뒤에는 되돌리지 않는다(T139)", async () => {
  const db = database();
  const first = await publish(db, await pack("artifact-r-0001", [source("doc:test-r", "sv-44444444a1", "2026-01-01T00:00:00Z")], [fact("sv-44444444a1", "benefit_amount", "25원/kg")]));
  const second = await publish(db, await pack("artifact-r-0002", [source("doc:test-r", "sv-44444444b2", "2026-03-01T00:00:00Z")], [fact("sv-44444444b2", "benefit_amount", "30원/kg")]));
  const values = async () => (await documentFactsFor(db, [SUBJECT.subject_id], null)).map((row) => row.value_text);
  assert.equal((await readImport(db, first.import_id)).status, "superseded");
  assert.deepEqual(await values(), ["30원/kg"]);
  await assert.rejects(restoreImport(db, second.import_id, anySubject, NOW + 3), (error) => error.code === "IMPORT_NOT_RESTORABLE", "공개 중인 묶음은 되돌리기 대상이 아니다");
  const restored = await restoreImport(db, first.import_id, anySubject, NOW + 4);
  assert.equal(restored.status, "active");
  assert.deepEqual(await values(), ["25원/kg"], "더 새 원본이 있어도 관리자가 고른 이전 묶음으로 되돌린다");
  assert.equal((await readImport(db, second.import_id)).status, "superseded");
  assert.match((await readImport(db, first.import_id)).report_json, /restored_at/);
  assert.deepEqual((await restoreImport(db, second.import_id, anySubject, NOW + 5)).status, "active", "다시 새 묶음으로 돌아갈 수도 있다");
  await blockSource(db, "doc:test-r", "권리 철회", NOW + 6);
  await assert.rejects(restoreImport(db, first.import_id, anySubject, NOW + 7), (error) => error.code === "POLICY_CHANGED_SINCE_APPROVAL");
  assert.deepEqual(await values(), [], "차단은 되돌리기로 풀리지 않는다");
});
