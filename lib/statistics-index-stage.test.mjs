import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { database } from './press-test-support.mjs';
import { runStatisticsRefresh } from './statistics/background.ts';
import { claimStatisticsWorker, releaseStatisticsWorker, STATISTICS_DAY } from './statistics/store.ts';
const NOW = Date.parse('2026-10-15T00:00:00Z');
const fixtures = JSON.parse(readFileSync(new URL('./statistics/fixtures/index-expanded.json', import.meta.url)));
async function setup(t) {
  const db = database(); t.after(() => db.sqlite.close());
  await claimStatisticsWorker(db, NOW, 'setup'); await releaseStatisticsWorker(db, 'setup');
  db.sqlite.prepare('UPDATE statistics_refresh_worker SET host_state_json = ?').run(JSON.stringify({'https://www.index.go.kr':{api_enabled:true,next_request_at:0}}));
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET error_code = 'SOURCE_TIMEOUT' WHERE scope_id = 'stat:2770'").run();
  const context = { db, now: NOW, calls: [], response: code => Response.json(fixtures.find(row => row.table_code === code).rows),
    row: () => db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = 'stat:2770'").get(),
    run: extra => runStatisticsRefresh(db, {scopeId:'stat:2770', force:true, maxSteps:1, readIndexKey:async ()=>'fixture-secret', now:()=>context.now,
      sleep:async ms=>{context.now+=ms}, fetcher:async url=>{const code=new URL(url).searchParams.get('statsCode');context.calls.push(code);context.now+=11000;return context.response(code)}, ...extra}) };
  return context;
}
test('two-table 12s retry resumes the first successful table across bounded invocations', async t => {
  // Given a prior timeout and 11s source responses within a 22s invocation.
  const f = await setup(t);
  // When two bounded refresh invocations run.
  const first = await f.run(); const staged = f.row(); const second = await f.run();
  // Then no partial publication, no refetch, and complete publication.
  assert.equal(first.status, 'continuation_pending'); assert.equal(staged.result_json,null);
  assert.ok(staged.stage_json); assert.doesNotMatch(staged.stage_json,/fixture-secret|idntfcId/);
  assert.equal(second.completed,1); assert.deepEqual(f.calls,['277002','277003']); assert.equal(f.row().stage_json,null);
});
test('second-table failure retains published snapshot and resumes after Retry-After', async t => {
  // Given an existing complete publication and a staged next refresh.
  const f = await setup(t);
  await f.run(); await f.run(); const published = f.row();
  f.now += STATISTICS_DAY;
  f.db.sqlite.prepare("UPDATE statistics_refresh_scope SET error_code = 'SOURCE_TIMEOUT' WHERE scope_id = 'stat:2770'").run();
  await f.run();
  f.response = () => new Response('provider failed', {status:429,headers:{'retry-after':'7200'}});
  // When the second table fails and a premature wake occurs.
  const failed = await f.run(); const retry = f.row(); const count=f.calls.length;
  await f.run();
  // Then the old snapshot stays intact and no request ignores provider backoff.
  assert.equal(failed.failed,1); assert.equal(retry.result_json,published.result_json); assert.equal(retry.revision,published.revision);
  assert.ok(retry.stage_json); assert.equal(f.calls.length,count); assert.equal(retry.next_check_at,f.now+7200000);
  f.now=retry.next_check_at;
  f.response=code=>Response.json(fixtures.find(row=>row.table_code===code).rows);
  assert.equal((await f.run()).completed,1);
  assert.deepEqual(f.calls,['277002','277003','277002','277003','277003']);
});

for (const [name, corrupt] of [
  ['expired', stage=>({...stage,started_at:NOW-STATISTICS_DAY})],
  ['future', stage=>({...stage,started_at:NOW+STATISTICS_DAY})],
  ['revision', stage=>({...stage,published_revision:'other'})],
  ['contract', stage=>({...stage,source_revision:'other'})],
  ['source ID', stage=>({...stage,parts:[{...stage.parts[0],table_code:'wrong'}]})],
  ['body', stage=>({...stage,parts:[{...stage.parts[0],body:'[]'}]})],
  ['duplicate', stage=>({...stage,parts:[stage.parts[0],stage.parts[0]]})],
]) test(`discards ${name} staging before requesting the source again`, async t=>{
  // Given a previously staged table with an invalid persisted envelope.
  const f=await setup(t); await f.run();
  f.db.sqlite.prepare("UPDATE statistics_refresh_scope SET stage_json = ? WHERE scope_id='stat:2770'").run(JSON.stringify(corrupt(JSON.parse(f.row().stage_json))));
  // When the next bounded invocation starts.
  await f.run({budgetMs:13000});
  // Then the first table is fetched afresh rather than trusted or published partially.
  assert.deepEqual(f.calls,['277002','277002']); assert.equal(f.row().result_json,null);
});

test('lost global lease cannot overwrite table staging or release a replacement lease', async t=>{
  // Given a source response that arrives after another worker claims the lease.
  const f=await setup(t);
  f.response=async code=>{
    const worker=f.db.sqlite.prepare('SELECT * FROM statistics_refresh_worker').get();
    f.now=worker.lease_expires_at+1;
    assert.ok(await claimStatisticsWorker(f.db,f.now,'replacement'));
    return Response.json(fixtures.find(row=>row.table_code===code).rows);
  };
  // When the late request attempts to persist its first table.
  const result=await f.run();
  // Then neither partial staging nor publication is written by the old worker.
  assert.equal(result.status,'lease_lost'); assert.equal(f.row().stage_json,null);assert.equal(f.row().result_json,null);
  assert.equal(f.db.sqlite.prepare('SELECT lease_token FROM statistics_refresh_worker').get().lease_token,'replacement');
});

test('host pacing survives a continuation in another invocation', async t=>{
  // Given a first table that finishes near the invocation budget with a future host slot.
  const f=await setup(t); const at=[];
  const fetcher=async url=>{at.push(f.now);const code=new URL(url).searchParams.get('statsCode');return f.response(code)};
  // When each invocation fits one request but cannot fit the following host pause.
  await f.run({budgetMs:13000,fetcher}); await f.run({budgetMs:16000,fetcher});
  // Then the persisted three-second host interval applies between invocations.
  assert.equal(at.length,2);assert.ok(at[1]-at[0]>=3000);assert.ok(f.row().result_json);
});
test('staging excludes response credentials and redacts echoed key text', async t=>{
  // Given valid source rows with an unexpected credential property and a key echo.
  const f=await setup(t);
  f.response=code=>Response.json(fixtures.find(row=>row.table_code===code).rows.map(row=>({...row,token:'unrelated-provider-secret',주석:String(row.주석 ?? '')+' fixture-secret'})));
  // When the first table is persisted for continuation.
  await f.run();
  // Then the staging envelope contains only source fields and redacted metadata.
  assert.ok(f.row().stage_json);assert.doesNotMatch(f.row().stage_json,/fixture-secret|unrelated-provider-secret|idntfcId/);
});
