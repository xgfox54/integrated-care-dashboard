import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {politeFetch} from './discover.mjs';
import {parseHtmlBoard} from '../../lib/press/html-board.ts';
import {classifyTitle} from '../../lib/press/classify.ts';
import {database} from '../../lib/press-test-support.mjs';
import {setPressApproval} from '../../lib/press/admin.ts';
import {claimRelayJobs,processRelayResult,RELAY_MAX_BYTES} from '../../lib/press/relay.ts';

const root=new URL('../../',import.meta.url);
const dir=new URL('.omo/evidence/geumsan-press-20261006/',root);
mkdirSync(dir,{recursive:true});
const id='src:www.geumsan.go.kr:press';
const db=database();
const script=fileURLToPath(new URL('public/press-relay/collect.ps1',root));
const sha=s=>createHash('sha256').update(s).digest('hex');
const result={invocation:'node scripts/press/verify-geumsan-20261006.mjs',checkedAt:new Date().toISOString(),productionWrites:false,authenticatedPcCollection:'PENDING_MAIN_DEPLOYMENT_AND_PC_SCRIPT_UPDATE'};
let now=Math.floor(Date.now()/1000),seq=0;
try{
  const source=db.sqlite.prepare('SELECT endpoint_url,adapter_profile FROM press_source WHERE source_id=?').get(id);
  const profile=JSON.parse(source.adapter_profile);
  const live=await politeFetch(source.endpoint_url);
  assert.equal(live.status,200);
  const html=live.text;
  const original=parseHtmlBoard(html,profile);
  assert.ok(original.length>=5);
  const utf8=Buffer.from(html,'utf8');
  assert.ok(utf8.length>RELAY_MAX_BYTES,'Live oversized case must remain reproducible');
  result.official={url:source.endpoint_url,status:live.status,contentType:live.contentType,bytes:utf8.length,sha256:sha(utf8),metadataCount:original.length};
  const ps=[
    "$ErrorActionPreference='Stop';$t=$null;$e=$null",
    "$a=[System.Management.Automation.Language.Parser]::ParseFile('"+script.replaceAll("'","''")+"',[ref]$t,[ref]$e)",
    "if($e.Count){throw 'PowerShell syntax error'}",
    "$f=$a.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Convert-GeumsanPressPayload'},$true)",
    ". ([ScriptBlock]::Create($f.Extent.Text))",
    "$r=[Console]::In.ReadToEnd() | ConvertFrom-Json",
    "$b=Convert-GeumsanPressPayload $r.url 200 $r.contentType ([Convert]::FromBase64String($r.body))",
    "[Convert]::ToBase64String($b)"
  ].join('\n');
  const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{input:JSON.stringify({url:source.endpoint_url,contentType:live.contentType,body:utf8.toString('base64')}),encoding:'utf8',maxBuffer:4_000_000,timeout:30000,windowsHide:true});
  assert.equal(run.status,0,run.stderr);
  const projected=Buffer.from(run.stdout.trim(),'base64');
  assert.ok(projected.length<RELAY_MAX_BYTES);
  const extracted=parseHtmlBoard(projected.toString('utf8'),profile);
  assert.deepEqual(extracted,original,'All title/date/link/IDs unchanged');
  result.projection={bytes:projected.length,sha256:sha(projected),sameMetadata:true,scriptSha256:sha(readFileSync(script))};
  result.items=extracted.map(({title,pubDate,link})=>({title,date:pubDate,link}));
  assert.equal(await setPressApproval(db,id,'approve',now),true);
  const deps={now:()=>now,newId:()=> 'live-geumsan-'+(++seq)};
  await claimRelayJobs(db,'local-live-replay',now);
  result.before=await processRelayResult(db,'local-live-replay',id,[{url:source.endpoint_url,status:200,contentType:live.contentType}],deps);
  assert.equal(result.before.errorCode,'FEED_EMPTY');
  now+=100000;
  await claimRelayJobs(db,'local-live-replay',now);
  const upload=[{url:source.endpoint_url,status:200,contentType:live.contentType,bodyBase64:projected.toString('base64')}];
  result.after=await processRelayResult(db,'local-live-replay',id,upload,deps);
  assert.equal(result.after.status,'succeeded');
  assert.equal(result.after.counts.created,original.length);
  now+=100000;
  await claimRelayJobs(db,'local-live-replay',now);
  result.repeat=await processRelayResult(db,'local-live-replay',id,upload,deps);
  assert.equal(result.repeat.status,'succeeded');
  assert.equal(result.repeat.counts.created,0);
  const api=await fetch('https://integrated-care-national-dashboard.xgfox54.chatgpt.site/api/press?category=senior&size=100');
  assert.equal(api.status,200);
  const publicRows=(await api.json()).items.filter(r=>/노후산업단지|노후주거지/.test(r.title));
  assert.equal(publicRows.length,2);
  result.classification=[];
  for(const row of publicRows){
    const originalResponse=await politeFetch(row.original_url);
    assert.equal(originalResponse.status,200);
    const term=row.title.includes('노후산업단지')?'노후산업단지':'노후주거지';
    assert.ok(originalResponse.text.includes(term));
    const after=classifyTitle(row.title);
    assert.ok(!after.categories.includes('senior'));
    result.classification.push({title:row.title,url:row.original_url,officialHttp:200,officialSha256:sha(originalResponse.text),termPresent:true,before:row.category_ids,after});
  }
  result.pass=true;
}finally{
  db.sqlite.close();
  writeFileSync(new URL('live-replay.json',dir),JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({pass:result.pass,beforeBytes:result.official.bytes,afterBytes:result.projection.bytes,metadata:result.items.length,sameMetadata:result.projection.sameMetadata,beforeError:result.before.errorCode,after:result.after.status,created:result.after.counts.created,repeatCreated:result.repeat.counts.created,classificationSamples:result.classification.length,authenticatedPcCollection:result.authenticatedPcCollection}));
