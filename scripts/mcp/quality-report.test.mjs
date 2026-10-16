import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQualityRun, buildQualityReport } from './quality-report.mjs';
import { fixtureRun, artifact, changeArtifact } from './quality-report-fixtures.mjs';

const report = (input, options) => buildQualityReport(validateQualityRun(input, options));
const codes = input => validateQualityRun(input).errors.map(error => error.code);
test('complete run equal domain weights separate accuracy latency', () => {
  const result = report(fixtureRun());
  assert.deepEqual(result.errors, []);
  assert.equal(result.gates.release_eligible, true);
  assert.equal(result.evaluation.summary.domains.length, 10);
  assert.ok(result.evaluation.summary.domains.every(domain => domain.tested === 5));
  assert.equal(result.evaluation.summary.macro_percent, 100);
  assert.equal(result.dimensions.generated_answer_accuracy.status, 'NOT_EVALUATED');
  assert.equal(result.dimensions.citation_integrity.status, 'NOT_EVALUATED');
  assert.equal(result.dimensions.retrieval_contract.denominator, 50);
  assert.equal(result.dimensions.latency.p95, 48);
  assert.equal(result.dimensions.latency.p50, 25);
});
test('missing failed case and missing domain retain full expected denominators', () => {
  const input = fixtureRun();
  changeArtifact(input, 'observations', rows => rows.splice(0, 5));
  const result = report(input);
  assert.equal(result.gates.release_eligible, false);
  assert.equal(result.dimensions.retrieval_contract.denominator, 50);
  assert.equal(result.dimensions.retrieval_contract.missing, 5);
  assert.equal(result.evaluation.summary.macro_percent, 90);
  assert.ok(codes(input).includes('INCOMPLETE_RUN'));
});
test('duplicate and unknown case IDs rejected', () => {
  const input = changeArtifact(fixtureRun(), 'observations', rows => { rows[1] = rows[0]; });
  assert.ok(codes(input).includes('INCOMPLETE_RUN'));
  changeArtifact(input, 'observations', rows => { rows[0].id = 'UNKNOWN'; });
  assert.ok(codes(input).includes('CASE_BINDING_MISMATCH'));
});
test('stale current evidence cannot pass historical evidence is non-promotable', () => {
  const input = fixtureRun();
  input.run.started_at = new Date(Date.now() - 90_000_000).toISOString();
  assert.ok(codes(input).includes('STALE_RUN'));
  const historical = report(input, { profile: 'historical' });
  assert.equal(historical.gates.retrieval_passed, true);
  assert.equal(historical.gates.release_eligible, false);
});
test('mixed bundle source server and per-response revision fail', () => {
  for (const edit of [value => { value.release_bundle.release_bundle_id = 'new'; }, value => { value.faq_129.revision = 'new'; }, value => { value.server_version = 'new'; }]) {
    assert.ok(codes(changeArtifact(fixtureRun(), 'after', edit)).includes('MIXED_REVISIONS'));
  }
  const input = changeArtifact(fixtureRun(), 'observations', rows => { rows[0].response.structuredContent.data.server_version = 'old'; });
  assert.ok(codes(input).includes('MIXED_REVISIONS'));
});
test('hash mismatch benchmark argument binding and toolset mismatch fail', () => {
  const input = fixtureRun();
  input.before.bytes += ' ';
  assert.ok(codes(input).includes('HASH_MISMATCH'));
  assert.ok(codes(changeArtifact(fixtureRun(), 'benchmark', rows => { rows[0].args.query = 'altered'; })).includes('CASE_BINDING_MISMATCH'));
  assert.ok(codes(changeArtifact(fixtureRun(), 'observations', rows => { rows[0].args.query = 'altered'; })).includes('CASE_BINDING_MISMATCH'));
  assert.ok(codes(changeArtifact(fixtureRun(), 'registered_tools', value => value.tools.pop())).includes('TOOLSET_MISMATCH'));
});
test('missing snapshots and claimed only summary fail', () => {
  const input = fixtureRun();
  delete input.after;
  assert.ok(codes(input).includes('MISSING_PROVENANCE'));
  input.observations = artifact({ summary: { percent: 100 } });
  assert.ok(codes(input).includes('INCOMPLETE_RUN'));
});
test('invalid latency rejected missing latency explicitly unmeasured', () => {
  assert.ok(codes(changeArtifact(fixtureRun(), 'observations', rows => { rows[0].latency_ms = -1; })).includes('INVALID_LATENCY'));
  assert.ok(codes(changeArtifact(fixtureRun(), 'observations', rows => { rows[0].latency_ms = 'NaN'; })).includes('INVALID_LATENCY'));
  const input = changeArtifact(fixtureRun(), 'observations', rows => rows.forEach(row => { row.latency_ms = null; }));
  assert.equal(report(input).dimensions.latency.status, 'NOT_EVALUATED');
  assert.equal(report(input).dimensions.latency.p95, null);
});
test('source pin binding cannot relabel stale content', () => {
  const input = changeArtifact(fixtureRun(), 'observations', rows => {
    rows[0].response.structuredContent.data.revision = 'old';
    rows[0].source_pins = [{ response_pointer: '/revision', status_pointer: '/faq_129/revision' }];
  });
  assert.ok(codes(input).includes('MIXED_REVISIONS'));
});
test('statistics revisions compare dataset IDs ignoring refresh timestamps and order', () => {
  const input = changeArtifact(fixtureRun(), 'after', status => {
    status.statistics.datasets.reverse();
    status.statistics.datasets[0].checked_at = 'later';
  });
  assert.deepEqual(codes(input), []);
  changeArtifact(input, 'after', status => { status.statistics.datasets[0].revision = 'new'; });
  assert.ok(codes(input).includes('MIXED_REVISIONS'));
});
