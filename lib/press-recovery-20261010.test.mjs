import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectPressSource } from "./press/collect.ts";
import { readPressCoverage } from "./press/coverage.ts";
import { touchRelayPc, readRelayHeartbeats, registerRelayPc, claimRelayJobs } from "./press/relay.ts";
import { listDueSources, readSource } from "./press/store.ts";
import { nextCollectionSlot, previousCollectionSlot } from './press/schedule.ts';
import { NOW, SOURCE_ID, collectionFixture, response, feedXml, url } from "./press-test-support.mjs";

test("이전 회차 성공으로 현재 회차 실패를 숨기지 않고 실제 시도와 실행권으로 실행 중을 구분한다", async () => {
  const { db, ctx, source } = await collectionFixture([]);
  ctx.next = () => response(200, feedXml([{ title: "노인 통합돌봄 지원 확대", link: url(501) }]));
  await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  ctx.clock.now = nextCollectionSlot(NOW) + 4;
  ctx.next = () => response(500);
  await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  let c = (await readPressCoverage(db, ctx.clock.now + 1)).schedule.current_slot.server;
  assert.equal(c.failed, 1);
  assert.equal(c.succeeded, 0);
  db.sqlite.prepare("UPDATE press_crawl_state SET lease_token = 'active-worker', lease_expires_at = ? WHERE source_id = ?").run(ctx.clock.now + 60, SOURCE_ID);
  db.sqlite.prepare("UPDATE press_host_lease SET lease_token = 'active-worker', lease_expires_at = ? WHERE host = 'www.mohw.go.kr'").run(ctx.clock.now + 60);
  const slot = previousCollectionSlot(ctx.clock.now);
  db.sqlite.prepare("INSERT INTO press_job_attempt (run_id,source_id,slot_at,lease_token,host,started_at,status) VALUES ('active-attempt',?,?, 'active-worker','www.mohw.go.kr',?,'running')").run(SOURCE_ID, slot, ctx.clock.now);
  db.sqlite.prepare("UPDATE press_slot_job SET status='running',attempt_id='active-attempt' WHERE source_id=? AND slot_at=?").run(SOURCE_ID, slot);
  c = (await readPressCoverage(db, ctx.clock.now + 2)).schedule.current_slot.server;
  assert.equal(c.running, 1);
  assert.equal(c.failed, 0);
  assert.equal(c.sources, c.succeeded + c.failed + c.held + c.running + c.not_run);
  assert.equal(c.completion, "IN_PROGRESS");
});

test("환경변수 등록 PC heartbeat는 토큰 배열을 덮어쓰지 않고 오래된 신호로 후퇴하지 않는다", async () => {
  const { db } = await collectionFixture([]);
  await registerRelayPc(db, "admin-pc", NOW);
  const original = db.sqlite.prepare("SELECT value FROM app_setting WHERE key = 'press_relay_pcs'").get().value;
  await touchRelayPc(db, "desktop", NOW + 10);
  await touchRelayPc(db, "desktop", NOW);
  assert.deepEqual(await readRelayHeartbeats(db), [{ name: "desktop", lastSeenAt: NOW + 10 }]);
  assert.equal(db.sqlite.prepare("SELECT value FROM app_setting WHERE key = 'press_relay_pcs'").get().value, original);
  const status = await readPressCoverage(db, NOW + 11);
  assert.ok(status.schedule.scheduler.relay_pcs.some(p => p.name === "desktop" && p.last_seen_at === new Date((NOW + 10) * 1000).toISOString()));
});

test("60건의 반복 실패가 있더라도 미시도 기관이 후보 LIMIT 밖으로 밀리지 않는다", async () => {
  const { db } = await collectionFixture([]);
  // 이름을 나열하지 않고 실제 테이블 열 목록에 맞춰 복제한다.
  const cols = db.sqlite.prepare("PRAGMA table_info(press_source)").all().map(r => r.name);
  const clone = db.sqlite.prepare("INSERT INTO press_source (" + cols.join(",") + ") SELECT " + cols.map(c => c === "source_id" ? "?" : c).join(",") + " FROM press_source WHERE source_id = ?");
  for (let i = 0; i < 70; i++) {
    const id = "src:retry:" + i;
    clone.run(id, SOURCE_ID);
    db.sqlite.prepare("INSERT INTO press_crawl_state (source_id,next_due_at,consecutive_failures) VALUES (?,0,5)").run(id);
  }
  const picked = await listDueSources(db, NOW, 1);
  assert.equal(picked[0].sourceId, SOURCE_ID);
});

