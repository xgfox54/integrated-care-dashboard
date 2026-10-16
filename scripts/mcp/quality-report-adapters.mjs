import { CASES, evaluateCase, summarize as summarizeBalanced } from './evaluate-balanced-search.mjs';
import { evaluateRecord, summarize as summarizeGolden, validateGolden, evaluationProfile } from './evaluate-golden-qa.mjs';
import { canonical } from './quality-report-schema.mjs';

export function benchmarkCases(name, benchmark) {
  if (name === 'balanced') {
    if (canonical(benchmark) !== canonical(CASES)) throw new Error('CASE_BINDING_MISMATCH');
    return CASES;
  }
  return validateGolden(benchmark).items.map(item => ({ ...item, tool: 'search', args: { query: item.question } }));
}

export function evaluateSuite(name, input) {
  const { cases, observations, benchmark, before, after } = input;
  if (name === 'balanced') {
    const results = cases.map(item => evaluateCase(item, observations.find(row => row.id === item.id)?.response));
    const summary = summarizeBalanced(results);
    return { results, summary, gate_passed: summary.gate_passed };
  }
  const results = cases.map(item => evaluateRecord(item, observations.find(row => row.id === item.id)?.response, { evaluation_profile: evaluationProfile(benchmark) }));
  const summary = summarizeGolden(results, { evaluation_profile: evaluationProfile(benchmark), expected_ids: cases.map(item => item.id),
    start: { dataset_status: before }, end: { dataset_status: after } });
  // Golden checks describe source retrieval, never generated-answer correctness.
  const passed = results.filter(row => row.search_success && row.program_recall_at?.[5] === true && row.document_recall_at?.[5] === true).length;
  return { results, summary, gate_passed: results.length === cases.length && passed / cases.length >= .95,
    retrieval_passed: passed, limitation: 'Golden gate requires program and expected-document recall@5 on at least 95% of the full benchmark; FAQ source-only profiles cannot certify this gate.' };
}
