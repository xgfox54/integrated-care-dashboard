// 공식 보도자료 첨부 일시 판독(§23.12, T153~T155): 기본 거절, 사전점검, 격리 실행 뒤 정리, 영수증에 본문 없음.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { markdownToHwpx } from "kordoc";

import { decideEphemeral } from "../../../lib/press/ephemeral.ts";
import { preflight, runEphemeral, sweepEphemeral } from "../src/ephemeral.mjs";

const SECRET = "합성본문표지-외부로-나가면-안됨";
const NOW = Date.UTC(2026, 9, 4, 3, 0);
const policy = (extra = {}) => ({
  source_id: "src:test:press", temporary_text_read_allowed: 0, temporary_attachment_parse_allowed: 1, local_classification_allowed: 0, fingerprint_retention_allowed: 1,
  max_bytes: 5_000_000, max_seconds: 60, ttl_seconds: 900, allowed_outputs: JSON.stringify(["fingerprint", "receipt"]), purpose: "중복 보조 지문",
  rights_basis: "기관 이용조건 확인(시험)", approver_ref: "admin:test", approved_at: 1, policy_version: 3, ...extra,
});
const request = (extra = {}) => ({
  featureEnabled: true,
  source: { sourceId: "src:test:press", sourceKind: "OFFICIAL_PRESS_RELEASE", approvalStatus: "POLICY_APPROVED", enabled: true, allowedHosts: ["www.example.go.kr"] },
  policy: policy(), operation: "attachment_parse", url: "https://www.example.go.kr/files/a.hwpx", purpose: "중복 보조 지문", ttlSeconds: 600, outputs: ["fingerprint", "receipt"], ...extra,
});
const clean = { platform: "linux", readText: (file) => (file === "/proc/swaps" ? "Filename\tType\tSize\n" : "core"), exists: () => false };

test("허가 판정은 기본 거절이며 하나라도 빠지면 거절한다(민간 기사 예외 없음)", () => {
  assert.equal(decideEphemeral(request()).allowed, true);
  const cases = [
    [{ featureEnabled: false }, "FEATURE_DISABLED"],
    [{ source: { ...request().source, sourceKind: "NEWS_ARTICLE" } }, "SOURCE_KIND_NOT_OFFICIAL"],
    [{ source: { ...request().source, approvalStatus: "PENDING_PERMISSION" } }, "SOURCE_NOT_APPROVED"],
    [{ policy: null }, "POLICY_MISSING"],
    [{ policy: policy({ approver_ref: "" }) }, "POLICY_INCOMPLETE"],
    [{ operation: "body_read" }, "OPERATION_NOT_ALLOWED"],
    [{ purpose: "다른 목적" }, "PURPOSE_MISMATCH"],
    [{ ttlSeconds: 3601 }, "TTL_NOT_ALLOWED"],
    [{ ttlSeconds: 1000 }, "TTL_NOT_ALLOWED"],
    [{ outputs: ["summary"] }, "OUTPUT_NOT_ALLOWED"],
    [{ outputs: ["tags"] }, "OUTPUT_NOT_ALLOWED"],
    [{ policy: policy({ fingerprint_retention_allowed: 0 }) }, "OUTPUT_NOT_ALLOWED"],
    [{ url: "https://other.example.com/a.hwpx" }, "URL_HOST_NOT_ALLOWED"],
    [{ url: "http://www.example.go.kr/a.hwpx" }, "URL_HOST_NOT_ALLOWED"],
    [{ declaredBytes: 9_000_000 }, "TOO_LARGE"],
  ];
  for (const [override, code] of cases) assert.deepEqual(decideEphemeral(request(override)), { allowed: false, code }, code);
});

