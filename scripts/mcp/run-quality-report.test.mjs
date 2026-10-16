import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fixtureRun, changeArtifact } from './quality-report-fixtures.mjs';
import { runQualityReport, renderQualityReport } from './run-quality-report.mjs';

async function fixture(input = fixtureRun(), root = undefined) {
  root ??= await mkdtemp(join(tmpdir(), 'quality-report-'));
  const spec = { run: input.run, revision_pointers: input.revision_pointers };
  for (const key of ['benchmark', 'observations', 'before', 'after', 'registered_tools']) {
    const { bytes, ...ref } = input[key];
    await writeFile(join(root, ref.path), bytes);
    spec[key] = ref;
  }
  const manifest = { schema_version: 'quality-manifest-1', required_suites: ['balanced'], suites: { balanced: spec } };
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  return { root, path, manifest };
}

test('CLI offline rendering JSON Markdown current passes with exact denominator', async () => {
  const f = await fixture();
  const output = join(f.root, 'report');
  const child = spawnSync(process.execPath, ['scripts/mcp/run-quality-report.mjs', '--manifest', f.path, '--output', output, '--profile', 'current'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(await readFile(join(output, 'quality.json'), 'utf8'));
  assert.equal(report.benchmarks.balanced.dimensions.retrieval_contract.denominator, 50);
  assert.match(await readFile(join(output, 'REPORT.md'), 'utf8'), /Generated-answer accuracy: NOT_EVALUATED/);
});
test('CLI missing file tamper partial and stale all exit 2 with captured failure reports', async () => {
  for (const kind of ['missing', 'tamper', 'partial', 'stale']) {
    const input = fixtureRun();
    if (kind === 'partial') changeArtifact(input, 'observations', rows => rows.pop());
    if (kind === 'stale') input.run.started_at = '2020-01-01T00:00:00.000Z';
    const f = await fixture(input);
    if (kind === 'missing') { f.manifest.suites.balanced.after.path = 'absent.json'; await writeFile(f.path, JSON.stringify(f.manifest)); }
    if (kind === 'tamper') await writeFile(join(f.root, 'observations.json'), '[]');
    const output = join(f.root, 'report');
    const child = spawnSync(process.execPath, ['scripts/mcp/run-quality-report.mjs', '--manifest', f.path, '--output', output], { encoding: 'utf8' });
    assert.equal(child.status, 2, kind + child.stderr);
    assert.equal(JSON.parse(await readFile(join(output, 'quality.json'), 'utf8')).gates.release_eligible, false);
    assert.ok((await readFile(join(output, 'REPORT.md'), 'utf8')).length > 100);
  }
});
test('CLI valid failed contract exit 1 historical non-promotable and claimed optional answers invalid', async () => {
  const input = changeArtifact(fixtureRun(), 'observations', rows => { rows[0].response = { error: { code: 'FAILURE' } }; });
  const failed = await fixture(input);
  assert.equal((await runQualityReport(failed.path)).exit_code, 1);
  const f = await fixture();
  assert.equal((await runQualityReport(f.path, { profile: 'historical' })).gates.release_eligible, false);
  f.manifest.actual_answers = { benchmark: f.manifest.suites.balanced.benchmark, observations: f.manifest.suites.balanced.observations, evidence_root: '.' };
  await writeFile(f.path, JSON.stringify(f.manifest));
  const report = await runQualityReport(f.path);
  assert.equal(report.dimensions.generated_answer_accuracy.status, 'INVALID');
  assert.equal(report.gates.generated_answer_passed, false);
  assert.equal(report.gates.retrieval_passed, true);
  assert.match(renderQualityReport(report), /Generated-answer accuracy: INVALID/);
});
test('write persistent synthetic CLI evidence artifacts', async () => {
  const output = resolve('.omo/evidence/quality-report-unit-cli');
  await mkdir(output, { recursive: true });
  const f = await fixture(fixtureRun(), output);
  const report = await runQualityReport(f.path);
  await writeFile(join(output, 'quality.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'REPORT.md'), renderQualityReport(report));
  assert.equal(report.gates.retrieval_passed, true);
});
test('golden adapter reruns raw observations and keeps 200 denominators separately', async () => {
  const { artifact } = await import('./quality-report-fixtures.mjs');
  const benchmark = JSON.parse(await readFile('quality/golden_qa_v1.4.0.json', 'utf8'));
  const input = fixtureRun();
  input.benchmark = artifact(benchmark, 'golden.json');
  input.observations = artifact(benchmark.items.map(item => ({ id: item.id, tool: 'search', args: { query: item.question },
    response: { question: item.question, search: { arguments: { query: item.question }, result: { error: { code: 'ORIGINAL_FAILURE' } } }, fetched: [] }, latency_ms: null })), 'golden-raw.json');
  changeArtifact(input, 'registered_tools', value => value.tools.push({ name: 'fetch' }));
  const f = await fixture(input);
  f.manifest.suites.golden = f.manifest.suites.balanced;
  delete f.manifest.suites.balanced;
  f.manifest.required_suites = ['golden'];
  await writeFile(f.path, JSON.stringify(f.manifest));
  const report = await runQualityReport(f.path);
  assert.equal(report.exit_code, 1);
  assert.deepEqual(report.benchmarks.golden.errors, []);
  assert.equal(report.benchmarks.golden.dimensions.retrieval_contract.denominator, 200);
  assert.equal(report.benchmarks.golden.evaluation.summary.search_execution.count, 0);
  assert.equal(report.benchmarks.golden.evaluation.summary.all_200_items_accounted_for, true);
  const balancedInput = changeArtifact(fixtureRun(), 'registered_tools', value => value.tools.push({ name: 'fetch' }));
  const balanced = await fixture(balancedInput, f.root);
  f.manifest.suites.balanced = balanced.manifest.suites.balanced;
  f.manifest.required_suites = ['balanced', 'golden'];
  await writeFile(f.path, JSON.stringify(f.manifest));
  const combined = await runQualityReport(f.path);
  assert.equal(combined.exit_code, 1);
  assert.equal(combined.benchmarks.balanced.dimensions.retrieval_contract.denominator, 50);
  assert.equal(combined.benchmarks.golden.dimensions.retrieval_contract.denominator, 200);
  assert.match(renderQualityReport(combined), /\| balanced \| EVALUATED \| 50/);
  assert.match(renderQualityReport(combined), /\| golden \| EVALUATED \| 200/);
});
