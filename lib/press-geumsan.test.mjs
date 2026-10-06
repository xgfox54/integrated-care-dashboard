import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {classifyTitle} from './press/classify.ts';
import {database,NOW} from './press-test-support.mjs';
import {setPressApproval} from './press/admin.ts';
import {advanceAutoClassification} from './press/auto-classify.ts';
import {claimRelayJobs,processRelayResult,RELAY_MAX_BYTES} from './press/relay.ts';

const endpoint='https://www.geumsan.go.kr/kr/html/sub03/030301.html';
const sourceId='src:www.geumsan.go.kr:press';

test('r3 재분류는 이전 노후 시설 오분류를 바로잡되 사람 판정·공개 철회·게시물 식별자는 보존한다',async()=>{
  const db=database();
  try {
    const title='청년 문화공간, 노후산업단지 환경조성 사업';
    const insert=db.sqlite.prepare("INSERT INTO press_item(item_id,source_id,origin_id,canonical_url,title,title_hash,issued_by_org_id,published_date,publication_precision,discovered_at,collected_at,categories,classification_status,classification_basis,dictionary_version,public_status) VALUES(?,?,?,?,?,'unchanged','org:충청남도:금산군','2026-09-30','date',?,?,'[\"senior\"]','WELFARE',?,'press-dict-2026-10-06-r2',?)");
    for(const [id,basis,status] of [['old-rule','title_rule','PUBLIC'],['reviewed','reviewer','PUBLIC'],['withdrawn','title_rule','WITHDRAWN']])insert.run(id,sourceId,id,endpoint+'?mode=V&nes_dta_key='+id,title,NOW,NOW,basis,status);
    const row=id=>db.sqlite.prepare('SELECT * FROM press_item WHERE item_id=?').get(id);
    const reviewerBefore=row('reviewed');
    const before=row('old-rule');
    const result=await advanceAutoClassification(db,NOW+1);
    assert.equal(result.reclassified,2);
    assert.equal(row('old-rule').classification_status,'NON_WELFARE');
    assert.equal(row('old-rule').public_status,'HIDDEN');
    assert.equal(row('old-rule').categories,'[]');
    for(const key of ['item_id','source_id','origin_id','canonical_url','title','title_hash'])assert.equal(row('old-rule')[key],before[key]);
    assert.deepEqual(row('reviewed'),reviewerBefore);
    assert.equal(row('withdrawn').public_status,'WITHDRAWN');
  }finally{db.sqlite.close();}
});
const script=fileURLToPath(new URL('../public/press-relay/collect.ps1',import.meta.url));
const card='<a href="?mode=V&nes_dta_key=source1"><strong class="title">제30회 노인의 날 기념행사 개최</strong><li class="regDate">2026-09-30</li></a>';
const large='<html><svg><image xlink:href="data:image/png;base64,'+'A'.repeat(RELAY_MAX_BYTES)+'" aria-label="PUBLIC-DECORATION"></image></svg>'+card+'</html>';
function project(cases){
  const ps=`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'","''")}',[ref]$tokens,[ref]$errors)
if($errors.Count -gt 0){throw 'PowerShell syntax error'}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Convert-GeumsanPressPayload'},$true)
if(-not $fn){throw 'Geumsan projection missing'}
. ([ScriptBlock]::Create($fn.Extent.Text))
$inputRows=[Console]::In.ReadToEnd() | ConvertFrom-Json
$results=@(foreach($row in $inputRows){
  $bytes=[Convert]::FromBase64String($row.body)
  $out=Convert-GeumsanPressPayload $row.url $row.status $row.contentType $bytes
  @{bytes=$out.Length;body=[Convert]::ToBase64String($out)}
})
ConvertTo-Json -InputObject $results -Compress
`;
  const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{input:JSON.stringify(cases.map(r=>({url:endpoint,status:200,contentType:'text/html; charset=UTF-8',...r,body:Buffer.from(r.html).toString('base64')}))),encoding:'utf8',maxBuffer:25_000_000,timeout:30000,windowsHide:true});
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout).map(r=>({...r,text:Buffer.from(r.body,'base64').toString('utf8')}));
}

