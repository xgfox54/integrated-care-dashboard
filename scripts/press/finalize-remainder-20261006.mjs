import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {targets,evidence} from './reverify-remainder-20261006.mjs';
import {parseBoardProfile} from '../../lib/press/html-board.ts';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const migration='0082_press_remainder_verified.sql';
const version='registry-2026-10-06-remainder14';
const rows=targets.map(target=>{
  const artifact='verify-'+encodeURIComponent(target.id).replaceAll('%','_')+'.json';
  const row=JSON.parse(readFileSync(new URL(artifact,evidence),'utf8'));
  assert.equal(row.id,target.id);
  assert.ok(row.requests.some(r=>r.purpose==='official_list'));
  return {...row,artifact,source_id:target.kind==='metro'?'src:'+target.metroKey+':press':'src:'+new URL(row.homepage).hostname+':press'};
});
assert.equal(rows.length,14);
const verified=rows.filter(r=>r.status==='COMPLETE');
for(const r of verified){
  assert.ok(parseBoardProfile(JSON.stringify(r.profile)),r.id);
  assert.equal(r.items.length,r.expected_count,r.id);
  assert.equal(r.dated,r.items.length,r.id);
  assert.equal(new Set(r.items.map(i=>i.link)).size,r.items.length);
  assert.equal(r.detail_checks.length,2);
  assert.ok(r.detail_checks.every(d=>d.http_ok&&d.title_match&&(!d.ownership||Object.values(d.ownership).every(Boolean))));
  assert.ok(r.requests.every(q=>!q.security&&q.status===200));
  for(const i of r.items){
    assert.ok(i.title.length>0&&i.title.length<=150);
    assert.equal(new Date(i.date).toISOString().slice(0,10),i.date);
    assert.ok(i.date<=new Date(Date.parse(r.checked_at)+9*3600000).toISOString().slice(0,10));
    assert.equal(new URL(i.link).hostname,new URL(r.profile.url).hostname);
    assert.equal(new URL(i.link).protocol,'https:');
  }
  assert.ok(r.items.some(i=>Date.parse(r.checked_at)-Date.parse(i.date)<366*86400000));
}
const q=x=>typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
const cols=['source_id','organization_id','method','adapter','homepage_url','endpoint_url','allowed_hosts','verification_status','verification_note','endpoint_verified_at','approval_status','enabled','policy_basis','robots_exempt','adapter_profile','registry_version','collect_via'];
const sql=['-- Official metadata only. Evidence: docs/acceptance/PRESS_REMAINDER_2026-10-06.md',
'-- Preserve approval/enabled; existing OPERATOR_EXEMPT approval connects verified sources to PC relay.',
...verified.flatMap(r=>{
  const basis='운영자 승인(2026-10-06): 공식 보도자료 목록 제목·게시일·원문 링크만 수집; robots 예외. '+r.endpoint;
  const hosts=[...new Set([new URL(r.endpoint).hostname,new URL(r.profile.url).hostname])];
  const values=[r.source_id,r.id,'HTML','HTMLBoardAdapter',r.homepage,r.endpoint,JSON.stringify(hosts),'ENDPOINT_VERIFIED','공식 목록 '+r.items.length+'건 및 원문 2건 제목 대조; '+r.reason,Math.floor(Date.parse(r.checked_at)/1000),'PENDING_PERMISSION',0,basis,basis,JSON.stringify(r.profile),version,'relay'];
  return ['--> statement-breakpoint','INSERT INTO press_source ('+cols.join(', ')+') VALUES ('+values.map(q).join(', ')+') ON CONFLICT(source_id) DO UPDATE SET endpoint_url=excluded.endpoint_url, allowed_hosts=excluded.allowed_hosts, verification_status=excluded.verification_status, verification_note=excluded.verification_note, endpoint_verified_at=excluded.endpoint_verified_at, policy_basis=excluded.policy_basis, robots_exempt=excluded.robots_exempt, adapter_profile=excluded.adapter_profile, registry_version=excluded.registry_version, method=excluded.method, adapter=excluded.adapter, collect_via=excluded.collect_via;',
  '--> statement-breakpoint',"UPDATE press_org_survey SET survey_category='endpoint_confirmed', survey_detail='REMAINDER_PC_VERIFIED', survey_reason="+q('공식 목록 '+r.items.length+'건 및 원문 2건 확인. 운영 수집은 미확인.')+', endpoint_url='+q(r.endpoint)+', checked_at='+q(r.checked_at)+', registry_version='+q(version)+' WHERE organization_id='+q(r.id)+';'];
})].join('\n')+'\n';
if(process.argv.includes('--emit-patch')){
  const path='drizzle/'+migration;
  assert.ok(!existsSync(new URL(path,root)),'Migration number already used; do not overwrite');
  assert.ok(!readdirSync(new URL('drizzle/',root)).some(f=>f.endsWith('.sql')&&f>=migration),'Migration number collision');
  console.log('*** Begin Patch\n*** Add File: '+fileURLToPath(new URL(path,root)).replaceAll('\\','/')+'\n'+sql.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}else{
  assert.equal(read('drizzle/'+migration).trim(),sql.trim(),'Frozen migration and verified evidence differ');
  const db=new DatabaseSync(':memory:');
  const beforeFiles=readdirSync(new URL('drizzle/',root)).filter(f=>f.endsWith('.sql')&&f<migration).sort();
  try {
    for(const file of beforeFiles)db.exec(read('drizzle/'+file));
    const all=()=>db.prepare('SELECT * FROM press_source ORDER BY source_id').all();
    const before=all();
    db.exec(sql);
    const after=all();
    for(const r of before){
      const found=after.find(s=>s.source_id===r.source_id);
      assert.equal(found.approval_status,r.approval_status);
      assert.equal(found.enabled,r.enabled);
      if(!verified.some(v=>v.source_id===r.source_id))assert.deepEqual(found,r);
    }
    for(const r of verified){
      const found=after.find(s=>s.source_id===r.source_id);
      assert.equal(found.organization_id,r.id);
      assert.equal(found.collect_via,'relay');
      assert.equal(found.verification_status,'ENDPOINT_VERIFIED');
      assert.ok(parseBoardProfile(found.adapter_profile));
      if(!before.some(s=>s.source_id===r.source_id)){
        assert.equal(found.enabled,0);assert.equal(found.approval_status,'PENDING_PERMISSION');
      }
    }
    db.exec(sql);assert.deepEqual(all(),after);
    const summary={invocation:'node scripts/press/finalize-remainder-20261006.mjs',checked_at:new Date().toISOString(),pass:true,total:rows.length,verified:verified.length,pending:rows.length-verified.length,metadata:verified.reduce((n,r)=>n+r.items.length,0),detail_checks:verified.length*2,prior_migrations:beforeFiles.length,idempotent:true,approval_preserved:true,unrelated_sources_unchanged:true,production_database_accessed:false,migration,sql_sha256:hash(sql),outcomes:rows.map(r=>({id:r.id,status:r.status,source_id:r.source_id,endpoint:r.endpoint,count:r.items?.length??0,reason:r.reason,artifact:r.artifact}))};
    writeFileSync(new URL('finalize.json',evidence),JSON.stringify(summary,null,2)+'\n');
    console.log(JSON.stringify(summary));
  } finally {db.close();}
}
