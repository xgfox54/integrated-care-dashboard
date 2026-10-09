import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildBudgetPack } from '../factory/budget/build-budget-pack.mjs';
import { validateBudgetPack } from './imports/budget-pack.ts';
import { readZip } from './imports/zip.ts';
import { activeRevisions, lineSubtree } from './fiscal/budget-documents.ts';
import { activateImport, approveImport, beginImport, finalizeImport, putChunk } from './imports/store.ts';
import { database } from './press-test-support.mjs';

const NOW = 1_791_200_000;
const sha = value => createHash('sha256').update(value).digest('hex');

async function nestedPack(change = lines => lines) {
  const hierarchy = [
    [null, 'department', '건강증진과'], [1, 'policy', '건강증진사업'],
    [2, 'unit', '건강생활실천'], [3, 'detail_project', '걷기운동'],
    [4, 'object_group', '일반운영비'], [5, 'object', '사무관리비'],
    [6, 'item', '일반수용비'], [7, 'sub_item', '걷기운동실천사업'],
    [8, 'sub_item_detail', '워크온플랫폼 사용료', '10,800', '900,000원*12월'],
    [8, 'sub_item_detail', '인증상품', '36,000', '6,000원*12월*500명'],
    [8, 'sub_item_detail', '현수막 구입', '1,000', '1,000,000원'],
  ];
  const extracted = { extractor_version: 'budget-lines-1.3.0', amount_columns: ['예산액|전년도예산액|비교증감'], problems: [], summary: {},
    lines: change(hierarchy.map(([parent_line_no, level, name, amount = '47,800', formula_text = null], index) => ({
      line_no: index + 1, parent_line_no, level, name, code: index === 4 ? '201' : index === 5 ? '01' : null,
      amount_thousand_krw: amount, formula_text, amount_basis: 'source_cell', funding: [],
      checks: index < 8 ? { children_sum: 'match' } : { formula: 'match' },
      evidence: { page: 416, block_id: 'b:df17f7936366636b', table_id: 't:df17f7936366636b', row: 6 },
    }))) };
  const document = { document_id: 'doc:budget-depth-fixture', lines_json: 'lines', parse_dir: 'parse',
    title: '가평군 건강증진과 본예산 시험', issuer: '가평군', issuer_sido: '경기도', issuer_sigungu: '가평군',
    fiscal_entity_id: null, fiscal_year: '2026', page_url: 'https://www.gp.go.kr/portal/contents.do?key=2562',
    file_url: null, retrieved_at: '2026-10-08T00:00:00Z', rights_basis: '공개 예산서의 시험 표본',
    stage: 'adopted_initial', supplementary_round: null, stage_basis: '2026 본예산',
    account_code: '100', account_name: '일반회계', scope_text: '건강증진과 시험 표본', previous_column: 'previous_year_budget' };
  const parse = { source_version_id: 'sv-' + sha('depth fixture').slice(0, 12), raw_sha256: sha('depth fixture'),
    parse_id: 'p_' + sha('depth fixture').slice(0, 32), detected_format: 'pdf', parser: { name: 'kordoc', package_version: '4.18.13' } };
  return buildBudgetPack({ artifact_id: 'budget-depth-fixture-0001', producer_run_id: 'depth-test', created_at: document.retrieved_at, documents: [document] }, file => file === 'lines' ? extracted : parse);
}

test('approved nested costs are persisted and returned as distinct child rows', async () => {
  // Given: known printed p416 amounts, with no flattening or omitted subtotal.
  const db = database();
  const built = await nestedPack();
  const { row } = await beginImport(db, { artifactId: built.manifest.artifact_id, archiveSha256: built.sha256, sizeBytes: built.zip.length, totalChunks: 1 }, NOW);
  await putChunk(db, row.import_id, 0, built.zip, NOW);
  const subjects = async ids => new Set(ids);
  // When: normal validation, approval, activation and public-subtree read.
  const staged = await finalizeImport(db, row.import_id, subjects, NOW);
  assert.equal(staged.status, 'staged', staged.report_json);
  await approveImport(db, row.import_id, built.sha256, NOW + 1);
  await activateImport(db, row.import_id, subjects, NOW + 2);
  const [revision] = await activeRevisions(db);
  const subtree = await lineSubtree(db, revision.revision_id, 4);
  // Then
  assert.deepEqual(subtree.lines.filter(line => line.level === 'sub_item_detail').map(line => [line.parent_line_no, line.name, line.amount_thousand_krw]), [
    [8, '워크온플랫폼 사용료', '10,800'], [8, '인증상품', '36,000'], [8, '현수막 구입', '1,000'],
  ]);
  assert.equal(subtree.lines.find(line => line.line_no === 8).amount_thousand_krw, '47,800');
});

test('a third-level cost cannot skip its sub-item parent', async () => {
  // Given
  const built = await nestedPack(lines => lines.map(line => line.line_no === 9 ? { ...line, parent_line_no: 7 } : line));
  // When
  const result = await validateBudgetPack(await readZip(built.zip), built.manifest);
  // Then
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(problem => problem.code === 'PARENT_INVALID'));
});

test('server recomputation rejects a false subtotal match in the new depth', async () => {
  // Given
  const built = await nestedPack(lines => lines.map(line => line.line_no === 9 ? { ...line, amount_thousand_krw: '10,801' } : line));
  // When
  const result = await validateBudgetPack(await readZip(built.zip), built.manifest);
  // Then
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(problem => problem.code === 'DECLARED_CHECK_DISAGREES'));
});
