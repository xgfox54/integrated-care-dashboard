import { CASES } from './evaluate-balanced-search.mjs';
import { sha256 } from './quality-report-schema.mjs';

export function artifact(value, path = 'fixture.json') {
  const bytes = JSON.stringify(value);
  return { path, bytes, sha256: sha256(bytes) };
}

export function fixtureRun() {
  const response = item => {
    const e = item.expect;
    const fields = Object.fromEntries(['eligibility', 'income_assets', 'documents', 'period', 'overlap_restrictions', 'exceptions'].map(key => [key, []]));
    const hit = { id: e.budgetId ?? item.id, title: e.title ?? 'fixture', data_available: true, dataset_id: 'dataset', unit_verification: 'VERIFIED',
      structured_conditions: { condition_fields: { extraction_status: 'PARAGRAPH_ROUTING_ONLY', fields } }, scope_flags: ['YEAR_MISMATCH'], freshness: { status: 'HISTORICAL' } };
    return { structuredContent: { data: { results: e.empty || e.error || e.unavailable ? [] : [hit], answerability: 'UNSUPPORTED', reason_codes: ['YEAR_MISMATCH'],
      query_plan: { region_id: e.region, fact_types: e.facts }, status: e.unavailable ? 'UNAVAILABLE' : 'OK', reason_code: e.unavailable ? 'NO_PUBLISHED_SNAPSHOT' : undefined,
      state: e.state, total: null }, ...(e.scopeNote ? { warnings: [e.scopeNote] } : {}), ...(e.error ? { error: { code: e.error } } : {}) } };
  };
  const status = { server_version: '1.12.0', release_bundle: { release_bundle_id: 'rb_fixture' }, faq_129: { revision: 'faq_fixture' }, statistics: { datasets: [{ id: 'one', revision: 'v1' }, { id: 'two', revision: 'v2' }] } };
  return { name: 'balanced', run: { run_id: 'synthetic-unit-fixture', started_at: new Date(Date.now() - 1000).toISOString(), completed_at: new Date().toISOString(), code_commit: 'a'.repeat(40), endpoint_label: 'synthetic-unit-fixture', server_versions: ['1.12.0'], server_version_basis: 'get_dataset_status' },
    benchmark: artifact(CASES, 'benchmark.json'), observations: artifact(CASES.map((item, index) => ({ id: item.id, tool: item.tool, args: item.args, response: response(item), latency_ms: index + 1 })), 'observations.json'),
    before: artifact(status, 'before.json'), after: artifact(status, 'after.json'), registered_tools: artifact({ basis: 'enabled_app_tool_metadata', tools: [...new Set(CASES.map(item => item.tool))].map(name => ({ name })) }, 'tools.json'), revision_pointers: ['/faq_129/revision'] };
}

export function changeArtifact(input, key, edit) {
  const value = JSON.parse(input[key].bytes);
  edit(value);
  input[key] = artifact(value, input[key].path);
  return input;
}
