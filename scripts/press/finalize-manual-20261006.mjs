// Build the bounded review deliverables; validate SQL only in an in-memory database.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { strict as assert } from 'node:assert';
import { parseBoardProfile } from '../../lib/press/html-board.ts';
import { PRESS_COLLECTION_HOURS_KST } from '../../lib/press/schedule.ts';

const root = new URL('../../', import.meta.url);
const dir = '.omo/evidence/press-manual-20261006/';
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));
const write = (path, value) => writeFileSync(new URL(path, root), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = json('docs/press/discovery/robots-exempt-2026-10-06.json');
const baseline = json(dir + 'baseline.json');
assert.equal(hash(read('docs/press/discovery/robots-exempt-2026-10-06.json')), baseline.input_sha256);
const targets = source.results.filter((r) => r.status === 'CANDIDATE_NEEDS_REVIEW');
assert.equal(targets.length, 30);
const key = (id) => encodeURIComponent(id).replaceAll('%', '_');
const rows = targets.map((target) => {
  const corrected = dir + 'verify3-' + key(target.id) + '.json';
  const artifact = existsSync(new URL(corrected, root)) ? corrected : dir + 'verify2-' + key(target.id) + '.json';
  assert.ok(statSync(new URL(artifact, root)).size > 0);
  const row = json(artifact);
  assert.equal(row.id, target.id);
  assert.ok(row.requests.some((r) => r.purpose === 'official_list'));
  return { ...row, artifact, source_id: target.kind === 'metro' ? 'src:' + target.metroKey + ':press' : 'src:' + new URL(row.endpoint).hostname + ':press' };
});
const reasons = {
  'org:경상남도': '기존 BBS_0000057은 2022년 공지사항 목록. 공식 도청 홈페이지까지 확인했으나 현 보도자료 상세 프로필 미확정.',
  'org:경상북도:봉화군': '언론보도 목록 9건과 원문 2건 제목 일치. 군 자체 보도자료와 언론기사 모음의 구분을 확정하지 않아 등록 보류.',
  'org:경상북도:성주군': '목록 10건 날짜 확인. 원문 GET 2건에서 목록 제목 불일치(동적 상세 표시 가능).',
  'org:대구광역시:달서구': '언론보도자료 목록의 제목 링크가 fn_icms_navi_common 호출. 상세 주소와 기존 어댑터 프로필 미확정.',
  'org:부산광역시:강서구': '기존 후보는 고시공고. 공식 첫 화면에서 bcIdx=526 보도자료 목록을 찾아 HTTP 200 확인, 상세 프로필 미확정.',
  'org:부산광역시:남구': '공식 보도자료 iframe의 새올 목록 HTTP 200 확인. 별도 상세 이동 프로필 미확정.',
  'org:서울특별시:양천구': '목록 제목을 script로 출력하여 현재 선언형 프로필은 제목 0건. 이동 함수 주소는 확인했으나 수집 가능한 프로필 미확정.',
  'org:서울특별시:용산구': '실제 원문 링크 10건 및 첫 2건 제목 일치. 1건 날짜가 어댑터 구간 상한 밖에 있어 날짜 9/10건, 등록 보류.',
  'org:서울특별시:종로구': '실제 원문 링크 20건 및 첫 2건 제목 일치. 날짜는 1/20건만 추출되어 등록 보류.',
  'org:전남광주통합특별시:남구': '공식 iframe의 새올 보도자료 목록 HTTP 200 확인. 상세 이동·날짜·제목 프로필 미확정.',
  'org:전남광주통합특별시:북구': '공식 iframe의 새올 보도자료 목록 HTTP 200 확인. 상세 이동·날짜·제목 프로필 미확정.',
  'org:전남광주통합특별시:서구': '정상 JavaScript의 CAPTCHA 문자열을 차단으로 오인한 탐지기 결함 정정(동일 URL·응답 SHA-256 확인). 수정 후 재검증: 목록 10개 ID 중 제목 6건만 추출되어 검토필요. WAF 차단으로 확정하지 않음.',
  'org:충청북도': '공식 메뉴의 실제 bbsNo=65로 수정해 목록 열람. 제목 요소가 기존 프로필과 맞지 않아 추출 0건, 등록 보류.',
  'org:충청북도:영동군': '기존 후보는 공지사항. 공식 홈페이지·기존 목록·게시판 스크립트 범위에서 보도자료 경로 미확정.',
};
for (const row of rows) row.reason_ko = reasons[row.id] ?? '공식 보도자료 목록 메타데이터와 상세 원문 2건 제목 일치 확인';
const verified = rows.filter((row) => row.status === 'COMPLETE');
for (const row of verified) {
  assert.ok(parseBoardProfile(JSON.stringify(row.profile)), row.id);
  assert.ok(row.items.length >= 5 && row.dated === row.items.length, row.id);
  assert.equal(row.detail_checks.length, 2);
  assert.ok(row.detail_checks.every((d) => d.http_ok && d.title_match));
  assert.ok(!row.requests.some((r) => r.security));
  for (const item of row.items) {
    assert.ok(item.title.length > 0 && item.title.length <= 150);
    assert.equal(new Date(item.date).toISOString().slice(0, 10), item.date);
    const checkedDayKst = new Date(Date.parse(row.checked_at) + 9 * 3600000).toISOString().slice(0, 10);
    assert.ok(item.date <= checkedDayKst, row.id + ': future publication date');
    assert.ok(item.link.startsWith('https://'));
    assert.equal(new URL(item.link).hostname, new URL(row.profile.url).hostname);
  }
  assert.ok(row.items.some((item) => Date.parse(row.checked_at) - Date.parse(item.date) < 366 * 86400000));
}
assert.deepEqual([...PRESS_COLLECTION_HOURS_KST], [9, 12, 15, 18]);
const version = 'registry-2026-10-06-manual30';
const migrationName = '0081_press_manual30_reverify.sql';
const migrationPath = 'drizzle/' + migrationName;
const registryPath = 'docs/press/discovery/manual30-registry-20261006.json';
const quote = (value) => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
const columns = ['source_id','organization_id','method','adapter','homepage_url','endpoint_url','allowed_hosts','verification_status','verification_note','endpoint_verified_at','approval_status','enabled','policy_basis','robots_exempt','adapter_profile','registry_version','collect_via'];
const statements = ['-- Verified official press metadata routes only; local PC verification, no deployment.', '-- Schedule remains 09/12/15/18 KST. New sources remain disabled pending existing approval flow.', '-- Evidence: docs/acceptance/PRESS_MANUAL30_REVERIFY_2026-10-06.md'];
for (const row of verified) {
  const basis = '운영자 승인(2026-10-06): 공개 행정기관 보도자료 목록의 제목·게시일·원문 링크만 수집. robots 예외 대상: ' + row.endpoint;
  const values = [row.source_id,row.id,'HTML','HTMLBoardAdapter',row.homepage,row.endpoint,JSON.stringify([new URL(row.profile.url).hostname]),'ENDPOINT_VERIFIED','PC 실측: 목록 '+row.items.length+'건 날짜·제목·링크 및 상세 2건 제목 일치; '+row.artifact,Math.floor(Date.parse(row.checked_at)/1000),'PENDING_PERMISSION',0,basis,basis,JSON.stringify(row.profile),version,'relay'];
  statements.push('--> statement-breakpoint', 'INSERT INTO press_source ('+columns.join(', ')+') VALUES ('+values.map(quote).join(', ')+') ON CONFLICT(source_id) DO UPDATE SET endpoint_url=excluded.endpoint_url, allowed_hosts=excluded.allowed_hosts, verification_status=excluded.verification_status, verification_note=excluded.verification_note, endpoint_verified_at=excluded.endpoint_verified_at, policy_basis=excluded.policy_basis, robots_exempt=excluded.robots_exempt, adapter_profile=excluded.adapter_profile, registry_version=excluded.registry_version, method=excluded.method, adapter=excluded.adapter, collect_via=excluded.collect_via;', '--> statement-breakpoint', 'UPDATE press_org_survey SET survey_category=\'endpoint_confirmed\', survey_detail=\'MANUAL30_PC_VERIFIED\', survey_reason='+quote('목록 '+row.items.length+'건과 상세 원문 2건 확인. PC 중계 대상. 운영 수집 미검증.')+', endpoint_url='+quote(row.endpoint)+', checked_at='+quote(row.checked_at)+', registry_version='+quote(version)+' WHERE organization_id='+quote(row.id)+';');
}
const sql = statements.join('\n')+'\n';
if (existsSync(new URL(migrationPath, root))) assert.equal(read(migrationPath),sql,'Existing migration belongs to another change or a different result');
else write(migrationPath,sql);
const counts = rows.reduce((acc,row)=>({...acc,[row.status]:(acc[row.status]??0)+1}),{COMPLETE:0,REVIEW_NEEDED:0,BLOCKED:0});
write(registryPath,{registry_version:version, scope:'Only the 30 CANDIDATE_NEEDS_REVIEW rows in the pinned input; no nationwide completeness claim', input_sha256:baseline.input_sha256, counts, sources:verified.map(({id,source_id,endpoint,profile,artifact,items})=>({organization_id:id,source_id,endpoint_url:endpoint,adapter_profile:profile,collect_via:'relay',approval_status:'PENDING_PERMISSION',enabled:0,evidence:artifact,metadata_count:items.length})), outcomes:rows.map(({id,name,status,reason_ko,artifact,endpoint,items})=>({id,name,status,reason:reason_ko,evidence:artifact,endpoint,metadata_count:items.length}))});

const db = new DatabaseSync(':memory:');
const priorMigrations = readdirSync(new URL('drizzle/',root)).filter((name)=>name.endsWith('.sql')&&name<migrationName).sort();
for (const name of priorMigrations) db.exec(read('drizzle/'+name));
const before = new Map(db.prepare('SELECT source_id,approval_status,enabled,collect_via FROM press_source').all().map((row)=>[row.source_id,row]));
db.exec(sql);
const afterFirst = db.prepare('SELECT source_id,organization_id,endpoint_url,adapter_profile,approval_status,enabled,collect_via FROM press_source WHERE registry_version=? ORDER BY source_id').all(version);
assert.equal(afterFirst.length,verified.length);
for(const row of afterFirst){
  assert.equal(row.collect_via,'relay');
  assert.equal(row.approval_status,before.get(row.source_id)?.approval_status??'PENDING_PERMISSION');
  assert.equal(row.enabled,before.get(row.source_id)?.enabled??0);
  assert.ok(parseBoardProfile(row.adapter_profile));
}
db.exec(sql);
assert.deepEqual(db.prepare('SELECT source_id,organization_id,endpoint_url,adapter_profile,approval_status,enabled,collect_via FROM press_source WHERE registry_version=? ORDER BY source_id').all(version),afterFirst);
db.close();
write(dir+'migration-validation.json',{invocation:'node scripts/press/finalize-manual-20261006.mjs',scenario:'All prior repository SQL migrations in a fresh in-memory SQLite database; apply new migration twice; check profiles, count, relay route and approval preservation',pass:true,prior_migrations:priorMigrations.length,registered:afterFirst.length,idempotent:true,approval_preserved:true,new_sources_disabled:true,production_database_accessed:false,rows:afterFirst,sql_sha256:hash(sql)});

const build = spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024,timeout:180000,windowsHide:true});
write(dir+'build.log',(build.stdout??'')+'\n'+(build.stderr??'')+'\nEXIT_CODE='+build.status+'\n'+(build.error?.message??''));
const currentHashes=Object.fromEntries(Object.keys(baseline.protected_hashes).map((p)=>[p,hash(readFileSync(new URL(p,root)))]));
const concurrentChanges=Object.keys(currentHashes).filter((p)=>currentHashes[p]!==baseline.protected_hashes[p]);
write(dir+'scope-validation.json',{invocation:'node scripts/press/finalize-manual-20261006.mjs',scenario:'Pinned discovery hash; protected file hashes; runtime collection slots',input_unchanged:true,schedule_hours:[...PRESS_COLLECTION_HOURS_KST],schedule_hash_unchanged:currentHashes['lib/press/schedule.ts']===baseline.protected_hashes['lib/press/schedule.ts'],protected_hashes_before:baseline.protected_hashes,protected_hashes_after:currentHashes,concurrent_changes:concurrentChanges,git_status:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}),build_exit:build.status});
const label={COMPLETE:'완료',REVIEW_NEEDED:'검토필요',BLOCKED:'차단'};
const report=[
  '# 보도자료 수동검토 30곳 재검증 (2026-10-06)', '',
  `WORKING 종료: 완료 ${counts.COMPLETE??0}, 검토필요 ${counts.REVIEW_NEEDED??0}, 차단 ${counts.BLOCKED??0}.`,
  '완료는 이 PC에서 공식 목록의 날짜·제목·원문 링크 및 상세 원문 2건을 확인하고 기존 HTMLBoardAdapter 프로필 검사를 통과했다는 뜻이다. 운영 수집, 서버 환경, 전국 누락 없는 수집 완료를 뜻하지 않는다.', '',
  '대상은 robots-exempt-2026-10-06.json의 CANDIDATE_NEEDS_REVIEW 30행이다. 운영 요약과 달리 ACCESS_ERROR 성동구·NO_BOARD_FOUND 여주시 및 기존 오탐 남양주시·산청군 4행은 별도 경계 점검이며 이 마이그레이션에서 제외했다.',
  '경계 점검: 남양주 목록 8건 및 원문 2건 확인; 성동구 TLS 인증서 체인 오류 지속; 여주 기존 주소는 신청사 전용 사이트; 산청 기존 주소는 시설 프로그램으로 현 군정홍보 메뉴 재발견까지만 확인. 경계 증거는 verify2 기관별 JSON에 있다.', '',
  '## 통합 산출물', '',
  `- 새 마이그레이션: ../../${migrationPath}`,
  `- Registry용 JSON: ../press/discovery/manual30-registry-20261006.json`,
  '- 새 프로필 초안: ../press/discovery/manual-profiles-20261006.json (검토 중 프로필도 포함하므로 이 파일 전체를 등록하면 안 됨)',
  '- 수집 경로: 검증 환경에 맞춰 collect_via=relay. 신규 행 enabled=0·PENDING_PERMISSION, 기존 행의 승인·enabled는 보존. 운영 적용·수집·배포·커밋 없음.',
  '- 정기 시각: 매일 09·12·15·18시 KST 유지. 로컬 스케줄 export/파일 해시를 확인했고 운영 예약 설정에는 접근하지 않았다.', '',
  '## 기관별 결과', '',
  '|기관 ID|결과|확정 메타데이터|실측 주소·사유|증거|',
  '|---|---|---:|---|---|',
  ...rows.map(r=>`|${r.id}|${label[r.status]}|${r.items.length}|[공식 주소](${r.endpoint}) ${r.reason_ko}|[JSON](../../${r.artifact})|`), '',
  '## 완료 기관의 실제 표본', '',
  '|기관|게시일|제목·원문|', '|---|---|---|',
  ...verified.map(r=>`|${r.sido} ${r.name}|${r.items[0].date}|[${r.items[0].title.replaceAll('|','/').replaceAll('[','(').replaceAll(']',')')}](${r.items[0].link})|`), '',
  '## 실행·판정·증거', '',
  '|시나리오|호출|이진 관측|산출물|', '|---|---|---|---|',
  `|실제 30행 식별 및 공식 HTTP 재검증|node --use-system-ca scripts/press/reverify-manual-20261006.mjs verify2|30/30 공식 목록 요청 기록 존재, 완료 ${verified.length}곳은 날짜 전건 및 상세 2건 제목 일치|[최종 판정](../../${registryPath}), 기관별 JSON (서구는 verify3 정정)|`,
  `|보안 신호 검증·추출 누락 보류|node --use-system-ca scripts/press/reverify-manual-20261006.mjs verify3 seogu.gwangju|정상 JS와 동일 해시 확인; 원문 2건 일치지만 제목 6/10건으로 등록 제외|[신호 정정](../../${dir}security-signal-review.json), [재검증](../../${dir}verify3-${key('org:전남광주통합특별시:서구')}.json)|`,
  `|실제 SQL 통합·재적용|node scripts/press/finalize-manual-20261006.mjs|PASS; 기존 ${priorMigrations.length}개 SQL 뒤 ${verified.length}행, 2회 적용 동일, 승인 보존|[SQL 검증](../../${dir}migration-validation.json)|`,
  `|공유 체크아웃 빌드|node scripts/run-framework.mjs build|${build.status===0?'PASS':'FAIL'} (exit ${build.status})|[build.log](../../${dir}build.log)|`,
  `|일정·범위 보존|node scripts/press/finalize-manual-20261006.mjs|4개 정기 시각 확인, 원본 discovery 해시 동일|[범위 기록](../../${dir}scope-validation.json)|`, '',
  '공유 작업트리의 다른 변경: '+(concurrentChanges.length?concurrentChanges.join(', '):'기록한 보호 파일 해시 변화 없음')+'. 이 작업은 해당 파일을 수정하지 않았다. 빌드는 공유 체크아웃 전체 결과이며 이 작업 단독 결과와 구분한다.',
  '보안 신호 정정: 초기 routes/verify2의 서구 BLOCKED는 탐지기 오탐이므로 최종 판정에 사용하지 않는다. 동일 주소에 동일 GET으로 정상 text/javascript·39개 함수·HTML 문서 아님·동일 응답 해시를 확인했다. CAPTCHA 해결, 인증, 프록시, IP/헤더 교체 등의 우회는 없었다. 이번 30곳에서 확정된 보안 차단은 0이며 별도 경계 점검 성동구는 TLS 오류로 접근 차단이다.',
  '게시판 원문 본문은 메모리에서 제목 대조 후 폐기했고 저장하지 않았다. 첨부파일은 다운로드하지 않았다. 산출물은 메타데이터, URL/HTTP 상태/응답 해시, 공개 목록 구조 및 이동 코드만 포함한다. 인증키·쿠키·토큰을 읽거나 사용하지 않았고 URL 세션값은 제거했다.',
  '공식 API/RSS 링크는 목록·홈페이지에 명시된 주소만 기록했다. 새 API 인증·활용신청은 수행하지 않았고, API/RSS가 전국적으로 없다는 뜻이 아니다. 일반 프로그래밍과 기존 로컬 도구 사용으로 새 라이브러리 문서가 필요하지 않아 Context7 질의는 발생하지 않았다.',
  'ulw-loop 상태: bundled CLI status --json = ULW_LOOP_PLAN_MISSING. 활성 attempt가 없어 .omo/evidence/press-manual-20261006/에 기록했다.', ''
];
write('docs/acceptance/PRESS_MANUAL30_REVERIFY_2026-10-06.md',report.join('\n'));
const artifactPaths=[registryPath,migrationPath,'docs/acceptance/PRESS_MANUAL30_REVERIFY_2026-10-06.md',...readdirSync(new URL(dir,root)).filter(f=>f.endsWith('.json')||f.endsWith('.log')).filter(f=>f!=='manifest.json').map(f=>dir+f)];
const artifacts=artifactPaths.map(path=>({path,bytes:statSync(new URL(path,root)).size,sha256:hash(readFileSync(new URL(path,root)))}));
assert.ok(artifacts.every(a=>a.bytes>0));
write(dir+'manifest.json',{at:new Date().toISOString(),target_count:30,counts,migration:migrationPath,registered:verified.length,build_exit:build.status,artifacts});
console.log(JSON.stringify({counts,registered:verified.length,migration:migrationPath,build_exit:build.status,report:'docs/acceptance/PRESS_MANUAL30_REVERIFY_2026-10-06.md',evidence:dir+'manifest.json'}));
if(build.status!==0)process.exitCode=1;
