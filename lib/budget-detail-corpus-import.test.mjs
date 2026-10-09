import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeRevisions, lineSubtree, revisionOutline } from "./fiscal/budget-documents.ts";
import { activateImport, approveImport, beginImport, CHUNK_MAX_BYTES, finalizeImport, putChunk } from "./imports/store.ts";
import { readZip } from "./imports/zip.ts";
import { database } from "./press-test-support.mjs";

const reportFile = process.env.BUDGET_DETAIL_REPORT;
if (reportFile) test("수집 예산서의 실제 ZIP은 승인 후 공개 조회되며 부기·산출식·재원·근거 쪽이 보존된다", async () => {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const db = database();
  const now = 1_791_264_000;
  const subjects = async ids => new Set(ids);
  let totalLines = 0;
  for (const bundle of report.bundles) {
    const config = JSON.parse(readFileSync(bundle.config, "utf8"));
    for (const document of config.documents) {
      const entityId = document.fiscal_entity_id;
      const code = entityId.split(":").at(-1);
      await db.prepare("INSERT OR IGNORE INTO fiscal_entity (fiscal_entity_id, code_system, code, name, wa_code, wa_name, first_seen_at, last_seen_at) VALUES (?, 'lofin:laf', ?, ?, '', ?, ?, ?)")
        .bind(entityId, code, document.issuer, document.issuer_sido, now, now).run();
    }
    const bytes = readFileSync(bundle.bundle);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.path === "manifest.json").bytes));
    const sourceLines = new TextDecoder().decode(entries.find(entry => entry.path === "data/budget/lines.jsonl").bytes).trim().split("\n").map(JSON.parse);
    const { row } = await beginImport(db, { artifactId: manifest.artifact_id, archiveSha256: bundle.sha256, sizeBytes: bytes.length, totalChunks: Math.ceil(bytes.length / CHUNK_MAX_BYTES) }, now);
    for (let index = 0; index < row.total_chunks; index++) await putChunk(db, row.import_id, index, bytes.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES), now);
    const staged = await finalizeImport(db, row.import_id, subjects, now);
    assert.equal(staged.status, "staged", staged.report_json);
    assert.ok(!(await activeRevisions(db)).some(revision => revision.import_id === row.import_id), "승인 전에는 공개 목록에 없다");
    await approveImport(db, row.import_id, bundle.sha256, now + 1);
    assert.equal((await activateImport(db, row.import_id, subjects, now + 2)).status, "active");
    const revisions = (await activeRevisions(db)).filter(revision => revision.import_id === row.import_id);
    assert.equal(revisions.length, config.documents.length);
    assert.equal(revisions.reduce((sum, revision) => sum + revision.line_count, 0), bundle.counts.lines);
    for (const revision of revisions) {
      const document = config.documents.find(document => document.document_id === revision.document_id);
      assert.ok(document);
      const entityId = document.fiscal_entity_id;
      const revisionLines = sourceLines.filter(line => line.revision_id === revision.revision_id);
      const outline = await revisionOutline(db, revision.revision_id);
      assert.equal(outline.revision.source.file_url, document.file_url);
      assert.equal(outline.revision.fiscal_entity.fiscal_entity_id, entityId);
      const detailRoots = outline.lines.filter(line => line.level === "detail_project");
      assert.deepEqual(detailRoots.map(line => line.line_no).sort((a, b) => a - b),
        revisionLines.filter(line => line.level === "detail_project").map(line => line.line_no).sort((a, b) => a - b),
        "원문 묶음의 모든 세부사업이 공개 개요에 있어야 한다");
      for (const root of detailRoots) {
        const expected = [revisionLines.find(line => line.line_no === root.line_no)];
        const descendants = new Set([root.line_no]);
        for (const line of revisionLines.filter(line => line.line_no > root.line_no)) {
          if (!descendants.has(line.parent_line_no)) break;
          expected.push(line);
          descendants.add(line.line_no);
        }
        const subtree = await lineSubtree(db, revision.revision_id, root.line_no);
        assert.equal(subtree.lines.length, expected.length);
        for (const [index, line] of subtree.lines.entries()) {
          const source = expected[index];
          assert.equal(line.name, source.name);
          assert.equal(line.formula_text, source.formula_text);
          assert.equal(line.amount_thousand_krw, source.amount_thousand_krw);
          assert.deepEqual(line.funding, source.funding);
          assert.equal(line.evidence.page, source.page);
          assert.ok(line.evidence.page > 0);
        }
      }
      totalLines += revision.line_count;
    }
  }
  assert.equal((await activeRevisions(db)).length, report.bundles.reduce((sum, bundle) => sum + bundle.counts.documents, 0));
  assert.equal(totalLines, report.counts.lines);
  assert.equal((await activeRevisions(db, { entityId: "lofin:laf:4900000" })).length, 0, "다른 기관의 자료로 대신 표시하지 않는다");
  const all = await activeRevisions(db);
  const ids = [...new Set(all.map(revision => revision.fiscal_entity_id))];
  assert.equal((await activeRevisions(db, { entityIds: ids })).length, all.length, "지역(여러 기관) 조회는 그 기관 문서를 모두 준다");
  assert.equal((await activeRevisions(db, { entityIds: ["lofin:laf:4900000"] })).length, 0);
  assert.equal((await activeRevisions(db, { entityIds: [] })).length, 0);
  db.sqlite.close();
});
