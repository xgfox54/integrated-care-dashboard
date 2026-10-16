import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ManifestSchema, decodeArtifact, canonical } from './quality-report-schema.mjs';
import { validateQualityRun, buildQualityReport } from './quality-report.mjs';
import { evaluateActualAnswers } from './evaluate-actual-answers.mjs';

async function loadArtifact(root, ref) {
  const bytes = await readFile(resolve(root, ref.path), 'utf8');
  const artifact = { ...ref, path: resolve(root, ref.path), bytes };
  decodeArtifact(artifact);
  return artifact;
}

export async function runQualityReport(manifestPath, options = {}) {
  const root = dirname(resolve(manifestPath));
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const profile = options.profile ?? 'current';
  if (!['current', 'historical'].includes(profile)) throw new Error('INVALID_PROFILE');
  const suites = {}, errors = [];
  for (const name of new Set([...manifest.required_suites, ...Object.keys(manifest.suites)])) {
    const spec = manifest.suites[name];
    if (!spec) { errors.push({ suite: name, code: 'INCOMPLETE_RUN', detail: 'Required suite missing' }); continue; }
    const input = { name, run: spec.run, revision_pointers: spec.revision_pointers };
    for (const key of ['benchmark', 'observations', 'before', 'after', 'registered_tools']) {
      try { input[key] = await loadArtifact(root, spec[key]); }
      catch (error) { errors.push({ suite: name, code: error.message === 'HASH_MISMATCH' ? 'HASH_MISMATCH' : 'MISSING_PROVENANCE', detail: key }); }
    }
    suites[name] = buildQualityReport(validateQualityRun(input, { profile, now: options.now }));
  }
  let actual = { status: 'NOT_EVALUATED', numerator: null, denominator: 0, gate_passed: false };
  if (manifest.actual_answers) {
    try {
      const spec = manifest.actual_answers;
      const benchmark = decodeArtifact(await loadArtifact(root, spec.benchmark));
      const observations = decodeArtifact(await loadArtifact(root, spec.observations));
      const review = await evaluateActualAnswers(benchmark, observations, resolve(root, spec.evidence_root));
      actual = { status: 'EVALUATED', numerator: review.actual_answer_accuracy.correct, denominator: review.actual_answer_accuracy.denominator, gate_passed: review.actual_answer_accuracy.gate_passed, review };
    } catch (error) { actual = { status: 'INVALID', numerator: null, denominator: 50, gate_passed: false, error: { code: error.code ?? 'INVALID_ACTUAL_ANSWER_EVIDENCE', message: error.message } }; }
  }
  const required = manifest.required_suites.map(name => suites[name]);
  const invalid = required.some(suite => !suite || suite.errors.length) || errors.some(error => manifest.required_suites.includes(error.suite));
  const passed = !invalid && required.every(suite => suite.gates.retrieval_passed);
  const identities = Object.values(suites).map(suite => canonical({ server: suite.run.server_versions, bundle: suite.release_bundle_id, revisions: suite.source_revisions.map(({ basis_pointer, revision }) => ({ basis_pointer, revision })) }));
  return { schema_version: 'quality-report-1', profile, required_suites: manifest.required_suites, benchmarks: suites,
    dimensions: { generated_answer_accuracy: actual }, errors,
    comparison_compatibility: identities.length < 2 ? 'SINGLE_SUITE' : new Set(identities).size === 1 ? 'SAME_CAPTURED_REVISIONS' : 'INCOMPATIBLE_REVISIONS',
    gates: { retrieval_passed: passed, generated_answer_passed: actual.gate_passed, release_eligible: passed && profile === 'current' },
    exit_code: invalid ? 2 : passed ? 0 : 1,
    limitations: ['Suites retain separate denominators and are never averaged into answer accuracy.', 'Only explicitly required suites control the retrieval gate.', 'Artifact hashes establish local integrity, not independent authentication of the capture.'] };
}

export function renderQualityReport(report) {
  const lines = ['# Quality evidence report', '', `Profile: ${report.profile ?? 'invalid'}`, `Release eligible: ${report.gates.release_eligible}`, `Retrieval gate: ${report.gates.retrieval_passed}`, `Generated-answer accuracy: ${report.dimensions?.generated_answer_accuracy?.status ?? 'NOT_EVALUATED'}`, '', '| Suite | Retrieval contract | Expected | Observed | Passed | Missing | Macro |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [name, suite] of Object.entries(report.benchmarks ?? {})) {
    const d = suite.dimensions.retrieval_contract;
    lines.push(`| ${name} | ${d.status} | ${d.expected} | ${d.observed} | ${d.passed} | ${d.missing} | ${suite.evaluation?.summary?.macro_percent ?? 'separate golden metrics'} |`, '', `Run: ${suite.run.run_id}; server ${suite.run.server_versions.join(', ')}; toolset basis ${suite.toolset_basis}.`, `Bundle: ${suite.release_bundle_id}.`, '', '| Dimension | Status | Numerator / denominator | Missing |', '| --- | --- | --- | ---: |');
    for (const [key, value] of Object.entries(suite.dimensions)) lines.push(`| ${key} | ${value.status} | ${value.numerator ?? 'unmeasured'} / ${value.denominator} | ${value.missing} |`);
    lines.push('', `Latency: ${JSON.stringify(suite.dimensions.latency)}`, '', ...suite.errors.map(error => `- ${error.code}: ${error.detail}`), ...suite.limitations.map(limit => `- ${limit}`), '');
  }
  lines.push('', ...(report.errors ?? []).map(error => `- ${error.code}: ${error.detail}`), ...(report.limitations ?? []).map(limit => `- ${limit}`), '', `Exit code: ${report.exit_code}`, '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let output;
  try {
    const args = process.argv.slice(2), values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--manifest', '--output', '--profile'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw new Error('USAGE: --manifest FILE --output DIR --profile current|historical');
      values[args[i]] = args[i + 1];
    }
    output = values['--output'];
    if (!values['--manifest'] || !output) throw new Error('USAGE: --manifest FILE --output DIR --profile current|historical');
    const report = await runQualityReport(values['--manifest'], { profile: values['--profile'] });
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'quality.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(resolve(output, 'REPORT.md'), renderQualityReport(report));
    process.exitCode = report.exit_code;
  } catch (error) {
    const report = { schema_version: 'quality-report-1', gates: { retrieval_passed: false, release_eligible: false, generated_answer_passed: false }, errors: [{ code: 'INVALID_MANIFEST', detail: error.message }], exit_code: 2 };
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(resolve(output, 'quality.json'), JSON.stringify(report, null, 2) + '\n');
      await writeFile(resolve(output, 'REPORT.md'), renderQualityReport(report));
    }
    console.error(JSON.stringify(report));
    process.exitCode = 2;
  }
}
