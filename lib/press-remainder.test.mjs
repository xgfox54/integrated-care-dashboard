import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHtmlBoard,parseBoardProfile} from './press/html-board.ts';
import {overrides} from '../scripts/press/remainder-profiles-20261006.mjs';
import {readFileSync} from 'node:fs';
import {database,NOW,response} from './press-test-support.mjs';
import {autoApproveRobotsAllowed} from './press/auto-approve.ts';
import {claimRelayJobs} from './press/relay.ts';
import {listDueSources} from './press/store.ts';
import {resumePressHold} from './press/admin.ts';

const version='registry-2026-10-06-remainder14';
const migration=()=>readFileSync(new URL('../drizzle/0082_press_remainder_verified.sql',import.meta.url),'utf8');

test('0082 이후에도 기존 보안·관리자 hold는 PC 수집을 막고 만료된 일시 보류만 자동 대상이 된다',async(t)=>{
  for(const [kind,until,blocked] of [
    ['ACCESS_DENIED',null,true],['AUTH_REQUIRED',null,true],['MANUAL_REVIEW',null,true],
    ['SERVER_PAUSED',NOW+3600,true],['SERVER_PAUSED',NOW-1,false],
  ]){
    const db=database();
    const id='src:chungbuk:press';
    try {
      db.sqlite.prepare("UPDATE press_source SET endpoint_url='https://old.example.go.kr/retired',verification_status='BLOCKED_ROBOTS',robots_exempt='' WHERE source_id=?").run(id);
      db.sqlite.prepare('INSERT INTO press_crawl_state (source_id,collection_hold,hold_until,hold_reason,next_due_at) VALUES (?,?,?,?,?)').run(id,kind,until,'previous endpoint hold',0);
      const state=()=>db.sqlite.prepare('SELECT * FROM press_crawl_state WHERE source_id=?').get(id);
      const before=state();
      db.sqlite.exec(migration());
      const approval=await autoApproveRobotsAllowed(db,async()=>response(404),NOW,1000);
      assert.ok(approval.some(r=>r.sourceId===id&&r.approved&&r.verdict==='OPERATOR_EXEMPT'));
      assert.deepEqual(state(),before,'프로필 재검증과 승인은 기존 보류를 해제하지 않는다');
      assert.equal(db.sqlite.prepare('SELECT endpoint_url FROM press_source WHERE source_id=?').get(id).endpoint_url,'https://www.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=65&key=429');
      db.sqlite.prepare('UPDATE press_source SET enabled=0 WHERE registry_version<>?').run(version);
      const jobs=await claimRelayJobs(db,'hold-fixture',NOW);
      assert.equal(jobs.jobs.some(r=>r.sourceId===id),!blocked);
      assert.equal(jobs.jobs.length,blocked?13:14);
      if(blocked){
        assert.equal(await resumePressHold(db,id,NOW),true);
        assert.ok((await claimRelayJobs(db,'hold-fixture',NOW)).jobs.some(r=>r.sourceId===id),'메모리 DB에서 명시적인 관리자 해제 후 대상 복귀');
      }
      t.diagnostic(JSON.stringify({hold:kind,expired:until!==null&&until<NOW,profileUpdated:true,holdPreserved:true,blocked,relayJobsBeforeExplicitResume:jobs.jobs.length,productionAccess:false}));
    } finally {db.sqlite.close();}
  }
});

test('잔여 14곳 migration은 프로필을 연결하고 재적용 시 관리자 철회·비활성을 보존한다',()=>{
  const db=database();
  try {
    const rows=db.sqlite.prepare('SELECT * FROM press_source WHERE registry_version=? ORDER BY source_id').all(version);
    assert.equal(rows.length,14);
    assert.deepEqual(rows.map(r=>r.organization_id).sort(),Object.keys(overrides).sort());
    for(const row of rows){
      assert.ok(parseBoardProfile(row.adapter_profile),row.organization_id);
      assert.equal(row.verification_status,'ENDPOINT_VERIFIED');
      assert.equal(row.collect_via,'relay');
      assert.equal(row.approval_status,'PENDING_PERMISSION');
      assert.equal(row.enabled,0);
    }
    db.sqlite.prepare("UPDATE press_source SET approval_status='REVOKED',enabled=0 WHERE source_id=?").run(rows[0].source_id);
    db.sqlite.prepare("UPDATE press_source SET approval_status='POLICY_APPROVED',enabled=0 WHERE source_id=?").run(rows[1].source_id);
    const all=()=>db.sqlite.prepare('SELECT * FROM press_source ORDER BY source_id').all();
    const before=all();
    db.sqlite.exec(migration());
    assert.deepEqual(all(),before);
  } finally {db.sqlite.close();}
});

