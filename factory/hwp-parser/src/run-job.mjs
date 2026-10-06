// 부모 실행기: 격리 Node 프로세스로 워커를 돌리고(셸 미사용, 최소 환경변수, 네트워크 차단 모듈 선적재),
// 시간 초과 시 프로세스 트리를 끝낸 뒤 manifest·해시·계약 버전을 모두 대조한다. 종료코드 0만으로 성공 처리하지 않는다.
// 동시 작업 수를 슬롯 파일로 제한하고, 작업마다 전용 임시 폴더(TEMP)를 주며, 끝나면(실패·시간 초과 포함) 임시 폴더와 미확정 산출물을 지운다.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LIMITS } from "./limits.mjs";
import { modelCacheRoot } from "./models.mjs";
import { CONTRACT, CONTRACT_VERSION, sha256Hex } from "./profile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_STREAM = 64 * 1024;
const SLOT_WAIT_MS = 120_000;

function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

/** 동시 작업 슬롯을 잡는다. 죽은 프로세스가 남긴 슬롯은 회수한다. 못 잡으면 null. */
async function acquireSlot(root, slots) {
  const dir = path.join(root, ".locks");
  mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + SLOT_WAIT_MS;
  while (Date.now() < deadline) {
    for (let index = 0; index < slots; index += 1) {
      const file = path.join(dir, "slot-" + index + ".lock");
      try {
        const fd = openSync(file, "wx");
        writeSync(fd, String(process.pid));
        closeSync(fd);
        return file;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const owner = Number.parseInt(readFileSync(file, "utf8"), 10);
        if (!Number.isInteger(owner) || !alive(owner)) rmSync(file, { force: true });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function runJob({ jobPath, root, timeoutMs, workerPath = path.join(here, "worker.mjs") }) {
  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const resolvedRoot = path.resolve(root);
  const shrink = (key) => (job.limits && Number.isInteger(job.limits[key]) && job.limits[key] > 0 ? Math.min(job.limits[key], LIMITS[key]) : LIMITS[key]);
  const limit = { timeoutMs: timeoutMs ?? shrink("timeoutMs"), maxRssMb: shrink("maxRssMb"), maxConcurrentJobs: shrink("maxConcurrentJobs") };
  const slot = await acquireSlot(resolvedRoot, limit.maxConcurrentJobs);
  if (!slot) return { ok: false, error_code: "CONCURRENCY_LIMIT" };
  const workDir = path.join(resolvedRoot, ".tmp-work", "job-" + process.pid + "-" + Date.now());
  mkdirSync(workDir, { recursive: true });
  try {
    return await runIsolated({ job, jobPath, root: resolvedRoot, workerPath, limit, workDir });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(slot, { force: true });
  }
}

async function runIsolated({ job, jobPath, root, workerPath, limit, workDir }) {
  // 모델 캐시는 준비 단계에서 받은 작업공간 models/만 쓴다. KORDOC_OFFLINE=1이라 kordoc은 모델을 내려받지 않는다.
  const env = {
    KORDOC_OFFLINE: "1", KORDOC_MODEL_CACHE: modelCacheRoot(root), WF_MAX_RSS_MB: String(limit.maxRssMb),
    PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "production", TEMP: workDir, TMP: workDir, TMPDIR: workDir,
  };
  // --import는 Windows 절대경로를 받지 않으므로 file:// URL로 넘긴다.
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(here, "net-guard.mjs")).href, "--max-old-space-size=" + LIMITS.maxOldSpaceMb, workerPath, "--job", path.resolve(jobPath), "--root", root], {
    shell: false, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { if (stdout.length < MAX_STREAM) stdout += chunk; });
  child.stderr.on("data", (chunk) => { if (stderr.length < MAX_STREAM) stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, limit.timeoutMs);
  const exitCode = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
  clearTimeout(timer);
  const cleanupPartial = () => {
    // 끝나지 못한 워커가 남긴 미확정 산출물(.tmp-<parse_id>-<pid>)을 지운다. 확정된 산출물은 건드리지 않는다.
    const outputRoot = typeof job.output_root === "string" && !path.isAbsolute(job.output_root) && !job.output_root.split(/[\\/]/).includes("..") ? path.join(root, job.output_root) : null;
    if (!outputRoot || !existsSync(outputRoot)) return;
    for (const name of readdirSync(outputRoot)) if (name.startsWith(".tmp-") && name.endsWith("-" + child.pid)) rmSync(path.join(outputRoot, name), { recursive: true, force: true });
  };
  if (timedOut) {
    cleanupPartial();
    return { ok: false, error_code: "TIMEOUT", stderr };
  }
  let summary;
  try {
    summary = JSON.parse(stdout.trim().split("\n").pop() ?? "");
  } catch {
    cleanupPartial();
    return { ok: false, error_code: "NO_SUMMARY", exit_code: exitCode, stderr };
  }
  if (!summary.ok || exitCode !== 0) {
    cleanupPartial();
    return { ok: false, error_code: summary.error_code ?? "WORKER_FAILED", exit_code: exitCode, stderr };
  }
  if (summary.job_id !== job.job_id) return { ok: false, error_code: "JOB_ID_MISMATCH" };
  const manifestPath = path.join(path.resolve(root), summary.manifest);
  if (!manifestPath.startsWith(path.resolve(root) + path.sep) || !existsSync(manifestPath)) return { ok: false, error_code: "MANIFEST_MISSING" };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.contract !== CONTRACT || manifest.contract_version !== CONTRACT_VERSION) return { ok: false, error_code: "CONTRACT_MISMATCH" };
  if (manifest.raw_sha256 !== job.expected_sha256 || manifest.parse_id !== summary.parse_id) return { ok: false, error_code: "MANIFEST_MISMATCH" };
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(path.dirname(manifestPath), file.name));
    if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256) return { ok: false, error_code: "OUTPUT_HASH_MISMATCH", file: file.name };
  }
  return { ok: true, status: manifest.status, parse_id: manifest.parse_id, reused: summary.reused, manifest_path: manifestPath, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const get = (name) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  const jobPath = get("--job");
  const root = get("--root") ?? process.env.WELFARE_FACTORY_ROOT;
  if (!jobPath || !root) {
    process.stderr.write("사용법: node src/run-job.mjs --job <작업 명세 JSON> --root <작업공간 루트>\n");
    process.exit(2);
  }
  const outcome = await runJob({ jobPath, root });
  process.stdout.write(JSON.stringify(outcome.ok
    ? { ok: true, status: outcome.status, parse_id: outcome.parse_id, reused: outcome.reused, manifest_path: outcome.manifest_path }
    : outcome) + "\n");
  process.exitCode = outcome.ok ? 0 : 1;
}
