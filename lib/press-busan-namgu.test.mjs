import assert from 'node:assert/strict';
import test from 'node:test';
import {database,NOW} from './press-test-support.mjs';
import {parseHtmlBoard} from './press/html-board.ts';
import {setPressApproval,holdPressSource} from './press/admin.ts';
import {claimRelayJobs,processRelayResult} from './press/relay.ts';

const sourceId='src:www.bsnamgu.go.kr:press';
const title='부산 남구, 꿈나무다함께돌봄센터 위·수탁 협약 체결';
// 공식 목록 13523의 공개 메타데이터만 남긴 최소 표 행. 본문·담당자 없음.
const html=`<table><tr><td><a href="javascript:searchDetail('13523');">${title}</a></td><td>2026-09-29</td></tr></table>`;

test('부산 남구 기존 프로필은 공식 새올 ID·제목·같은 행 날짜를 보존한다',()=>{
  const db=database();
  try{
    const source=db.sqlite.prepare('SELECT * FROM press_source WHERE source_id=?').get(sourceId);
    const items=parseHtmlBoard(html,JSON.parse(source.adapter_profile));
    assert.equal(items.length,1);
    assert.equal(items[0].title,title);
    assert.equal(items[0].pubDate,'2026-09-29');
    const url=new URL(items[0].link);
    assert.equal(url.host,'eminwon.bsnamgu.go.kr');
    assert.equal(url.searchParams.get('news_epct_no'),'13523');
    assert.equal(url.searchParams.get('method'),'selectOfrNews');
  }finally{db.sqlite.close();}
});

test('부산 남구 HTTP400은 실패로 보존하고 정상200만 수집하며 기존 보류를 자동 해제하지 않는다',async()=>{
  const db=database();
  let now=NOW,seq=0;
  const deps={now:()=>now,newId:()=> 'namgu-test-'+(++seq)};
  try{
    const endpoint=db.sqlite.prepare('SELECT endpoint_url FROM press_source WHERE source_id=?').get(sourceId).endpoint_url;
    await setPressApproval(db,sourceId,'approve',now);
    await claimRelayJobs(db,'namgu-test',now);
    const bad=await processRelayResult(db,'namgu-test',sourceId,[{url:endpoint,status:400,contentType:'text/html'}],deps);
    assert.equal(bad.status,'failed');
    assert.equal(bad.errorCode,'UNEXPECTED_STATUS');
    assert.equal(bad.counts.created,0);
    now+=100000;
    await claimRelayJobs(db,'namgu-test',now);
    const payload=[{url:endpoint,status:200,contentType:'text/html; charset=utf-8',bodyBase64:Buffer.from(html).toString('base64')}];
    const good=await processRelayResult(db,'namgu-test',sourceId,payload,deps);
    assert.equal(good.status,'succeeded');
    assert.equal(good.counts.created,1);
    now+=100000;
    await claimRelayJobs(db,'namgu-test',now);
    assert.equal((await processRelayResult(db,'namgu-test',sourceId,payload,deps)).counts.created,0);
    await holdPressSource(db,sourceId,'existing manual hold',now);
    now+=100000;
    const state=()=>db.sqlite.prepare('SELECT collection_hold,hold_reason FROM press_crawl_state WHERE source_id=?').get(sourceId);
    const before=state();
    assert.equal((await claimRelayJobs(db,'namgu-test',now)).jobs.some(j=>j.sourceId===sourceId),false);
    const held=await processRelayResult(db,'namgu-test',sourceId,payload,deps);
    assert.notEqual(held?.status,'succeeded');
    assert.deepEqual(state(),before);
  }finally{db.sqlite.close();}
});
