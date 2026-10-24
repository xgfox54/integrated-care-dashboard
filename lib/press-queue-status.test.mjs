import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectionFixture, SOURCE_ID, NOW } from './press-test-support.mjs';
import { ensurePressSlots, readPressSlotStatus } from './press/jobs.ts';
import { readPressQueueStatus } from './press/queue-status.ts';
import { previousCollectionSlot } from './press/schedule.ts';

test('지금 실행할 대상이 없어도 재시도·보류 작업이 남으면 완료하지 않는다', async () => {
  const { db } = await collectionFixture([]);
  await ensurePressSlots(db, NOW);
  db.sqlite.prepare('INSERT INTO press_crawl_state (source_id,next_due_at) VALUES (?,?)').run(SOURCE_ID, NOW + 43200);
  assert.equal((await readPressQueueStatus(db, NOW)).retry_waiting, 0);
  db.sqlite.prepare("UPDATE press_crawl_state SET safe_error='RESPONSE_TIMEOUT' WHERE source_id=?").run(SOURCE_ID);
  const queue = await readPressQueueStatus(db, NOW);
  assert.equal(queue.complete, false);
  assert.equal(queue.open_jobs, 1);
  assert.equal(queue.retry_waiting, 1);
  assert.equal(queue.next_retry_at, new Date((NOW + 43200) * 1000).toISOString());
  const status = await readPressSlotStatus(db, previousCollectionSlot(NOW), NOW);
  assert.equal(status.combined.sources, status.combined.succeeded + status.combined.failed + status.combined.held + status.combined.running + status.combined.not_run);
});

test('상태 조회는 회차 작업을 만들거나 수집을 시작하지 않는다', async () => {
  const { db } = await collectionFixture([]);
  const status = await readPressSlotStatus(db, previousCollectionSlot(NOW), NOW);
  assert.equal(status.combined.completion, 'NOT_CAPTURED');
  assert.equal((await readPressQueueStatus(db, NOW)).complete, false);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_slot').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_collection_run').get().n, 0);
});

test('PC 종료 판정은 회차 미완료와 확인 실패를 성공 처리하지 않는다', { skip: process.platform !== 'win32' }, () => {
  const collector = fileURLToPath(new URL('../public/press-relay/collect.ps1', import.meta.url)).replaceAll("'", "''");
  const script = `$e=$null;$t=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${collector}',[ref]$t,[ref]$e);if($e.Count){throw 'syntax'};$f=$a.FindAll({param($x)$x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Get-CombinedExitCode'},$true);Invoke-Expression $f.Extent.Text;$r=[ordered]@{failed=0;deferred=0;slotCompletion='ERRORS_REMAIN';queueOpenJobs=2;queueAllSucceeded=$false;serverTick=@{failed=0;deferred=0;remainingDue=0;error=''}};if((Get-CombinedExitCode $r)-ne 3){throw 'held hidden'};$r.slotCompletion='ALL_SUCCEEDED';$r.queueOpenJobs=0;$r.queueAllSucceeded=$true;if((Get-CombinedExitCode $r)-ne 0){throw 'success rejected'};$r.queueAllSucceeded=$false;if((Get-CombinedExitCode $r)-ne 3){throw 'closed failures hidden'};$r.slotCompletion='UNVERIFIED';if((Get-CombinedExitCode $r)-ne 3){throw 'unknown hidden'};'PASS'`;
  assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }), /PASS/);
});
