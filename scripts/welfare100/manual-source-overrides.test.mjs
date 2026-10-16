import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveManualSourceOverride} from './manual-source-overrides.mjs';
import {lineFingerprint} from './manual-link-scope.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const raw='실제 사업\n지원대상 6~36개월 미만 영아';
const page={file:'manual.pdf',page:2,raw};
const original={file:page.file,page:2,quote:'실제 사업'};
const options={manualLines:new Map([['17',['실제 사업']]]),pages:[page],locate:()=>({original}),fallback:()=>({original})};
const override={item:'hourly-childcare',source_key:'17',key:'17',section_line:1,line_sha256:lineFingerprint('실제 사업'),file:page.file,page:2,page_sha256:hash(raw),quote:raw,quote_sha256:hash(raw)};
test('explicit source preserves actual eligibility quote',()=>assert.equal(resolveManualSourceOverride(override,options).original.quote,raw));
test('changed original page, section line, quote or mapping fails closed',()=>{
 assert.throws(()=>resolveManualSourceOverride(override,{...options,pages:[{...page,raw:raw+' changed'}]}),/page fingerprint/);
 assert.throws(()=>resolveManualSourceOverride(override,{...options,manualLines:new Map([['17',['다른사업']]])}),/line fingerprint/);
 assert.throws(()=>resolveManualSourceOverride({...override,quote:'틀린 인용',quote_sha256:hash('틀린 인용')},options),/quote fingerprint/);
 assert.throws(()=>resolveManualSourceOverride(override,{...options,locate:()=>({original:{...original,page:3}})}),/mapping changed/);
});
test('generated curated actual sections and eligibility remain linked',()=>{
 for(const [item,key,line,page] of [['education-benefit','11',3732,147],['hourly-childcare','17',8912,280]]){
  const payload=JSON.parse(fs.readFileSync(`public/data/welfare100/items/${item}.json`));
  const ref=payload.extra.talkRefs.find(r=>r.curatedSource&&r.sectionLine===line);
  assert.ok(ref,item);assert.equal(ref.key,key);assert.equal(ref.original.page,page);assert.equal(ref.review.decision,'DIRECT');
  assert.match(ref.original.quote,item==='hourly-childcare'?/6~36개월/:/중위소득 50%/);
 }
});
test('all reviewed relocations and exclusions survive generated item output',()=>{
 const ledger=JSON.parse(fs.readFileSync('data/welfare100/manual-link-review-round2.json'));
 assert.equal(ledger.findings.length,775);
 for(const row of ledger.findings.filter(r=>r.target||r.action.startsWith('RELOCATE')||r.action==='EXCLUDE')){
  const payload=JSON.parse(fs.readFileSync(`public/data/welfare100/items/${row.item}.json`));
  const refs=payload.raw?.talkRefs??payload.extra.talkRefs;
  if(row.action==='EXCLUDE')assert.ok(!refs.some(r=>r.key===row.key&&r.line===row.oldline),row.id);
  else {
   const ref=refs.find(r=>r.key===row.newkey&&(r.line===row.newline||r.sectionLine===row.newline));
   assert.ok(ref,row.id);assert.equal(ref.review.decision,row.decision,row.id);
   assert.equal(ref.original.file,row.source.file,row.id);assert.equal(ref.original.page,row.source.page,row.id);
  }
 }
});
