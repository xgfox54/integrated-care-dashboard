import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { evaluateCase as evaluateBase } from './evaluate-balanced-search.mjs';
import { manualQuoteMatches } from './eval-checks.mjs';
export const SUITE = JSON.parse(readFileSync(new URL('../../quality/balanced-search-20261015.json', import.meta.url), 'utf8'));
export const CASES = SUITE.cases;
if (createHash('sha256').update(JSON.stringify(CASES)).digest('hex') !== SUITE.cases_sha256)
    throw new Error('SUITE_HASH_MISMATCH');
const norm = v => String(v ?? '').normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '').toLowerCase();
const bodyOf = r => r?.result?.structuredContent;
const itemsOf = b => { const p = b?.data ?? b; return Array.isArray(p) ? p : p?.results ?? p?.items ?? p?.institutions ?? []; };
const idOf = i => i.id ?? i.implementation_id ?? i.fiscal_project_id ?? i.budget_line_id ?? i.institution_id ?? i.article_id;
export function selectedHit(entry, response) {
    const items = itemsOf(bodyOf(response));
    const e = entry.expect;
    return items.find(i => e.ids ? e.ids.includes(idOf(i)) : e.datasetId ? i.dataset_id === e.datasetId : e.sectionIds ? e.sectionIds.includes(i.section_id) : e.manualDocument ? i.document_id === e.manualDocument : e.title ? norm([i.title, i.name, i.question].join(' ')).includes(norm(e.title)) : true);
}
export function evaluateExpandedCase(entry, response, detail = null) {
    const base = evaluateBase(entry, response);
    const checks = [...base.checks];
    const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });
    const b = bodyOf(response), p = b?.data ?? b, items = itemsOf(b), e = entry.expect, hit = selectedHit(entry, response), detailBody = bodyOf(detail), d = detailBody?.data ?? detailBody;
    if (e.unsupported)
        check('explicit_answerability', typeof p?.answerability === 'string' && ['UNSUPPORTED', 'PARTIAL', 'INSUFFICIENT', 'INSUFFICIENT_EVIDENCE'].includes(p.answerability));
    if (e.status)
        check('explicit_source_status', p?.status === e.status && p?.reason_code === e.reasonCode);
    if (e.ids)
        check('exact_record_identity', Boolean(hit));
    if (e.manualDocument)
        check('expected_manual_document', hit?.document_id === e.manualDocument);
    if (e.sectionIds)
        check('expected_manual_section', Boolean(hit) && e.sectionIds.includes(hit.section_id));
    if (e.sourceYear)
        check('source_year_not_fetch_date', hit?.sources?.[0]?.source_year === e.sourceYear);
    if (e.sourceQuotes) {
        const text = (hit?.answer_criteria?.requirements ?? []).map(r => r.source_quote).join('\n');
        check('source_conditions_and_exceptions', e.sourceQuotes.every(q => norm(text).includes(norm(q))));
    }
    if (e.writtenDate)
        check('original_written_date', hit?.answer_criteria?.basis?.written_date === e.writtenDate);
    if (e.resultRegion)
        check('requested_region_only', items.length > 0 && items.every(i => i.region?.region_id === e.resultRegion));
    if (e.datasetId)
        check('connected_dataset_identity', hit?.dataset_id === e.datasetId && hit?.data_available === true);
    if (e.detailCheck) {
        check('successful_detail', Boolean(d) && !detail?.error && !detail?.result?.isError);
        if (e.detailCheck === 'manual_source') {
            check('manual_quote_matches_detail', Boolean(hit) && manualQuoteMatches(hit.excerpt ?? '', d?.text ?? ''));
            check('detail_source_identity', d?.section_id === hit?.section_id && Boolean(d?.sources?.[0]?.content_sha256) && d?.sources?.[0]?.content_sha256 === hit?.sources?.[0]?.content_sha256);
        }
        if (e.detailCheck === 'statistic') {
            check('observed_periods', e.periods.every(year => d?.dataset?.periods?.includes(year)));
            check('original_unit', norm(d?.dataset?.original_unit) === norm(e.unit));
            check('numeric_points', d?.dataset?.series?.some(s => s.points?.some(point => ['VALUE', 'ESTIMATE'].includes(point.status) && typeof point.value === 'number')));
        }
    }
    if (e.fiscalYear)
        check('requested_fiscal_year', items.length > 0 && items.every(i => String(i.fiscal_year) === String(e.fiscalYear)));
    if (e.amountKRW !== undefined)
        check('exact_document_amount', hit?.amount_krw === e.amountKRW && hit?.amount_semantics === 'DOCUMENT_STAGE_AMOUNT');
    if (e.documentRevision)
        check('document_revision_and_year', hit?.document_revision_id === e.documentRevision && p?.revisions?.some(r => r.document_revision_id === e.documentRevision && String(r.fiscal_year) === String(entry.args.fiscal_year)));
    if (e.newsContract) {
        check('official_metadata_not_generated_text', items.length > 0 && items.every(i => i.source_kind === 'OFFICIAL_PRESS_RELEASE' && i.content_scope === 'metadata_only' && typeof i.original_url === 'string' && i.original_url.startsWith('https://')));
        if (entry.args.date_from || entry.args.date_to)
            check('publication_date_bounds', items.length > 0 && items.every(i => i.published_date && (!entry.args.date_from || i.published_date >= entry.args.date_from) && (!entry.args.date_to || i.published_date <= entry.args.date_to)));
        if (entry.args.region_ids)
            check('publisher_jurisdiction', items.length > 0 && items.every(i => entry.args.region_ids.some(region => region === 'region:' + i.publisher_region?.sido + (region.includes('|') ? '|' + i.publisher_region?.sigungu : ''))));
    }
    if (e.institutionContract) {
        check('institution_region', items.length > 0 && items.every(i => i.region_name === entry.args.region_id.replace('region:', '').replace('|', ' ')));
        check('institution_service_group', items.length > 0 && items.every(i => i.service_types?.some(t => t.group === entry.args.service_group)));
        check('unverified_operation_not_asserted', items.every(i => i.verification?.current_operation === 'NOT_VERIFIED' && i.verification?.vacancy === 'NOT_COLLECTED'));
    }
    return { ...base, checks, pass: checks.every(c => c.pass), observations: { ...base.observations, selected_id: hit ? idOf(hit) : null, selected_section: hit?.section_id, detail_error: detail?.error ?? (detail?.result?.isError ? detail.result.content : null) } };
}
export function summarize(results) { const complete = results.length === CASES.length && new Set(results.map(r => r.id)).size === CASES.length && CASES.every(c => results.some(r => r.id === c.id && r.tool === c.tool)); const tools = [...new Set(CASES.map(c => c.tool))]; const domains = tools.map(tool => { const rows = results.filter(r => r.tool === tool); return { tool, tested: rows.length, passed: rows.filter(r => r.pass).length, percent: rows.length ? rows.filter(r => r.pass).length / rows.length * 100 : 0 }; }); const positiveIds = new Set(CASES.filter(c => c.expect.nonempty).map(c => c.id)); const positives = results.filter(r => positiveIds.has(r.id)); return { suite: SUITE.version, suite_sha256: SUITE.cases_sha256, final_answer_accuracy: 'NOT_EVALUATED', gpt_answer_calls: 0, total: results.length, passed: results.filter(r => r.pass).length, complete, macro_percent: domains.reduce((s, d) => s + d.percent, 0) / tools.length, minimum_domain_percent: Math.min(...domains.map(d => d.percent)), gate_passed: complete && domains.every(d => d.percent >= 95), positive_retrieval: { tested: positives.length, passed: positives.filter(r => r.pass).length }, domains }; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [endpoint, out, recordedPath] = process.argv.slice(2);
    if (!endpoint || !out)
        throw new Error('Usage: evaluate-balanced-expanded.mjs MCP_URL OUTPUT_DIRECTORY [RESPONSES_JSON]');
    await mkdir(out, { recursive: true });
    const recorded = recordedPath ? JSON.parse(await readFile(recordedPath, 'utf8')) : null;
    const observations = [], results = [];
    let nextCall = 0;
    const call = async (name, args) => { await new Promise(done => setTimeout(done, Math.max(0, nextCall - Date.now()))); nextCall = Date.now() + 1650; for (let retry = 0; retry < 4; retry++) {
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(60000) });
            const text = await response.text();
            if ((response.status === 429 || text.includes('DATA_SOURCE_BUSY')) && retry < 3) {
                await new Promise(done => setTimeout(done, Math.min(60000, Math.max(5000, Number(response.headers.get('retry-after') ?? 15) * 1000))));
                continue;
            }
            const line = text.split('\n').find(x => x.startsWith('data:'));
            const reply = JSON.parse(line ? line.slice(5) : text);
            if (reply.result?.structuredContent)
                reply.result.content = [];
            return reply;
        }
        catch (error) {
            if (retry === 3)
                return { error: { code: 'REQUEST_FAILED', message: String(error) } };
        }
    } };
    const save = async () => { await writeFile(resolve(out, 'responses.json'), JSON.stringify(observations)); await writeFile(resolve(out, 'evaluation.json'), JSON.stringify({ generated_at: new Date().toISOString(), endpoint, summary: summarize(results), results }, null, 2)); };
    for (const c of CASES) {
        let response, detail = null;
        const saved = recorded?.find(r => r.id === c.id);
        if (recorded) {
            response = saved?.response;
            detail = saved?.detail;
        }
        else {
            response = await call(c.tool, c.args);
            const hit = selectedHit(c, response);
            if (hit && c.expect.detailCheck === 'statistic')
                detail = await call('get_statistics_data', { statistics_id: c.expect.datasetId });
            if (hit && c.expect.detailCheck === 'manual_source') {
                detail = await call('get_manual_section', { section_id: hit.id, limit: 8000 });
                let part = bodyOf(detail)?.data;
                for (let n = 0; n < 15 && part?.next_offset !== null && part?.next_offset !== undefined && !manualQuoteMatches(hit.excerpt ?? '', bodyOf(detail)?.data?.text ?? ''); n++) {
                    const continuation = await call('get_manual_section', { section_id: hit.id, offset: part.next_offset, limit: 8000 });
                    part = bodyOf(continuation)?.data;
                    if (!part)
                        break;
                    detail.result.structuredContent.data.text += part.text;
                }
            }
        }
        observations.push({ id: c.id, response, detail });
        const result = evaluateExpandedCase(c, response, detail);
        results.push(result);
        console.log(JSON.stringify({ id: c.id, tool: c.tool, pass: result.pass, failed: result.checks.filter(x => !x.pass).map(x => x.name) }));
        if (results.length % 10 === 0)
            await save();
    }
    await save();
    console.log(JSON.stringify(summarize(results)));
    process.exitCode = summarize(results).gate_passed ? 0 : 1;
}