test("Windows 실행기의 실제 함수는 서버 실패·미처리를 정상 종료로 판정하지 않는다", { skip: process.platform !== "win32" }, () => {
  const script = fileURLToPath(new URL("../public/press-relay/collect.ps1", import.meta.url)).replaceAll("'", "''");
  const ps = `$e=$null;$t=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$t,[ref]$e);if($e.Count){throw ($e|Out-String)};$f=$a.FindAll({param($x)$x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Get-CombinedExitCode'},$true);Invoke-Expression $f.Extent.Text;$r=@{failed=0;deferred=0;serverTick=@{failed=1;deferred=0;remainingDue=0;error=''}};if((Get-CombinedExitCode $r)-ne 1){throw 'failure hidden'};$r.serverTick.failed=0;$r.serverTick.remainingDue=2;if((Get-CombinedExitCode $r)-ne 3){throw 'backlog hidden'};$r.serverTick.remainingDue=0;if((Get-CombinedExitCode $r)-ne 0){throw 'success rejected'};'PASS'`;
  assert.match(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" }), /PASS/);
});

test("PC 실행기는 중계 작업 전에 서버 수집을 진행하고 상세 주소를 전달한다", () => {
  const client = readFileSync(new URL("../public/press-relay/collect.ps1", import.meta.url), "utf8");
  assert.ok(client.indexOf("Invoke-ServerTicks 180") < client.indexOf('$jobs = Invoke-Dashboard "GET"'));
  assert.match(client, /detailUrls/);
});


test("중계로 잘못 넘어간 인증 API는 서버 경로로 돌아가고 과거 실패는 남는다", async () => {
  const { db, ctx } = await collectionFixture([]);
  const id = "src:paju:press-api";
  db.sqlite.prepare("UPDATE press_source SET enabled=1,approval_status='POLICY_APPROVED',collect_via='relay' WHERE source_id=?").run(id);
  const result = await collectPressSource(db, { source: await readSource(db,id), trigger:"relay" }, ctx.deps);
  assert.equal(result.errorCode,"KEY_REQUIRED");
  const beforeRuns=db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_collection_run WHERE source_id=?").get(id).n;
  const jobs=await claimRelayJobs(db,"desktop",NOW+1);
  assert.ok(!jobs.jobs.some(j=>j.sourceId===id));
  assert.equal((await readSource(db,id)).collectVia,"server");
  assert.equal(db.sqlite.prepare("SELECT safe_error FROM press_crawl_state WHERE source_id=?").get(id).safe_error,"KEY_REQUIRED");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_collection_run WHERE source_id=?").get(id).n,beforeRuns);
  db.sqlite.prepare("UPDATE press_source SET collect_via='relay' WHERE source_id=?").run(id);
  db.sqlite.prepare("UPDATE press_crawl_state SET collection_hold='MANUAL_REVIEW' WHERE source_id=?").run(id);
  await claimRelayJobs(db,"desktop",NOW+2);
  assert.equal((await readSource(db,id)).collectVia,"relay","보류는 자동으로 해제하지 않는다");
});

test("인증 API가 방화벽 응답을 받아도 키 없는 PC 경로로 자동 전환하지 않는다", async () => {
  const { db, ctx } = await collectionFixture([]);
  const id="src:paju:press-api";
  db.sqlite.prepare("UPDATE press_source SET enabled=1,approval_status='POLICY_APPROVED',collect_via='server' WHERE source_id=?").run(id);
  ctx.next=()=>response(200,"web application firewall");
  const result=await collectPressSource(db,{source:await readSource(db,id),trigger:"scheduled"},{...ctx.deps,readApiKey:async()=>"test-key"});
  assert.equal(result.errorCode,"WAF_BLOCKED");
  assert.equal((await readSource(db,id)).collectVia,"server");
});
