import { RunSchema, ObservationSchema, canonical, decodeArtifact, payload, pointer, sha256 } from './quality-report-schema.mjs';
import { benchmarkCases, evaluateSuite } from './quality-report-adapters.mjs';
import { CASES } from './evaluate-balanced-search.mjs';

function sourcePins(value, path = '', pins = {}) {
  if (!value || typeof value !== 'object') return pins;
  for (const [key, child] of Object.entries(value)) {
    const at = path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
    if (/^(revision|component)$/.test(key) && ['string', 'number'].includes(typeof child)) pins[at] = child;
    else if (child && typeof child === 'object') sourcePins(child, at, pins);
  }
  return pins;
}

function revisionIdentity(status, pins) {
  return Object.fromEntries(Object.entries(pins).map(([path, revision]) => {
    let cursor = status;
    const identity = path.slice(1).split('/').map(token => {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
      const normalized = Array.isArray(cursor) && cursor[key]?.id ? '@' + cursor[key].id : token;
      cursor = cursor?.[key];
      return normalized;
    }).join('/');
    return [identity, revision];
  }));
}

export function validateQualityRun(input, options = {}) {
  const errors = [];
  const reject = (code, detail) => errors.push({ code, detail });
  const runParsed = RunSchema.safeParse(input.run);
  if (!runParsed.success) reject('MISSING_PROVENANCE', 'Invalid captured run metadata');
  const decoded = {};
  const evidence = {};
  for (const key of ['benchmark', 'observations', 'before', 'after', 'registered_tools']) {
    try { decoded[key] = decodeArtifact(input[key]); evidence[key] = { path: input[key].path, sha256: input[key].sha256 }; }
    catch (error) { reject(error.message, key); }
  }
  let cases = input.name === 'balanced' ? CASES : [];
  try { cases = benchmarkCases(input.name, decoded.benchmark); }
  catch (error) { reject(error.message === 'CASE_BINDING_MISMATCH' ? error.message : 'CASE_BINDING_MISMATCH', 'Invalid benchmark'); }
  const parsedRows = (Array.isArray(decoded.observations) ? decoded.observations : []).map(row => ObservationSchema.safeParse(row));
  if (parsedRows.some(row => !row.success)) reject('CASE_BINDING_MISMATCH', 'Malformed observation record');
  const observations = parsedRows.filter(row => row.success).map(row => row.data);
  if (!Array.isArray(decoded.observations)) reject('INCOMPLETE_RUN', 'Raw observation array required; supplied summaries are not evidence');
  const ids = observations.map(row => row?.id);
  if (ids.length !== cases.length || new Set(ids).size !== ids.length || cases.some(item => !ids.includes(item.id)) || ids.some(id => !cases.some(item => item.id === id))) reject('INCOMPLETE_RUN', 'Missing, duplicate or unknown case IDs');
  const tools = decoded.registered_tools;
  if (!['tools/list', 'enabled_app_tool_metadata'].includes(tools?.basis) || !Array.isArray(tools?.tools)) reject('MISSING_PROVENANCE', 'Captured registered tools and truthful basis required');
  const names = (Array.isArray(tools?.tools) ? tools.tools : []).map(tool => tool?.name);
  if (cases.some(item => !names.includes(item.tool)) || input.name === 'golden' && !names.includes('fetch')) reject('TOOLSET_MISMATCH', 'Expected tool absent from captured toolset');
  for (const row of observations) {
    const expected = cases.find(item => item.id === row?.id);
    if (!expected || row.tool !== expected.tool || canonical(row.args) !== canonical(expected.args) || !row.response || typeof row.response !== 'object') reject('CASE_BINDING_MISMATCH', row?.id);
    if (input.name === 'golden' && (row.response?.question !== expected?.question || row.response?.search?.arguments?.query !== expected?.question)) reject('CASE_BINDING_MISMATCH', row?.id + ': question/search arguments');
    if (row.latency_ms !== null && (!Number.isFinite(row.latency_ms) || row.latency_ms < 0)) reject('INVALID_LATENCY', row?.id);
  }
  const before = payload(decoded.before), after = payload(decoded.after);
  const revisions = sourcePins(before), endRevisions = sourcePins(after);
  const revisionPointers = input.revision_pointers ?? [];
  if (!revisionPointers.length || !Object.keys(revisions).length) reject('MISSING_PROVENANCE', 'Source revision pointers required');
  for (const path of revisionPointers) {
    const a = pointer(before, path), b = pointer(after, path);
    if (!['string', 'number'].includes(typeof a) || !['string', 'number'].includes(typeof b)) reject('MISSING_PROVENANCE', path);
    else { revisions[path] = a; endRevisions[path] = b; }
  }
  if (canonical(revisionIdentity(before, revisions)) !== canonical(revisionIdentity(after, endRevisions))) reject('MIXED_REVISIONS', 'Source revision snapshots differ');
  const bundle = before?.release_bundle?.release_bundle_id ?? before?.release_bundle_id;
  const endBundle = after?.release_bundle?.release_bundle_id ?? after?.release_bundle_id;
  if (!bundle || !endBundle || !before?.server_version || !after?.server_version) reject('MISSING_PROVENANCE', 'Both bundle IDs and observed server versions required');
  if (bundle !== endBundle || before?.server_version !== after?.server_version || new Set(input.run?.server_versions).size !== 1 || input.run?.server_versions?.[0] !== before?.server_version) reject('MIXED_REVISIONS', 'Bundle or server version changed');
  for (const row of observations) {
    const observed = input.name === 'golden' ? [row.response?.search?.result, ...(row.response?.fetched ?? []).map(item => item.result ?? item.response)] : [row.response];
    for (const raw of observed) {
      const data = payload(raw), envelope = raw?.result?.structuredContent ?? raw?.structuredContent ?? raw;
      const version = data?.server_version ?? data?.metadata?.server_version;
      const release = data?.release_bundle_id ?? data?.metadata?.release_bundle_id ?? envelope?.release_bundle_id;
      if (version && version !== before?.server_version || release && release !== bundle) reject('MIXED_REVISIONS', row.id + ': response provenance');
      for (const [key, path] of [['gov24_revision', '/gov24/revision'], ['manual_revision', '/manuals/revision'], ['faq129_revision', '/faq_129/revision']]) {
        const revision = data?.[key] ?? data?.metadata?.[key];
        if (revision != null && pointer(before, path) != null && revision !== pointer(before, path)) reject('MIXED_REVISIONS', row.id + ': ' + key);
      }
    }
    for (const pin of row.source_pins ?? []) {
      const value = pointer(payload(row.response), pin.response_pointer);
      if (!Object.hasOwn(revisions, pin.status_pointer) || value == null) reject('MISSING_PROVENANCE', row.id + ': source pin');
      else if (value !== revisions[pin.status_pointer]) reject('MIXED_REVISIONS', row.id + ': source pin');
    }
  }
  const now = options.now ?? Date.now();
  const started = Date.parse(input.run?.started_at), ended = Date.parse(input.run?.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started || ended > now + 60_000) reject('MISSING_PROVENANCE', 'Invalid run interval');
  if (options.profile !== 'historical' && now - started > 86_400_000) reject('STALE_RUN', 'Collection started more than 24 hours ago');
  let evaluation = null;
  try { if (cases.length) evaluation = evaluateSuite(input.name, { cases, observations, benchmark: decoded.benchmark, before: decoded.before, after: decoded.after }); }
  catch { reject('CASE_BINDING_MISMATCH', 'Malformed raw response cannot be evaluated'); }
  return { name: input.name, run: input.run, profile: options.profile ?? 'current', errors, cases, observations, evaluation, evidence,
    source_revisions: Object.entries(revisions).map(([basis_pointer, revision]) => ({ basis_pointer, revision, artifact: evidence.before })),
    release_bundle_id: bundle ?? null, toolset_basis: tools?.basis ?? null,
    response_evidence: observations.map(row => ({ id: row.id, sha256: sha256(canonical(row.response) ?? 'null'), artifact: evidence.observations })) };
}