test('금산 PC 전처리는 대형 인라인 이미지만 제거하고 다른 기관·보안응답·인코딩은 그대로 둔다',{skip:process.platform!=='win32'},()=>{
  const fixture=large.replace('</html>','<div>CAPTCHA_DETECTED / 웹 방화벽 / 로그인 필요</div></html>');
  const rows=project([{html:fixture},{html:large,url:'https://other.go.kr/kr/html/sub03/030301.html'},{html:large,url:endpoint+'/other'},{html:large,status:403},{html:large,contentType:'text/html; charset=euc-kr'},{html:card},{html:large+'A'.repeat(1_100_000)}]);
  assert.ok(rows[0].bytes<RELAY_MAX_BYTES);
  assert.ok(rows[0].text.includes(card));
  assert.ok(rows[0].text.includes('CAPTCHA_DETECTED / 웹 방화벽 / 로그인 필요'));
  assert.ok(rows[0].text.includes('PUBLIC-DECORATION'));
  for(const i of [1,2,3,4])assert.equal(rows[i].text,large);
  assert.equal(rows[5].text,card);
  assert.equal(rows[6].text,large+'A'.repeat(1_100_000));
});

test('금산 HTTP200 본문 누락 FEED_EMPTY 재현 후 전처리 payload가 기존 relay로 수집·재수집 중복 방지된다',{skip:process.platform!=='win32'},async()=>{
  const [projected]=project([{html:large}]);
  const db=database();
  let seq=0;let now=NOW;
  const deps={now:()=>now,newId:()=> 'geumsan-fixture-'+(++seq)};
  try{
    assert.ok(Buffer.byteLength(large)>RELAY_MAX_BYTES);
    assert.equal(await setPressApproval(db,sourceId,'approve',now),true);
    await claimRelayJobs(db,'geumsan-fixture',now);
    const before=await processRelayResult(db,'geumsan-fixture',sourceId,[{url:endpoint,status:200,contentType:'text/html; charset=UTF-8'}],deps);
    assert.equal(before.errorCode,'FEED_EMPTY');
    now+=100000;
    await claimRelayJobs(db,'geumsan-fixture',now);
    const upload=[{url:endpoint,status:200,contentType:'text/html; charset=UTF-8',bodyBase64:projected.body}];
    const after=await processRelayResult(db,'geumsan-fixture',sourceId,upload,deps);
    assert.equal(after.status,'succeeded');
    assert.equal(after.counts.created,1);
    now+=100000;
    await claimRelayJobs(db,'geumsan-fixture',now);
    const again=await processRelayResult(db,'geumsan-fixture',sourceId,upload,deps);
    assert.equal(again.status,'succeeded');
    assert.equal(again.counts.created,0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_item WHERE source_id=?').get(sourceId).n,1);
  }finally{db.sqlite.close();}
});

test('공식 실제 제목: 노후산업단지·노후주거지는 노인이 아니며 노인·청년 동시 대상은 보존한다',()=>{
  const industrial='“청년에겐 문화공간, 기업에는 성장공간” 경남도, 노후산업단지 환경조성 전국 최대 국비 1...';
  assert.equal(classifyTitle(industrial).status,'NON_WELFARE');
  assert.deepEqual(classifyTitle('계양구, ‘계산1동 노후주거지 외부 집수리 지원대상 선정’').categories,['housing']);
  assert.ok(classifyTitle("청년 홍보단 20여 명, 노인일자리 카페 '할로마켓' 찾아").categories.includes('senior'));
  assert.ok(classifyTitle('건강한 백세 행복한 노후, 어른다운 노인으로… 제30회 노인의 날 기념식').categories.includes('senior'));
  assert.ok(classifyTitle('행복한 노후생활 준비 교육').categories.includes('senior'));
  assert.ok(!classifyTitle('노후 산업 단지 환경조성 사업').categories.includes('senior'));
  assert.ok(classifyTitle('노후산업단지 근로자와 어르신 복지 지원').categories.includes('senior'));
});