test("스왑·동기화 폴더처럼 제어할 수 없는 보존 경로가 있으면 실행하지 않는다", async () => {
  assert.deepEqual(preflight(path.join(tmpdir(), "eph"), { platform: "win32", exists: (file) => file.endsWith("pagefile.sys"), systemDrive: "C:" }).blockers, ["OS_SWAP_UNCONTROLLED"]);
  assert.deepEqual(preflight(path.join(tmpdir(), "eph"), { platform: "win32", exists: () => false, systemDrive: "C:" }).blockers, ["OS_RETENTION_UNVERIFIED"], "Windows는 페이지 파일이 안 보여도 막는다");
  assert.ok(preflight("C:/Users/me/OneDrive/eph", clean).blockers.includes("SYNC_FOLDER"));
  assert.equal(preflight(path.join(tmpdir(), "eph"), clean).ok, true);
  const root = mkdtempSync(path.join(tmpdir(), "ephroot-"));
  const result = await runEphemeral({ request: request(), bytes: Buffer.from("PK\x03\x04"), itemId: "i1", sourceVersion: "v1", ephemeralRoot: root, probe: { platform: "darwin" } });
  assert.deepEqual(result, { ok: false, code: "PREFLIGHT_BLOCKED", blockers: ["OS_RETENTION_UNVERIFIED"] });
  assert.deepEqual(readdirSync(root), [], "거절되면 아무 파일도 만들지 않는다");
});

test("허가된 실행은 격리 워커로 파싱해 지문·영수증만 돌려주고 임시 폴더를 바로 지운다", async () => {
  const bytes = Buffer.from(await markdownToHwpx("# 합성 보도자료\n\n" + SECRET + "\n\n<table><tr><th>구분</th><th>금액</th></tr><tr><td>가</td><td>10</td></tr></table>\n"));
  const root = mkdtempSync(path.join(tmpdir(), "ephroot-"));
  const result = await runEphemeral({ request: request(), bytes, itemId: "src:test:press:1", sourceVersion: "post-1", ephemeralRoot: root, now: NOW, probe: clean });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.receipt.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.receipt.algorithm, "sha256-nfc-ws-collapse-v1");
  assert.ok(!JSON.stringify(result.receipt).includes(SECRET), "영수증에 본문이 없다");
  assert.deepEqual(readdirSync(root), [], "임시 폴더가 남지 않는다");
  const again = await runEphemeral({ request: request(), bytes, itemId: "src:test:press:1", sourceVersion: "post-1", ephemeralRoot: root, now: NOW, probe: clean });
  assert.equal(again.receipt.fingerprint, result.receipt.fingerprint, "같은 입력은 같은 지문");
});

test("파싱 실패·형식 위장에도 임시 폴더를 지우고, 남은 폴더는 만료 sweep이 지운다", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ephroot-"));
  assert.deepEqual(await runEphemeral({ request: request(), bytes: Buffer.from("<html>not hwp</html>"), itemId: "x", sourceVersion: "v", ephemeralRoot: root, probe: clean }), { ok: false, code: "FORMAT_NOT_ALLOWED" });
  const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
  const failed = await runEphemeral({ request: request(), bytes: broken, itemId: "x", sourceVersion: "v", ephemeralRoot: root, probe: clean });
  assert.equal(failed.ok, false);
  assert.match(failed.code, /^PARSE_FAILED:/);
  assert.deepEqual(readdirSync(root), []);
  const crash = await runEphemeral({ request: request(), bytes: broken, itemId: "x", sourceVersion: "v", ephemeralRoot: root, probe: clean, runner: async () => { throw new Error("worker crashed"); } }).catch((error) => error.message);
  assert.equal(crash, "worker crashed");
  assert.deepEqual(readdirSync(root), [], "실행기 예외에도 지운다");

  // 프로세스가 죽어 남은 폴더(만료 표시 있음/없음)를 흉내 낸다.
  mkdirSync(path.join(root, "eph-expired"));
  writeFileSync(path.join(root, "eph-expired", ".expires_at"), String(NOW - 1));
  mkdirSync(path.join(root, "eph-live"));
  writeFileSync(path.join(root, "eph-live", ".expires_at"), String(NOW + 60_000));
  mkdirSync(path.join(root, "eph-nomarker"));
  mkdirSync(path.join(root, "other"));
  const swept = sweepEphemeral(root, NOW);
  assert.deepEqual(swept.removed.sort(), ["eph-expired", "eph-nomarker"]);
  assert.deepEqual(readdirSync(root).sort(), ["eph-live", "other"]);
  assert.equal(existsSync(path.join(root, "eph-live")), true);
});
