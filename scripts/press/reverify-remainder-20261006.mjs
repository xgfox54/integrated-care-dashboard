import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { politeFetch, links } from './discover.mjs';
import { parseHtmlBoard } from '../../lib/press/html-board.ts';
import { cleanText } from '../../lib/press/rss.ts';
import { overrides } from './remainder-profiles-20261006.mjs';

const root = new URL('../../', import.meta.url);
export const evidence = new URL('.omo/evidence/press-remainder-20261006/', root);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const initial = read('docs/press/discovery/robots-exempt-2026-10-06.json');
const prior = read('docs/press/discovery/manual30-registry-20261006.json');
const done = new Set(prior.sources.map((r) => r.organization_id));
export const targets = initial.results.filter((r) => r.status === 'CANDIDATE_NEEDS_REVIEW' && !done.has(r.id));
const oldProfiles = read('docs/press/discovery/manual-profiles-20261006.json');
const clean = (s) => cleanText(s.replace(/<[^>]*>/g, ' '));
export function safeUrl(value) {
  const u = new URL(value);
  u.pathname = u.pathname.replace(/;jsessionid=[^/]*/gi, '');
  for (const key of [...u.searchParams.keys()]) if (/token|session|api.?key|servicekey|auth/i.test(key)) u.searchParams.delete(key);
  return u.toString();
}
export function security(response) {
  if ([401,403,407,429,451].includes(response.status)) return 'HTTP_' + response.status;
  if (response.error && /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(response.error)) return response.error;
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(response.text ?? '')?.[1] ?? '');
  if (/captcha|access denied|request rejected|웹.?방화벽|접근.{0,8}차단|비정상.{0,8}접근|보안.{0,8}차단/i.test(title)) return 'SECURITY_PAGE';
  if (/<(?:form|iframe)[^>]*(?:captcha|login|signin)/i.test(response.text ?? '') && !/보도자료/.test(title)) return 'AUTH_OR_CAPTCHA';
  return null;
}
export async function review(row, mode = 'verify', explicitUrl) {
  const config = { ...oldProfiles[row.id], ...overrides[row.id] };
  const endpoint = safeUrl(explicitUrl ?? config.endpoint ?? row.endpoint ?? row.homepage);
  const result = { id:row.id, name:row.name, sido:row.sido, kind:row.kind, metroKey:row.metroKey, homepage:safeUrl(row.homepage), endpoint, checked_at:new Date().toISOString(), invocation:process.argv.slice(1).join(' '), requests:[], status:'REVIEW_NEEDED', robots_exception_authorized:true };
  let stopped = false;
  async function get(url, purpose) {
    if (stopped) return null;
    const target = safeUrl(url);
    const response = await politeFetch(target);
    const blocked = security(response);
    result.requests.push({purpose,url:target,final_url:safeUrl(response.url),status:response.status??null,error:response.error??null,security:blocked,sha256:createHash('sha256').update(response.text??'').digest('hex'),characters:response.text?.length??0});
    if (blocked) { stopped = true; result.status='BLOCKED'; result.reason=blocked; return null; }
    return response;
  }
  const response = await get(endpoint,'official_list');
  if (response?.ok) {
    const html=response.text;
    result.page_title=clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]??'');
    const anchors=links(html,response.url);
    result.official_routes=anchors.filter(l=>/보도|언론|군정뉴스|도정뉴스|뉴스룸/.test(l.text)&&l.text.length<45&&l.absolute).map(l=>({title:l.text,url:safeUrl(l.absolute)})).slice(0,45);
    result.embeds=[...html.matchAll(/<(?:iframe|frame)[^>]*src=["']([^"']+)["']/gi)].map(m=>safeUrl(new URL(m[1].replaceAll('&amp;','&'),response.url)));
    const candidate = config.profile ? anchors.filter(l=>new RegExp(config.profile.link).test(l.attrs)) : anchors.filter(l=>/onclick|view|detail|ntt|idx|seq|uid/i.test(l.attrs)&&l.text.length>8&&l.text.length<150);
    result.candidates=candidate.slice(0,10).map(l=>({title:l.text.slice(0,150),attrs:l.attrs.replace(/;jsessionid=[^"'\s?]*/gi,''),offset:l.index,inner_tags:html.slice(l.index,l.end).match(/<\/?[a-z][^>]*>/gi),dates_after:[...html.slice(l.index,l.index+6500).matchAll(/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/g)].slice(0,2).map(m=>({date:m[0],offset:m.index})),dates_before:[...html.slice(Math.max(0,l.index-2500),l.index).matchAll(/20\d{2}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/g)].slice(-2).map(m=>({date:m[0],offset:m.index}))}));
    result.navigation=[...html.matchAll(/function\s+(?:viewMove|doBbsFView|fn_icms_navi_common|fn_icms_bbs_view|searchDetail|goView|view|goDetail)[^{]*\{[^}]{0,1800}\}/g)].map(m=>m[0]);
    result.forms=[...html.matchAll(/<form\b[^>]*>/gi)].map(m=>m[0]);
    result.scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map(m=>safeUrl(new URL(m[1].replaceAll('&amp;','&'),response.url))).filter(u=>/bbs|board|list|common|news/i.test(u)).slice(0,12);
    if (config.profile) {
      result.profile=config.profile;
      result.items=parseHtmlBoard(html,config.profile).map(({title,pubDate,link})=>({title,date:pubDate,link:safeUrl(link)}));
      result.expected_count=new Set(candidate.map(l=>new RegExp(config.profile.link).exec(l.attrs)?.groups?.id).filter(Boolean)).size;
      result.dated=result.items.filter(i=>/^20\d{2}-\d{2}-\d{2}$/.test(i.date)).length;
      if(mode==='verify') {
        result.detail_checks=[];
        for(const item of result.items.slice(0,2)) {
          const detail=await get(item.link,'detail_title_check');
          const compact=s=>clean(s).replace(/[^\p{L}\p{N}]/gu,'');
          const check={link:item.link,title:item.title,http_ok:!!detail?.ok,title_match:!!detail?.ok&&compact(detail.text).includes(compact(item.title))};
          if(config.require_municipal_release) {
            const text=detail?.text??'';
            const author=/<li class="view_write">([\s\S]*?)<\/li>/.exec(text)?.[1]??'';
            const content=text.split('<div class="view_cont">')[1]?.split(/<dl class="view_file\b/)[0]??'';
            const articleLinks=[...content.matchAll(/<a[^>]*href=["'](https?:[^"']+)["']/gi)];
            check.ownership={department_author:/(?:복지과|전략과|홍보|기획|실|과)/.test(clean(author)),department_in_title:/\([^)]*(?:과|실)\)/.test(item.title),public_work_license:/본 공공저작물|공공누리/.test(text),no_outlet_credit:!!content&&!/뉴스1|뉴스핌|뉴시스|연합뉴스|기자|무단전재|저작권자/.test(content),no_external_article_links:articleLinks.every(m=>new URL(m[1]).hostname==='www.bonghwa.go.kr')};
          }
          result.detail_checks.push(check);
          if(stopped)break;
        }
        const complete=config.press_confirmed===true && result.items.length>=5 && result.items.length===result.expected_count && result.dated===result.items.length && result.detail_checks.length===2 && result.detail_checks.every(d=>d.http_ok&&d.title_match&&(!config.require_municipal_release||Object.values(d.ownership).every(Boolean)));
        if(!stopped&&complete){result.status='COMPLETE';result.reason=config.basis;}
      }
    }
    if(config.exclude){result.status='EXCLUDED';result.reason=config.exclude;}
  } else result.reason ??= response?.error ?? `HTTP_${response?.status??'STOPPED'}`;
  mkdirSync(evidence,{recursive:true});
  for(const key of ['candidates','navigation','forms','scripts','official_routes','embeds']) delete result[key];
  const filename=mode+'-'+encodeURIComponent(row.id).replaceAll('%','_')+'.json';
  const safe = JSON.stringify(result,null,2).replace(/;jsessionid=[^"'\\\s?]*/gi,'').replace(/([?&](?:amp;)?token=)[^&"'\\\s]*/gi,'$1[REMOVED]');
  writeFileSync(new URL(filename,evidence),safe);
  console.log(JSON.stringify({id:row.id,status:result.status,items:result.items?.length,dated:result.dated,expected:result.expected_count,reason:result.reason,artifact:filename}));
  return result;
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  const [mode='inspect',only,url]=process.argv.slice(2);
  if(mode==='redact-evidence') {
    // 기존 탐색 증거도 제목·날짜·링크와 판정 메타데이터만 남긴다. 원문은 다시 요청하지 않는다.
    let files=0;
    for(const name of readdirSync(evidence).filter(n=>/^(inspect|verify)-.*\.json$/.test(n))){
      const path=new URL(name,evidence);
      const record=JSON.parse(readFileSync(path,'utf8'));
      for(const key of ['candidates','navigation','forms','scripts','official_routes','embeds'])delete record[key];
      const safe=JSON.stringify(record,null,2).replace(/;jsessionid=[^"'\\\s?]*/gi,'').replace(/([?&](?:amp;)?token=)[^&"'\\\s]*/gi,'$1[REMOVED]');
      writeFileSync(path,safe);files++;
    }
    console.log(JSON.stringify({mode,files,stored:'metadata_only',network_requests:0}));
  } else {
  let index=0;
  const selected=targets.filter(r=>!only||r.id.includes(only));
  await Promise.all(Array.from({length:4},async()=>{while(index<selected.length)await review(selected[index++],mode,url);}));
  }
}
