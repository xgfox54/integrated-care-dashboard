import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyLegalLinkReviews } from '../scripts/welfare100/legal-link-reviews.mjs';
const data=id=>JSON.parse(fs.readFileSync(new URL('../public/data/welfare100/items/'+id+'.json',import.meta.url),'utf8'));
test('verified split citations are stable on repeated generation and retain original citation',()=>{
 const corrections=[{item:'fixture',from:{name:'아동복지법',article:'제35조 및 시행령 제35조'},to:[{name:'아동복지법',article:'제35조',kind:'법률',url:'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=290207'},{name:'아동복지법 시행령',article:'제35조',kind:'대통령령',url:'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=288363'}]}];
 const once=applyLegalLinkReviews('fixture',[{name:'아동복지법',article:'제35조 및 시행령 제35조'}],corrections);
 assert.equal(once.length,2);assert.equal(once[1].sourceArticle,corrections[0].from.article);
 assert.deepEqual(applyLegalLinkReviews('fixture',once,corrections),once);
 const drift=applyLegalLinkReviews('fixture',[{name:'아동복지법',article:'제36조'}],corrections);
 assert.equal(drift.length,1);assert.equal(drift[0].article,'제36조');assert.equal(drift[0].url,undefined);assert.match(drift[0].reviewNote,/달라져/);
});
test('official local originals resolve the two withheld invalid article references with scope',()=>{
 const n=data('WLF00004546').raw;assert.equal(n.laws[0].article,'제3조제7호(주거정책의 기본원칙)');assert.match(n.benefit,/5세대/);assert.doesNotMatch(n.benefit,/30,000|3,000천원|자부담/);assert.ok(n.edit.fields.includes('benefit'));
 const i=data('WLF00000895').raw;assert.match(i.laws[0].name,/이천시/);assert.match(i.laws[0].scopeNote,/직접 근거까지/);assert.ok(i.steps.every(s=>!s.org.includes('시흥')));assert.ok(i.steps.some(s=>s.org==='이천시청 노인장애인과'));
});
test('2026 Gyeongbuk payment method and exceptions follow the official attachment',()=>{
 const r=data('WLF00003658').raw;assert.match(r.laws[0].article,/제5조제1항제9호/);assert.match(r.applyText,/서비스기관에 지급/);assert.match(r.benefit,/최대 25일/);assert.match(r.benefit,/미숙아/);assert.deepEqual(r.applyMethods,['방문','우편']);
});
test('all corrected raw law arrays remain idempotent and blocked citations cannot gain URLs',()=>{
 let count=0;for(const f of fs.readdirSync(new URL('../public/data/welfare100/items/',import.meta.url))){if(!f.endsWith('.json'))continue;const p=data(f.slice(0,-5));const r=p.kind==='auto'?p.raw:p.extra?.bokjiro;if(!r)continue;const next=applyLegalLinkReviews(r.id,r.laws);assert.deepEqual(JSON.parse(JSON.stringify(next)),r.laws,f);for(const law of next){if(law.reviewNote)assert.equal(law.url,undefined);if(law.scopeNote)count++;}}
 assert.ok(count>100);
});