test('잔여 14곳은 실제 OPERATOR_EXEMPT 승인 후 14/14 PC 작업에 포함되고 서버 직접 수집에서 제외된다',async()=>{
  const db=database();
  try {
    const rows=db.sqlite.prepare('SELECT source_id FROM press_source WHERE registry_version=?').all(version);
    const ids=new Set(rows.map(r=>r.source_id));
    const decisions=await autoApproveRobotsAllowed(db,async()=>response(404),NOW,1000);
    const own=decisions.filter(r=>ids.has(r.sourceId));
    assert.equal(own.length,14);
    assert.ok(own.every(r=>r.approved&&r.verdict==='OPERATOR_EXEMPT'));
    // 메모리 fixture에서 이 cohort만 작업 대상으로 남겨 claim 상한과 무관하게 검증한다.
    db.sqlite.prepare('UPDATE press_source SET enabled=0 WHERE registry_version<>?').run(version);
    const jobs=(await claimRelayJobs(db,'remainder-fixture',NOW)).jobs;
    assert.deepEqual(jobs.map(r=>r.sourceId).sort(),[...ids].sort());
    assert.ok(jobs.every(r=>r.accept==='text/html'));
    assert.equal((await listDueSources(db,NOW,1000,'server')).length,0);
  } finally {db.sqlite.close();}
});

test('광주 남구의 같은 ID 5개 링크에서 번호·등록자 대신 제목과 날짜만 추출한다',()=>{
  const p=overrides['org:전남광주통합특별시:남구'].profile;
  const cell=(cl,tab,text)=>`<li class="${cl}"><a onclick="searchDetail('6679')" tabindex="${tab}">${text}</a></li>`;
  const html='<ul>'+cell('col01',3,'6570')+cell('title',4,'동민 한마음 축제')+cell('col03',5,'PRIVATE-AUTHOR')+cell('col04',6,'2026-10-02')+cell('col05',7,'29')+'</ul>';
  const rows=parseHtmlBoard(html,p);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'동민 한마음 축제');
  assert.equal(rows[0].pubDate,'2026-10-02');
  assert.ok(!JSON.stringify(rows).includes('PRIVATE-AUTHOR'));
});

test('용산 긴 표 행의 날짜를 읽고 다음 행 날짜를 빌려오지 않는다',()=>{
  const p=overrides['org:서울특별시:용산구'].profile;
  const a=id=>`<a href="B0000043/view.do?nttId=${id}" title="돌봄 안내 ${id}">돌봄 안내</a>`;
  const html=`<tr><td>${a(1)}</td>${' '.repeat(6000)}<td>2026-10-06</td></tr><tr><td>${a(2)}</td><td>미기재</td></tr><tr><td>${a(3)}</td><td>2026-10-05</td></tr>`;
  assert.deepEqual(parseHtmlBoard(html,p).map(r=>r.pubDate),['2026-10-06','','2026-10-05']);
  assert.equal(parseBoardProfile(JSON.stringify(p)).dateScope,'row');
});
test('종로의 명시적인 한글 날짜 칸을 ISO 날짜로 읽는다',()=>{
  const p=overrides['org:서울특별시:종로구'].profile;
  assert.equal(parseHtmlBoard('<tr><td><a href="javascript:viewMove(\'1\');">돌봄 안내</a></td><td class="output date1">2026년10월02일</td></tr>',p)[0].pubDate,'2026-10-02');
});
test('양천 제목 문자열만 읽으며 스크립트 실행이나 본문·개인정보 수집을 하지 않는다',()=>{
  const p=overrides['org:서울특별시:양천구'].profile;
  const html=`<tr><td><a onclick="doBbsFView('290','1')"><script>document.write(wdigm_title('돌봄 \\'안내\\''));globalThis.BAD_EXECUTED=true;</script></a></td><td>2026-10-06</td><td>PRIVATE-AUTHOR</td></tr>`;
  const rows=parseHtmlBoard(html,p);
  assert.equal(rows[0].title,"돌봄 '안내'");
  assert.equal(globalThis.BAD_EXECUTED,undefined);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE-AUTHOR'));
});
test('광주 서구 새글 장식만 제거하고 본래 제목의 새글은 보존한다',()=>{
  const p=overrides['org:전남광주통합특별시:서구'].profile;
  const html='<tr><td><a href="board.es?list_no=1"><i class="xi-new"></i><span class="sr_only">새글</span>새글 작성 교육</a></td><td aria-label="등록일">2026/10/06</td></tr>';
  assert.equal(parseHtmlBoard(html,p)[0].title,'새글 작성 교육');
});