const emptyDimension = (expected, evidence) => ({ status: 'NOT_EVALUATED', expected, observed: 0, applicable: 0, passed: 0, failed: 0, missing: 0, numerator: null, denominator: 0, unit: 'cases', evidence });
function dimension(expected, results, predicate, evidence) {
  const relevant = results.filter(predicate), passed = relevant.filter(row => row.pass).length;
  return { status: relevant.length < expected ? 'INCOMPLETE' : 'EVALUATED', expected, observed: relevant.length, applicable: expected,
    passed, failed: relevant.length - passed, missing: Math.max(0, expected - relevant.length), numerator: passed, denominator: expected, unit: 'cases', evidence };
}

export function buildQualityReport(validatedRun) {
  const { cases, observations, evaluation, evidence, errors } = validatedRun;
  const refs = Object.values(evidence), results = evaluation?.results ?? [];
  const observedIds = new Set(observations.map(row => row.id));
  const present = results.filter(row => observedIds.has(row.id));
  const retrievalRows = validatedRun.name === 'balanced' ? present : present.map(row => ({ ...row, pass: row.search_success && row.program_recall_at?.[5] === true && row.document_recall_at?.[5] === true }));
  const dimensions = Object.fromEntries(['retrieval_contract', 'unsupported_handling', 'citation_integrity', 'condition_preservation', 'source_identity', 'latency', 'generated_answer_accuracy'].map(name => [name, emptyDimension(cases.length, refs)]));
  dimensions.retrieval_contract = dimension(cases.length, retrievalRows, () => true, refs);
  if (validatedRun.name === 'balanced') {
    const unsupported = cases.filter(item => item.expect.empty || item.expect.unsupported || item.expect.unavailable || item.expect.error || item.expect.yearScope || item.expect.state);
    dimensions.unsupported_handling = dimension(unsupported.length, present, row => unsupported.some(item => item.id === row.id), refs);
    const conditionCases = cases.filter(item => item.tool === 'search_faq' && !item.expect.empty);
    const conditionRows = present.filter(row => conditionCases.some(item => item.id === row.id)).map(row => ({ ...row, pass: row.checks.some(check => check.name === 'condition_paragraphs_preserved' && check.pass) }));
    dimensions.condition_preservation = dimension(conditionCases.length, conditionRows, () => true, refs);
  }
  const durations = observations.map(row => row.latency_ms).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  dimensions.latency = { ...emptyDimension(cases.length, refs), status: durations.length ? durations.length === cases.length ? 'EVALUATED' : 'INCOMPLETE' : 'NOT_EVALUATED', observed: durations.length, applicable: cases.length,
    missing: cases.length - durations.length, numerator: durations.length, denominator: cases.length, unit: 'milliseconds', sample_count: durations.length,
    p50: durations.length ? durations[Math.ceil(durations.length * .5) - 1] : null, p95: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null, max: durations.at(-1) ?? null };
  if (errors.length) dimensions.retrieval_contract.status = 'INVALID';
  const passed = !errors.length && evaluation?.gate_passed === true;
  return { schema_version: 'quality-report-1', run: validatedRun.run, benchmark: { suite: validatedRun.name, ...evidence.benchmark, expected_case_ids: cases.map(item => item.id), domain_mapping: cases.map(item => ({ id: item.id, domain: item.tool })) },
    dimensions, gates: { retrieval_passed: passed, release_eligible: passed && validatedRun.profile === 'current', generated_answer_passed: false },
    errors, source_revisions: validatedRun.source_revisions, release_bundle_id: validatedRun.release_bundle_id, toolset_basis: validatedRun.toolset_basis,
    response_evidence: validatedRun.response_evidence, evaluation,
    limitations: ['Retrieval contract performance is not generated-answer accuracy.', 'Citation integrity and source-identity correctness require independent evidence and are NOT_EVALUATED.',
      'Source revision equality uses captured snapshots and supplied response pins; absent per-response revisions are not reconstructed.',
      ...(validatedRun.profile === 'historical' ? ['Historical evidence is non-promotable.'] : []), ...(evaluation?.limitation ? [evaluation.limitation] : [])] };
}
