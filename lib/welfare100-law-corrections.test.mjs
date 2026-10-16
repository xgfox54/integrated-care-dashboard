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
 const n=data('WLF00004546').raw;assert.equal(n.laws[0].article,'제3조제7호(주거정책의 기본원칙)');assert.match(n.benefit,/5세대/);assert.doesNotMatch(n.benefit,/30,000|3,000천원|자부담/);assert.ok(n.edit.fields.includes('benefit'));assert.deepEqual(n.household,['저소득','장애인']);
 const row=JSON.parse(fs.readFileSync(new URL('../public/data/welfare100/index.json',import.meta.url),'utf8')).items.find(x=>x.s===n.id);assert.deepEqual(row.h,n.household);assert.equal(row.o,n.summary);assert.doesNotMatch(row.o,/신축/);
 const i=data('WLF00000895').raw;assert.match(i.laws[0].name,/이천시/);assert.match(i.laws[0].scopeNote,/직접 근거까지/);assert.ok(i.steps.every(s=>!s.org.includes('시흥')));assert.ok(i.steps.some(s=>s.org==='이천시청 노인장애인과'));
});
test('2026 Gyeongbuk payment method and exceptions follow the official attachment',()=>{
 const r=data('WLF00003658').raw;assert.match(r.laws[0].article,/제5조제1항제9호/);assert.match(r.applyText,/서비스기관에 지급/);assert.match(r.benefit,/최대 25일/);assert.match(r.benefit,/미숙아/);assert.deepEqual(r.applyMethods,['방문','우편']);
});
test('all corrected raw law arrays remain idempotent and blocked citations cannot gain URLs',()=>{
 let count=0;for(const f of fs.readdirSync(new URL('../public/data/welfare100/items/',import.meta.url))){if(!f.endsWith('.json'))continue;const p=data(f.slice(0,-5));const r=p.kind==='auto'?p.raw:p.extra?.bokjiro;if(!r)continue;const next=applyLegalLinkReviews(r.id,r.laws);assert.deepEqual(JSON.parse(JSON.stringify(next)),r.laws,f);for(const law of next){if(law.reviewNote)assert.equal(law.url,undefined);if(law.scopeNote)count++;}}
 assert.ok(count>100);
});
test('round 3 distinguishes target-specific veteran and school-trip amounts',()=>{
 const veteran=data('WLF00004334').raw;
 assert.match(veteran.benefit,/월 20만원/);assert.match(veteran.benefit,/월 15만원/);assert.match(veteran.benefit,/월 10만원/);assert.doesNotMatch(veteran.benefit,/18만원/);
 const trip=data('WLF00005237').raw;
 assert.match(trip.benefit,/저소득층 가정.*\n.*다자녀가정/s);assert.match(trip.benefit,/65,000원/);assert.match(trip.benefit,/200,000원/);assert.match(trip.benefit,/국내·국외 동일 한도/);
 for(const r of [veteran,trip]){assert.ok(r.edit.fields.includes('benefit'));assert.ok(r.edit.sources.length);}
});
test('round 3 official plans retain their document kind and scoped provenance',()=>{
 const raw=data('WLF00006755').raw;
 assert.equal(raw.laws[0].kind,'공식 사업자료');assert.match(raw.laws[0].url,/jeongseon\.go\.kr/);assert.match(raw.laws[0].sourceArticle,/3조/);assert.match(raw.laws[0].scopeNote,/법령 조문이 아닌/);
 const kindergarten=data('WLF00003871').raw;assert.match(kindergarten.benefit,/월 8만원/);assert.doesNotMatch(kindergarten.target,/2018년/);
 const business=data('WLF00002401').raw;assert.match(business.benefit,/900만원/);assert.doesNotMatch(business.benefit,/10,000천원/);
});
test('round 3 keeps unresolved originals and does not activate future ordinances',()=>{
 const audit=JSON.parse(fs.readFileSync(new URL('../data/welfare100/legal-link-review-round3.json',import.meta.url),'utf8'));
 assert.equal(audit.entries.length,64);assert.equal(new Set(audit.entries.map(x=>x.id)).size,64);
 const pending=audit.entries.filter(x=>x.status==='PENDING');assert.equal(pending.length,7);
 for(const id of ['WLF00004128','WLF00001518']){const laws=data(id).raw.laws;assert.ok(laws.some(x=>x.url?.endsWith('1343434')));assert.ok(laws.every(x=>!x.url?.endsWith('2156049')));}
 assert.ok(data('WLF00002560').raw.laws.every(x=>!x.url?.endsWith('2177039')));
 assert.match(data('WLF00000230').raw.laws[0].article,/제12조/);assert.doesNotMatch(data('WLF00000230').raw.laws[0].article,/제8조/);
});

test('round 4 resolves all seven withheld legal links with official originals', () => {
 const audit=JSON.parse(fs.readFileSync(new URL('../data/welfare100/legal-link-review-round4.json',import.meta.url),'utf8'));
 assert.equal(audit.entries.length,7);assert.deepEqual(audit.entries.filter(x=>x.status==='PENDING').map(x=>x.id),[]);
 const reviews=JSON.parse(fs.readFileSync(new URL('../data/welfare100/legal-link-reviews.json',import.meta.url),'utf8')).entries;
 assert.deepEqual(reviews.filter(x=>x.status==='PENDING').map(x=>x.id),[]);
 for(const id of ['WLF00004128','WLF00001518']){const law=data(id).raw.laws[0];assert.match(law.url,/ordinSeq=1343434$/);assert.match(law.scopeNote,/2027-01-01 폐지 전까지/);assert.equal(law.reviewNote,undefined);}
 const veteran=data('WLF00001597').raw.laws;assert.ok(veteran.some(x=>x.url?.endsWith('2069379')&&x.article==='제8조'));assert.ok(veteran.some(x=>x.reviewNote&&/애국지사/.test(x.reviewNote)&&!x.url));
 const relief=data('WLF00004449').raw.laws;assert.deepEqual(relief.map(x=>x.name),['재해구호법','경상남도 재해구호기금 운용·관리 조례']);assert.ok(relief.every(x=>x.url&&!x.reviewNote));
 const gwangsan=data('WLF00001322').raw.laws;assert.match(gwangsan[0].url,/ordinSeq=2143263$/);assert.ok(gwangsan.some(x=>x.name==='장사 등에 관한 법률'&&x.article==='제12조'));
 const geoje=data('WLF00000140').raw.laws;assert.equal(geoje.length,1);assert.match(geoje[0].url,/lsiSeq=268883$/);assert.match(geoje[0].scopeNote,/대조하지 못했습니다/);
 const gm=data('WLF00006413').raw.laws;assert.ok(gm.every(x=>x.url&&!x.reviewNote));assert.ok(gm.some(x=>x.url.startsWith('https://news.gm.go.kr/')&&x.kind==='공식 사업자료'));assert.match(gm[0].scopeNote,/보도자료\(2026-04-01\)/);
});

