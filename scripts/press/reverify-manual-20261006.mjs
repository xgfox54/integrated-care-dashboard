// Local, metadata-only review. Never writes a database or saves response bodies.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { politeFetch, links, detailPattern, setIgnoreRobots } from './discover.mjs';
import { parseHtmlBoard } from '../../lib/press/html-board.ts';
import { robotsVerdict } from '../../lib/press/robots.ts';
import { cleanText } from '../../lib/press/rss.ts';

const root = new URL('../../', import.meta.url);
const inputPath = 'docs/press/discovery/robots-exempt-2026-10-06.json';
const source = JSON.parse(readFileSync(new URL(inputPath, root), 'utf8'));
const evidence = new URL('.omo/evidence/press-manual-20261006/', root);
mkdirSync(evidence, { recursive: true });
const mode = process.argv[2] ?? 'probe';
const only = process.argv[3];
const clean = (text) => text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const safeUrl = (value) => {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/;jsessionid=[^/]*/gi, '');
  for (const key of [...url.searchParams.keys()]) if (/token|session|api.?key|servicekey|auth/i.test(key)) url.searchParams.delete(key);
  return url.toString();
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const targets = source.results.filter((row) => row.status === 'CANDIDATE_NEEDS_REVIEW');
const boundary = source.results.filter((row) => row.status !== 'AUTO_VERIFIED' && row.status !== 'CANDIDATE_NEEDS_REVIEW' || ['남양주시', '산청군'].includes(row.name));
const filename = (row) => encodeURIComponent(row.id).replaceAll('%', '_');
const sanitize = (text) => text.replace(/;jsessionid=[a-z0-9]+/gi, '').replace(/([?&](?:amp;)?token=)[^&"'\\\s]*/gi, '$1[REMOVED]');
const write = (name, data) => writeFileSync(new URL(name, evidence), sanitize(JSON.stringify(data, null, 2)) + '\n');
const configPath = new URL('docs/press/discovery/manual-profiles-20261006.json', root);
const configs = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
setIgnoreRobots(true);

function security(response) {
  if ([401, 403, 407, 429, 451].includes(response.status)) return 'HTTP_' + response.status;
  if (/javascript/i.test(response.contentType ?? '') && !/<html\b|<!doctype\s+html/i.test(response.text ?? '')) return null;
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(response.text ?? '')?.[1] ?? '');
  if (/captcha|access denied|request rejected|웹.?방화벽|접근.{0,8}차단|비정상.{0,8}접근|보안.{0,8}차단/i.test(title)) return 'SECURITY_PAGE';
  if ((response.text?.length ?? 0) < 15000 && /captcha|웹.?방화벽|접근.{0,8}차단|비정상.{0,8}접근|security policy|request rejected|access denied/i.test(clean(response.text ?? ''))) return 'SECURITY_PAGE';
  return null;
}

async function review(row, scope) {
  const blockedFile = new URL(`routes-${filename(row)}.json`, evidence);
  if (existsSync(blockedFile)) {
    const prior = JSON.parse(readFileSync(blockedFile, 'utf8'));
    const signalFile = new URL('security-signal-review.json', evidence);
    const signal = existsSync(signalFile) ? JSON.parse(readFileSync(signalFile, 'utf8')) : null;
    const falseSignal = signal?.content_type === 'text/javascript' && signal.javascript_functions > 0 && !signal.html_document && prior.requests.some((r)=>r.security && r.response_sha256===signal.sha256 && r.url===signal.url);
    if (prior.requests.some((r)=>r.security) && !falseSignal) {
      const held={...prior, carried_from:`routes-${filename(row)}.json`, no_additional_request:true};
      write(`${mode}-${filename(row)}.json`,held);
      return held;
    }
  }
  const result = { id: row.id, name: row.name, sido: row.sido, scope, previous_status: row.status, checked_at: new Date().toISOString(), invocation: process.argv.slice(1).join(' '), requests: [], status: 'REVIEW_NEEDED', items: [] };
  let count = 0;
  let stopped = false;
  async function get(url, purpose, accept) {
    if (stopped || count >= 8) return null;
    count++;
    const target = safeUrl(url);
    const response = await politeFetch(target, accept);
    const blocked = security(response);
    result.requests.push({ purpose, url: target, final_url: safeUrl(response.url), status: response.status ?? null, error: response.error ?? null, security: blocked, response_sha256: hash(response.text ?? ''), characters: response.text?.length ?? 0, checked_at: new Date().toISOString() });
    if (blocked) { stopped = true; result.status = 'BLOCKED'; result.reason = blocked; }
    return stopped ? null : response;
  }
  const config = configs[row.id] ?? {};
  const endpoint = safeUrl(config.endpoint ?? row.endpoint ?? row.homepage);
  result.endpoint = endpoint;
  result.homepage = safeUrl(row.homepage);
  const robots = await get(new URL('/robots.txt', endpoint).toString(), 'robots_record_only', 'text/plain');
  result.robots = { exception_authorized: true, target: endpoint, verdict: robots?.status ? robotsVerdict(robots.status, robots.text ?? '', 'IntegratedCareDashboard-PressArchive/1.0', new URL(endpoint).pathname + new URL(endpoint).search) : 'UNREADABLE' };
  const response = await get(endpoint, 'official_list');
  if (!response?.ok) {
    result.reason ??= response?.error ?? ('HTTP_' + (response?.status ?? 'STOPPED'));
    if (response?.error || response?.status >= 400) result.status = 'BLOCKED';
    write(`${mode}-${filename(row)}.json`, result);
    return result;
  }
  const html = response.text;
  result.page_title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  result.headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) => clean(m[1])).filter((s) => s.length < 90).slice(-20);
  const pageLinks = links(html, response.url);
  result.list_structure = pageLinks.filter((l)=>l.text.length > 15 && l.text.length < 150 && !/depth[234]|lnb|gnb|banner|sns|share|download|fileDown/i.test(l.attrs)).slice(0,60).map((l)=>({attrs:l.attrs,tags:html.slice(l.index,l.end).match(/<\/?[a-z][^>]*>/gi)}));
  result.title_scripts = config.profile ? pageLinks.filter((l)=>new RegExp(config.profile.link).test(l.attrs)).slice(0,2).flatMap((l)=>[...html.slice(l.index,l.end).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>m[1])) : [];
  result.short_date_cells = [...html.matchAll(/<td\b([^>]*)>\s*(\d{2}[-./]\d{1,2}[-./]\d{1,2})\.?\s*<\/td>/gi)].slice(0,3).map((m)=>({attrs:m[1],date:m[2]}));
  result.date_rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].filter((m)=>/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/.test(m[1])).slice(0,3).map((m)=>({tags:m[1].match(/<\/?[a-z][^>]*>/gi),dates: m[1].match(/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/g)}));
  result.official_feeds = pageLinks.filter((l) => /rss|open.?api|공공데이터|보도.?자료|보도.?해명/i.test(l.text) && l.text.length < 35 && l.absolute).map((l) => ({ label: l.text, url: safeUrl(l.absolute) })).slice(0, 30);
  result.structure = {
    forms: [...html.matchAll(/<form\b[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ')),
    scripts: [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => safeUrl(new URL(m[1].replaceAll('&amp;', '&'), response.url))).filter((s) => /bbs|board|list|post/i.test(s)),
    anchors: pageLinks.filter((l) => /onclick|nttNo|data-req|bIdx|dataSid|articleSeq|read|view|detail|fn_|bbsSeq|data-seq|pstSn/i.test(l.attrs) && !/download|attach|file|depth[234]|zoom|share|sns|window.open|goPage|navi_list|select_linkPage/i.test(l.attrs)).map((l) => ({ attrs: l.attrs, tags: (html.slice(l.index, l.end).match(/<\/?[a-z][^>]*>/gi) ?? []).filter((s) => !/img/i.test(s)).slice(0, 15) })).slice(0,80),
    buttons: [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].filter((m)=>/onclick|data-/i.test(m[1])).map((m)=>({attrs:m[1],tags:m[2].match(/<\/?[a-z][^>]*>/gi)})).slice(-25),
    embeds: [...html.matchAll(/<(?:iframe|frame)[^>]*src=["']([^"']+)["']/gi)].map((m)=>safeUrl(new URL(m[1].replaceAll('&amp;','&'),response.url))),
    date_elements: [...html.matchAll(/<([a-z]+)\b([^>]*)>\s*(20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2})[.\s]*<\//gi)].slice(0,20).map((m)=>({tag:m[1],attrs:m[2],date:m[3]})),
    navigation_code: [...html.matchAll(/function\s+(?:viewMove|doBbsFView|fn_search_detail|fn_icms_bbs_view)[^{]*\{[^}]{0,1600}\}/g)].map((m)=>m[0]),
    dates: [...html.matchAll(/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/g)].map((m) => m[0]).slice(-20),
  };
  const inferred = detailPattern(html, response.url);
  result.inferred_profile = inferred?.profile ?? null;
  if (mode === 'routes') {
    result.routes=[];
    const urls=[...(config.explore ?? []),...result.structure.scripts.slice(0,1)];
    if (!config.profile) urls.push(row.homepage);
    for (const url of [...new Set(urls)].slice(0,4)) {
      const extra=await get(url,'official_route_inspection');
      if (!extra?.ok) continue;
      result.routes.push({url:safeUrl(extra.url),title:clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(extra.text)?.[1]??''),links:links(extra.text,extra.url).filter((l)=>/보도|뉴스|군정|시정|RSS|open.?api/i.test(l.text)&&l.text.length<35&&l.absolute).map((l)=>({text:l.text,url:safeUrl(l.absolute)})).slice(0,40),code: /\.js(?:\?|$)/.test(url) ? extra.text.split('\n').filter((line)=>/\.action|\/view\.|bIdx|bbsSeq|boardSeq|view\s*[:=(]/i.test(line)&&line.length<250).slice(0,35):[]});
    }
  }
  if (config.profile) {
    result.profile = config.profile;
    result.basis = config.basis;
    const items = parseHtmlBoard(html, config.profile).map(({ title, pubDate, link }) => ({ title, date: pubDate, link: safeUrl(link) }));
    result.items = items;
    const rawElements = config.profile.tag === 'button' ? [...html.matchAll(/<button\b([^>]*)>/gi)].map((m)=>m[1]) : pageLinks.map((link)=>link.attrs);
    result.expected_item_count = new Set(rawElements.map((attrs)=>new RegExp(config.profile.link).exec(attrs)?.groups?.id).filter(Boolean)).size;
    result.dated = items.filter((item) => /^20\d{2}-\d{2}-\d{2}$/.test(item.date)).length;
    result.unique_titles = new Set(items.map((item) => item.title)).size;
    result.detail_checks = [];
    for (const item of items.slice(0, 2)) {
      const detail = await get(item.link, 'detail_title_check');
      const compact = (value) => cleanText(clean(value)).replace(/[^\p{L}\p{N}]/gu, '');
      const titleMatch = !!detail?.ok && compact(detail.text).includes(compact(item.title));
      result.detail_checks.push({ link: item.link, title: item.title, date: item.date, http_ok: !!detail?.ok, title_match: titleMatch });
      if (stopped) break;
    }
    const valid = items.length >= 5 && items.length === result.expected_item_count && result.dated === items.length && result.unique_titles >= 5 && items.every((i) => i.title.length <= 150) && result.detail_checks.length === 2 && result.detail_checks.every((d) => d.http_ok && d.title_match) && config.press_confirmed === true;
    if (!stopped) { result.status = valid ? 'COMPLETE' : 'REVIEW_NEEDED'; result.reason = valid ? 'Official press list, dates, titles, and two detail links verified' : 'Metadata/detail/official-purpose acceptance incomplete'; }
  } else result.reason = 'Structure captured; explicit title/date/link profile needs review';
  write(`${mode}-${filename(row)}.json`, result);
  console.log(row.id, result.status, result.page_title, result.items.length);
  return result;
}

if (mode === 'sanitize') {
  for (const file of readdirSync(evidence).filter((name)=>name.endsWith('.json'))) writeFileSync(new URL(file,evidence),sanitize(readFileSync(new URL(file,evidence),'utf8')));
} else if (mode === 'baseline') {
  const protectedPaths = ['lib/press/query.ts', 'lib/press/classify.ts', 'lib/press/coverage.ts', 'lib/press/schedule.ts', 'components/press/press-browser.tsx', 'scripts/press/discover.mjs', 'scripts/press/robots-exempt.mjs', 'public/press-relay/collect.ps1', 'public/press-relay/install.ps1'];
  write('baseline.json', { at: new Date().toISOString(), input: inputPath, input_sha256: hash(readFileSync(new URL(inputPath, root))), target_count: targets.length, targets: targets.map(({id, name})=>({id,name})), boundary: boundary.map(({id,name,status})=>({id,name,status})), protected_hashes: Object.fromEntries(protectedPaths.filter((p)=>existsSync(new URL(p,root))).map((p)=>[p,hash(readFileSync(new URL(p,root)))])), git_status: execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}), attempt_status: 'ULW_LOOP_PLAN_MISSING; bundled CLI status --json; fallback .omo/evidence' });
} else {
  const selected = [...targets.map((row)=>({row,scope:'manual30'})), ...boundary.map((row)=>({row,scope:'boundary4'}))].filter(({row})=>!only || row.id.includes(only) || row.homepage.includes(only));
  const results=[];
  let index=0;
  await Promise.all(Array.from({length:4},async()=>{ while(index<selected.length){ const {row,scope}=selected[index++]; results.push(await review(row,scope)); } }));
  write(`${mode}-summary${only ? '-'+encodeURIComponent(only) : ''}.json`, { at:new Date().toISOString(), results:results.map(({id,status,reason,scope})=>({id,status,reason,scope})) });
}
