import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {politeFetch} from './discover.mjs';
import {database} from '../../lib/press-test-support.mjs';
import {parseHtmlBoard} from '../../lib/press/html-board.ts';
import {setPressApproval} from '../../lib/press/admin.ts';
import {claimRelayJobs,processRelayResult} from '../../lib/press/relay.ts';

const evidence=new URL('../../../../.omo/evidence/busan-namgu-20261006/',import.meta.url);
mkdirSync(evidence,{recursive:true});
const db=database();
const source=db.sqlite.prepare('SELECT source_id,endpoint_url,adapter_profile FROM press_source WHERE source_id=?').get('src:www.bsnamgu.go.kr:press');
db.sqlite.close();
const logs=JSON.parse(readFileSync(new URL('../press-two-pc-natural-20261006-1205/desktop-final.json',evidence),'utf8'));
const result={checkedAt:new Date().toISOString(),invocation:'node scripts/press/verify-busan-namgu-20261006.mjs',source,observed:logs.sanitizedLogRecords.filter(r=>r.source===source.source_id),requests:[],productionWrites:false};
for(const accept of ['text/html','text/html,application/xhtml+xml']){
  const response=await politeFetch(source.endpoint_url,accept);
  const html=response.text??'';
  const items=response.status===200?parseHtmlBoard(html,JSON.parse(source.adapter_profile)):[];
  result.requests.push({accept,url:response.url,status:response.status,error:response.error,contentType:response.contentType,bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),pageTitle:/<title[^>]*>([^<]*)/i.exec(html)?.[1],accessControl:/captcha|access denied|request rejected|웹\s*방화벽|접근이?\s*차단/i.test(html),items:items.map(({title,pubDate,link})=>({title,date:pubDate,link})),errorMarkers:['Bad Request','Invalid character','Required','필수','잘못된 요청'].filter(s=>html.includes(s))});
}
writeFileSync(new URL('probe.json',evidence),JSON.stringify(result,null,2)+'\n');
const script=fileURLToPath(new URL('../../public/press-relay/collect.ps1',import.meta.url));
const ps=`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$t=$null;$e=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'","''")}',[ref]$t,[ref]$e)
if($e.Count){throw 'PowerShell parse error'}
foreach($name in @('Get-Page','Convert-GeumsanPressPayload')){
  $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  . ([ScriptBlock]::Create($fn.Extent.Text))
}
$webHandler=New-Object System.Net.Http.HttpClientHandler
$webHandler.AllowAutoRedirect=$false
$webHandler.UseCookies=$false
$webHandler.AutomaticDecompression=[Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$Web=New-Object System.Net.Http.HttpClient($webHandler)
$Web.Timeout=[TimeSpan]::FromSeconds(20)
$UserAgent='IntegratedCareDashboard-PressArchive/1.0';$MaxBytes=2000000;$LastHit=@{}
try { Get-Page ([Console]::In.ReadToEnd()) 'text/html' 2 | ConvertTo-Json -Compress } finally {$Web.Dispose();$webHandler.Dispose()}
`;
const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{input:source.endpoint_url,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:4000000});
if(run.status!==0)throw new Error('PowerShell HTTP probe failed, exit '+run.status);
const page=JSON.parse(run.stdout);
const psHtml=Buffer.from(page.bodyBase64??'','base64').toString('utf8');
const psItems=page.status===200?parseHtmlBoard(psHtml,JSON.parse(source.adapter_profile)):[];
result.installedFunction={status:page.status,contentType:page.contentType,bytes:Buffer.byteLength(psHtml),sha256:createHash('sha256').update(psHtml).digest('hex'),pageTitle:/<title[^>]*>([^<]*)/i.exec(psHtml)?.[1],items:psItems.map(({title,pubDate,link})=>({title,date:pubDate,link})),errorMarkers:['Bad Request','Invalid character','Required','필수','잘못된 요청','Request header is too large','Invalid HTTP request header','Invalid character found in method name','Invalid character found in the request target','The request was rejected','Access Denied','Web Firewall'].filter(s=>psHtml.includes(s))};
writeFileSync(new URL('client-comparison.json',evidence),JSON.stringify(result,null,2)+'\n');
try{
  assert.equal(page.status,200);
  assert.ok(psItems.length>0);
  for(const request of result.requests){
    assert.equal(request.status,200);
    assert.deepEqual(request.items,result.installedFunction.items);
  }
  result.detailChecks=[];
  for(const item of psItems.slice(0,2)){
    const detail=await politeFetch(item.link,'text/html');
    const html=detail.text??'';
    const plain=html.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
    const check={url:item.link,status:detail.status,title:item.title,date:item.pubDate,titlePresent:plain.includes(item.title),datePresent:html.includes(item.pubDate),sha256:createHash('sha256').update(html).digest('hex')};
    result.detailChecks.push(check);
    assert.equal(detail.status,200);
    assert.equal(check.titlePresent,true);
    assert.equal(check.datePresent,true);
  }
  const memory=database();
  let now=Math.floor(Date.now()/1000),seq=0;
  const deps={now:()=>now,newId:()=> 'namgu-replay-'+(++seq)};
  try{
    assert.equal(await setPressApproval(memory,source.source_id,'approve',now),true);
    await claimRelayJobs(memory,'local-namgu-verification',now);
    result.simulated400=await processRelayResult(memory,'local-namgu-verification',source.source_id,[{url:source.endpoint_url,status:400,contentType:'text/html'}],deps);
    assert.equal(result.simulated400.errorCode,'UNEXPECTED_STATUS');
    now+=100000;
    await claimRelayJobs(memory,'local-namgu-verification',now);
    result.livePayloadReplay=await processRelayResult(memory,'local-namgu-verification',source.source_id,[page],deps);
    assert.equal(result.livePayloadReplay.status,'succeeded');
    assert.equal(result.livePayloadReplay.counts.created,psItems.length);
    now+=100000;
    await claimRelayJobs(memory,'local-namgu-verification',now);
    result.repeatedPayloadReplay=await processRelayResult(memory,'local-namgu-verification',source.source_id,[page],deps);
    assert.equal(result.repeatedPayloadReplay.counts.created,0);
  }finally{memory.sqlite.close();}
  result.verificationPass=true;
}finally{
  result.rootCause='UNCONFIRMED: recorded 400 was not reproduced by current Node or isolated Windows Get-Page; original failure body, headers and endpoint are absent from sanitized log.';
  result.runtimeFix=false;
  result.operationalRecovery='NOT_VERIFIED';
  writeFileSync(new URL('verification.json',evidence),JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({verificationPass:result.verificationPass,node:result.requests.map(r=>({accept:r.accept,status:r.status,items:r.items.length})),powershell:{status:page.status,items:psItems.length},details:result.detailChecks,simulated400:result.simulated400?.errorCode,replayCreated:result.livePayloadReplay?.counts.created,repeatedCreated:result.repeatedPayloadReplay?.counts.created,rootCause:result.rootCause,runtimeFix:false,operationalRecovery:result.operationalRecovery},null,2));
